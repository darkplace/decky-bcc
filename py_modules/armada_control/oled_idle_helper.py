#!/usr/bin/env python3
"""Native ARM idle watcher: any gamepad/touch activity stamps last-input.

Runs under /usr/bin/python3 (not FEX PluginLoader). Does not grab devices.
"""

from __future__ import annotations

import os
import re
import select
import struct
import time
from pathlib import Path

STATE_DIR = Path("/var/run/batocera-oled-care")
LAST_INPUT = STATE_DIR / "last-input"
INPUT_SYSFS = Path("/sys/class/input")
EVENT_SIZE = 24
EVENT_FMT = "=QQHHi"  # packed: timeval sec/usec, type, code, value

INCLUDE = re.compile(r"ayn|odin|ft5x06|goodix|touchscreen|gpio-keys|x-box|xbox|hotkeys", re.I)
EXCLUDE = re.compile(r"haptic|headset|jack|motion|accel|gyro|imu|iio|lis2|spmi", re.I)
ABS_DEADZONE = 2500
EV_KEY, EV_REL, EV_ABS = 1, 2, 3


def _devices() -> list[Path]:
    found: list[Path] = []
    for node in sorted(Path("/dev/input").glob("event*")):
        sysfs = INPUT_SYSFS / node.name / "device" / "name"
        try:
            name = sysfs.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if EXCLUDE.search(name) or not INCLUDE.search(name):
            continue
        found.append(node)
    return found


def _stamp() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LAST_INPUT.write_text(str(time.time()), encoding="utf-8")


def _interesting(ev_type: int, code: int, value: int, last_abs: dict[tuple[int, int], int], fd: int) -> bool:
    if ev_type == EV_KEY:
        return value != 2
    if ev_type == EV_REL:
        return value != 0
    if ev_type != EV_ABS:
        return False
    key = (fd, code)
    prev = last_abs.get(key)
    last_abs[key] = value
    if prev is None:
        return False
    if abs(value) <= 1 and abs(prev) <= 1:
        return value != prev
    return abs(value - prev) >= ABS_DEADZONE


def main() -> None:
    _stamp()
    fds: dict[int, Path] = {}
    last_abs: dict[tuple[int, int], int] = {}
    last_write = 0.0
    opened_at = 0.0

    while True:
        now = time.time()
        if not fds or now - opened_at > 15:
            for fd in list(fds):
                try:
                    os.close(fd)
                except OSError:
                    pass
            fds.clear()
            last_abs.clear()
            for path in _devices():
                try:
                    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                except OSError:
                    continue
                fds[fd] = path
            opened_at = now
            if not fds:
                time.sleep(2)
                continue

        ready, _, _ = select.select(list(fds), [], [], 2.0)
        activity = False
        for fd in ready:
            try:
                raw = os.read(fd, EVENT_SIZE * 32)
            except OSError:
                try:
                    os.close(fd)
                except OSError:
                    pass
                fds.pop(fd, None)
                continue
            for offset in range(0, len(raw) - EVENT_SIZE + 1, EVENT_SIZE):
                _sec, _usec, ev_type, code, value = struct.unpack_from(EVENT_FMT, raw, offset)
                if _interesting(ev_type, code, value, last_abs, fd):
                    activity = True
                    break
        if activity and now - last_write >= 0.05:
            _stamp()
            last_write = now


if __name__ == "__main__":
    main()
