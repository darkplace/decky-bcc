"""Safe live performance helpers (nice + CPU affinity).

Adapted from Armada's reapply/launch behavior without their privileged socket,
SCX schedulers, or Gamescope-specific knobs.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

NICE_MIN, NICE_MAX = -20, 19


def parse_cpulist(text: str) -> list[int]:
    cpus: list[int] = []
    for part in str(text).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            low, high = part.split("-", 1)
            if not (low.strip().isdigit() and high.strip().isdigit()):
                raise ValueError(f"invalid cpulist range: {part}")
            start, end = int(low), int(high)
            if end < start:
                raise ValueError(f"invalid cpulist range: {part}")
            cpus.extend(range(start, end + 1))
        elif part.isdigit():
            cpus.append(int(part))
        else:
            raise ValueError(f"invalid cpulist entry: {part}")
    if len(set(cpus)) != len(cpus):
        raise ValueError("duplicate cpus in cpulist")
    return cpus


def online_cpus() -> list[int]:
    try:
        return sorted(os.sched_getaffinity(0))
    except OSError:
        return list(range(os.cpu_count() or 1))


def resolve_cores(value) -> list[int] | None:
    """None/'' = unset. 'all' = every online CPU. Otherwise a cpulist string or int list."""
    if value in (None, ""):
        return None
    available = set(online_cpus())
    if value == "all":
        return sorted(available)
    if isinstance(value, (list, tuple, set)):
        cpus = sorted({int(cpu) for cpu in value})
    else:
        cpus = parse_cpulist(str(value))
    unknown = [cpu for cpu in cpus if cpu not in available]
    if unknown:
        raise ValueError(f"unknown cpus: {unknown}")
    return cpus


def clamp_nice(value) -> int:
    return max(NICE_MIN, min(NICE_MAX, int(value)))


def sanitize_perf(settings: dict) -> dict:
    clean: dict = {}
    if "cores" in settings:
        try:
            cores = resolve_cores(settings.get("cores"))
            if cores is not None:
                clean["cores"] = cores
        except (TypeError, ValueError):
            pass
    nice = settings.get("nice")
    if isinstance(nice, bool):
        pass
    elif isinstance(nice, int) or (isinstance(nice, str) and re.fullmatch(r"-?\d+", nice.strip() or "")):
        try:
            clean["nice"] = clamp_nice(nice)
        except (TypeError, ValueError):
            pass
    return clean


def process_tids(pid: int) -> list[int]:
    task = Path(f"/proc/{pid}/task")
    try:
        return [int(path.name) for path in task.iterdir() if path.name.isdigit()]
    except OSError:
        return [pid]


def descendant_pids(root_pid: int) -> list[int]:
    children: dict[int, list[int]] = {}
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                with (entry / "stat").open(encoding="utf-8", errors="replace") as handle:
                    stat = handle.read()
                ppid = int(stat.rsplit(")", 1)[1].split()[1])
            except (OSError, IndexError, ValueError):
                continue
            children.setdefault(ppid, []).append(int(entry.name))
    except OSError:
        return []
    out: list[int] = []
    stack = list(children.get(root_pid, []))
    while stack:
        pid = stack.pop()
        out.append(pid)
        stack.extend(children.get(pid, []))
    return out


def appid_key_forms(appid: str | None) -> list[str]:
    """Steam Non-Steam shortcuts use signed appids; SteamLaunch uses unsigned."""
    if appid is None:
        return []
    raw = str(appid).strip()
    if not raw:
        return []
    forms = {raw}
    try:
        value = int(raw)
    except ValueError:
        return [raw]
    unsigned = value & 0xFFFFFFFF
    forms.add(str(unsigned))
    if unsigned >= 2**31:
        forms.add(str(unsigned - 2**32))
    return list(forms)


def _cmdline_matches_appid(joined: bytes, appid: str | None) -> bool:
    if not appid:
        return True
    return any(f"AppId={form}".encode() in joined for form in appid_key_forms(appid))


def steam_session_pid(pid: int, appid: str | None) -> int:
    current, match = pid, None
    for _ in range(32):
        try:
            argv = Path(f"/proc/{current}/cmdline").read_bytes().split(b"\0")
            stat = Path(f"/proc/{current}/stat").read_text(encoding="utf-8", errors="replace")
        except OSError:
            break
        joined = b" ".join(argv)
        if b"SteamLaunch" in argv and _cmdline_matches_appid(joined, appid):
            match = current
        try:
            ppid = int(stat.rsplit(")", 1)[1].split()[1])
        except (IndexError, ValueError):
            break
        if ppid <= 1:
            break
        current = ppid
    return match if match is not None else pid


def find_running_game_pid(appid: str | None = None) -> int | None:
    """Best-effort locate a SteamLaunch session for appid (or any game)."""
    wanted = str(appid or "").strip()
    candidates: list[tuple[int, int]] = []
    try:
        entries = list(Path("/proc").iterdir())
    except OSError:
        return None
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            argv = (entry / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        if b"SteamLaunch" not in argv:
            continue
        joined = b" ".join(argv)
        if wanted and not _cmdline_matches_appid(joined, wanted):
            continue
        pid = int(entry.name)
        session = steam_session_pid(pid, wanted or None)
        candidates.append((session, pid))
    if not candidates:
        return None
    # Prefer outermost session pid.
    return sorted({session for session, _pid in candidates})[0]


def apply_to_pid_tree(pid: int, *, nice: int | None = None, cores: list[int] | None = None) -> int:
    """Apply nice/affinity to pid and descendants. Returns number of tids touched."""
    pids = [pid] + descendant_pids(pid)
    touched = 0
    full = online_cpus()
    for target in pids:
        for tid in process_tids(target):
            try:
                changed = False
                if nice is not None:
                    os.setpriority(os.PRIO_PROCESS, tid, nice)
                    changed = True
                if cores is not None:
                    os.sched_setaffinity(tid, cores if cores else full)
                    changed = True
                if changed:
                    touched += 1
            except OSError:
                continue
    return touched


def apply_to_self(*, nice: int | None = None, cores: list[int] | None = None) -> None:
    """Apply to the current process before exec (launch helper)."""
    if nice is not None:
        try:
            os.setpriority(os.PRIO_PROCESS, 0, nice)
        except OSError:
            pass
    if cores is not None:
        try:
            os.sched_setaffinity(0, cores if cores else online_cpus())
        except OSError:
            pass


def _merged_game_settings(tweaks: dict, appid: str | None) -> dict:
    settings = dict(tweaks.get("global") or {})
    games = tweaks.get("games") or {}
    if not isinstance(games, dict):
        return settings
    for key in appid_key_forms(appid):
        game = games.get(key)
        if isinstance(game, dict) and game.get("enabled") is not False:
            settings.update(game)
            break
    return settings


def reapply_from_tweaks(tweaks: dict, appid: str | None) -> dict:
    settings = _merged_game_settings(tweaks, appid)
    clean = sanitize_perf(settings)
    pid = find_running_game_pid(appid)
    if pid is None:
        raise RuntimeError("no running Steam game session to re-apply")
    touched = apply_to_pid_tree(
        pid,
        nice=clean.get("nice"),
        cores=clean.get("cores"),
    )
    return {"pids": touched, "pid": pid, "appid": appid or "", "applied": clean}
