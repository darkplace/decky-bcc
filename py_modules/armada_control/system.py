"""Batocera system helpers for Batocera Control plugin."""

from __future__ import annotations

import os
import re
import stat
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import fcntl


BATOCERA_SETTINGS_GET = "/usr/bin/batocera-settings-get"
BATOCERA_SETTINGS_SET = "/usr/bin/batocera-settings-set"
BATOCERA_CONF = Path("/userdata/system/batocera.conf")
SETTINGS_LOCK = Path("/userdata/system/configs/batocera-control/settings.lock")
BATOCERA_CONF_LOCK = Path(f"{BATOCERA_CONF}.lock")
DROPBEAR_INIT = Path("/etc/init.d/S50dropbear")
_SETTINGS_THREAD_LOCK = threading.RLock()


def read_text(path, default=""):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        return default


def atomically_write_bytes(path, data, mode=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    owner = None
    if mode is None:
        try:
            current = path.stat()
            mode = stat.S_IMODE(current.st_mode)
            owner = (current.st_uid, current.st_gid)
        except OSError:
            mode = 0o644
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        if owner is not None:
            try:
                os.chown(tmp, *owner)
            except OSError:
                pass
        os.replace(tmp, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def atomically_write(path, text, mode=None):
    atomically_write_bytes(path, text.encode("utf-8"), mode)


def run_cmd(cmd, timeout=5, capture=True):
    try:
        return subprocess.run(
            cmd,
            check=False,
            text=True,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _settings_get(key: str) -> str:
    result = run_cmd([BATOCERA_SETTINGS_GET, key])
    return result.stdout.strip() if result and result.returncode == 0 else ""


def _repairable_config(data: bytes) -> tuple[bytes, bool]:
    """Return valid key/value text, repairing only known writer-race damage."""
    repaired = data.replace(b"\0", b"")
    changed = repaired != data
    brightness = None
    output = []

    for raw_line in repaired.splitlines(keepends=True):
        content = raw_line.rstrip(b"\r\n")
        stripped = content.strip()
        if not stripped or stripped.startswith(b"#"):
            output.append(raw_line)
            continue
        if b"=" in stripped:
            key, value = stripped.split(b"=", 1)
            if key.strip() == b"display.brightness":
                brightness = value.strip()
            output.append(raw_line)
            continue
        # A concurrent brightness write has historically left a second, bare
        # numeric line after display.brightness. It is never valid config data.
        if brightness and stripped.isdigit() and stripped == brightness:
            changed = True
            continue
        raise RuntimeError("batocera.conf contains an invalid non-key/value line")

    return b"".join(output), changed


def _backup_corrupt_config(data: bytes) -> None:
    if not data:
        return
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    backup = BATOCERA_CONF.with_name(
        f"{BATOCERA_CONF.name}.corrupt-{stamp}-{os.getpid()}-{time.time_ns() % 1_000_000_000}"
    )
    atomically_write_bytes(backup, data, 0o600)


@contextmanager
def _settings_transaction():
    """Serialize every settings write made by this plugin across its modules."""
    with _SETTINGS_THREAD_LOCK:
        SETTINGS_LOCK.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(SETTINGS_LOCK, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


def settings_set_many(values: list[tuple[str, str]]) -> None:
    """Persist settings in one validated transaction and guard against races."""
    if not values:
        return
    normalized = [(str(key), str(value)) for key, value in values]
    if any(not key or "\n" in key or "\r" in key for key, _value in normalized):
        raise ValueError("invalid Batocera setting name")

    with _settings_transaction():
        try:
            before = BATOCERA_CONF.read_bytes()
        except FileNotFoundError:
            before = b""
        except OSError as exc:
            raise RuntimeError("failed to read batocera.conf") from exc

        clean_before, repaired = _repairable_config(before)
        if repaired:
            _backup_corrupt_config(before)
            atomically_write_bytes(BATOCERA_CONF, clean_before, 0o600)

        command = [BATOCERA_SETTINGS_SET, "--validate"]
        for key, value in normalized:
            command.extend((key, value))
        result = run_cmd(command, timeout=20)
        if not result or result.returncode != 0:
            try:
                damaged = BATOCERA_CONF.read_bytes()
            except OSError:
                damaged = None
            try:
                if damaged is not None and damaged != clean_before:
                    _backup_corrupt_config(damaged)
                if damaged != clean_before:
                    atomically_write_bytes(BATOCERA_CONF, clean_before, 0o600)
            except OSError:
                pass
            raise RuntimeError("failed to persist Batocera settings")

        try:
            after = BATOCERA_CONF.read_bytes()
            clean_after, post_repair = _repairable_config(after)
        except (OSError, RuntimeError) as exc:
            try:
                if BATOCERA_CONF.exists():
                    _backup_corrupt_config(BATOCERA_CONF.read_bytes())
                atomically_write_bytes(BATOCERA_CONF, clean_before, 0o600)
            except OSError:
                pass
            raise RuntimeError("batocera.conf failed post-write validation") from exc
        if post_repair:
            _backup_corrupt_config(after)
            atomically_write_bytes(BATOCERA_CONF, clean_after, 0o600)


def settings_set(key: str, value: object) -> None:
    settings_set_many([(key, str(value))])


def settings_remove_many(keys: list[str]) -> None:
    """Remove exact settings while sharing batocera-settings' native lock."""
    normalized = {str(key) for key in keys}
    if not normalized:
        return
    if any(not key or "\n" in key or "\r" in key or "=" in key for key in normalized):
        raise ValueError("invalid Batocera setting name")

    with _settings_transaction():
        BATOCERA_CONF_LOCK.parent.mkdir(parents=True, exist_ok=True)
        native_fd = os.open(BATOCERA_CONF_LOCK, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(native_fd, fcntl.LOCK_EX)
            try:
                before = BATOCERA_CONF.read_bytes()
            except FileNotFoundError:
                return
            except OSError as exc:
                raise RuntimeError("failed to read batocera.conf") from exc

            clean_before, repaired = _repairable_config(before)
            if repaired:
                _backup_corrupt_config(before)

            output = []
            changed = repaired
            for raw_line in clean_before.splitlines(keepends=True):
                content = raw_line.rstrip(b"\r\n")
                stripped = content.strip()
                if stripped and not stripped.startswith(b"#") and b"=" in stripped:
                    raw_key = stripped.split(b"=", 1)[0].strip()
                    try:
                        key = raw_key.decode("utf-8")
                    except UnicodeDecodeError:
                        key = ""
                    if key in normalized:
                        changed = True
                        continue
                output.append(raw_line)

            if changed:
                atomically_write_bytes(BATOCERA_CONF, b"".join(output))
        finally:
            fcntl.flock(native_fd, fcntl.LOCK_UN)
            os.close(native_fd)


def settings_remove(key: str) -> None:
    settings_remove_many([key])


def is_batocera() -> bool:
    return Path("/usr/share/batocera").is_dir() or Path(BATOCERA_SETTINGS_GET).exists()


def cpu_device_class():
    candidates = [
        read_text("/proc/device-tree/compatible").replace("\x00", " "),
        read_text("/sys/firmware/devicetree/base/compatible").replace("\x00", " "),
        read_text("/usr/share/batocera/batocera.arch"),
    ]
    for value in candidates:
        matches = re.findall(r"(?:qcom[,\-])?(sm\d{4}|qcs\d{4})", value, flags=re.IGNORECASE)
        if matches:
            return matches[0].upper()
    return "UNKNOWN"


def ssh_enabled():
    # Batocera uses Dropbear/OpenRC-style init scripts, not systemd's sshd unit.
    if is_batocera():
        active = run_cmd(["pgrep", "-x", "dropbear"])
        return bool(active and active.returncode == 0)
    active = run_cmd(["systemctl", "is-active", "sshd"])
    return bool(active and active.returncode == 0 and active.stdout.strip() == "active")


def os_version():
    try:
        return Path("/usr/share/batocera/batocera.version").read_text(encoding="utf-8").strip()
    except OSError:
        return "batocera"


def set_ssh_enabled(enabled):
    if is_batocera():
        settings_set("system.ssh.enabled", "1" if enabled else "0")
        if DROPBEAR_INIT.exists():
            action = "start" if enabled else "stop"
            result = run_cmd([str(DROPBEAR_INIT), action], timeout=30)
            if not result or result.returncode != 0:
                raise RuntimeError(f"failed to {action} Dropbear")
    else:
        command = ["systemctl", "enable", "--now", "sshd"] if enabled else ["systemctl", "disable", "--now", "sshd"]
        result = run_cmd(command, timeout=30)
        if not result or result.returncode != 0:
            raise RuntimeError("failed to update sshd")
    return ssh_enabled()


MEM_SLEEP_PATH = Path("/sys/power/mem_sleep")
CPUFREQ_GOVERNOR = Path("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
CPUFREQ_AVAILABLE = Path("/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors")
CPUFREQ_ROOT = Path("/sys/devices/system/cpu")
SLEEP_MODE_LABELS = {
    "s2idle": "s2idle (shallow)",
    "deep": "Deep",
}
PLUGIN_SLEEP_PREF = Path("/userdata/system/configs/batocera-control/sleep-mode.conf")


def sleep_modes() -> list[dict[str, str]]:
    advertised = {word.strip("[]") for word in read_text(MEM_SLEEP_PATH).split()}
    return [
        {"data": mode, "label": SLEEP_MODE_LABELS.get(mode, mode)}
        for mode in ("s2idle", "deep")
        if mode in advertised
    ]


def sleep_mode() -> str:
    raw = read_text(MEM_SLEEP_PATH)
    for word in raw.split():
        if word.startswith("[") and word.endswith("]"):
            return word.strip("[]")
    parts = raw.split()
    return parts[0] if parts else ""


def set_sleep_mode(value: str) -> str:
    mode = str(value or "").strip()
    allowed = {item["data"] for item in sleep_modes()}
    if mode not in allowed:
        raise ValueError(f"unsupported sleep mode: {mode}")
    try:
        MEM_SLEEP_PATH.write_text(f"{mode}\n", encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"failed to set sleep mode: {exc}") from exc
    try:
        PLUGIN_SLEEP_PREF.parent.mkdir(parents=True, exist_ok=True)
        PLUGIN_SLEEP_PREF.write_text(f"{mode}\n", encoding="utf-8")
    except OSError:
        pass
    return sleep_mode()


def cpu_governors() -> list[str]:
    # userspace requires a scaling_setspeed writer Batocera does not provide.
    return [name for name in read_text(CPUFREQ_AVAILABLE).split() if name and name != "userspace"]


def cpu_governor() -> str:
    return read_text(CPUFREQ_GOVERNOR).strip()


def set_cpu_governor(value: str) -> str:
    name = str(value or "").strip()
    allowed = cpu_governors()
    if name not in allowed:
        raise ValueError(f"unsupported CPU governor: {name}")
    for cpu in CPUFREQ_ROOT.glob("cpu[0-9]*"):
        target = cpu / "cpufreq" / "scaling_governor"
        try:
            target.write_text(f"{name}\n", encoding="utf-8")
        except OSError:
            continue
    return cpu_governor()
