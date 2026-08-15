"""Installed Steam games — Batocera paths (not Armada /var/home/armada)."""

from __future__ import annotations

import os
from pathlib import Path


def _steam_roots() -> list[Path]:
    seen: set[Path] = set()
    roots: list[Path] = []
    for raw in (
        os.environ.get("STEAM_COMPAT_CLIENT_INSTALL_PATH", ""),
        os.environ.get("STEAM_ROOT", ""),
        "/userdata/system/.local/share/Steam",
        "/var/home/armada/.local/share/Steam",
    ):
        if not raw:
            continue
        path = Path(raw)
        if path in seen or not path.is_dir():
            continue
        seen.add(path)
        roots.append(path)
    return roots


def _read_cstring(data: bytes, offset: int) -> tuple[str, int]:
    end = data.index(b"\0", offset)
    return data[offset:end].decode("utf-8", errors="replace"), end + 1


def _read_binary_vdf_object(data: bytes, offset: int = 0) -> tuple[dict, int]:
    """Parse Steam binary VDF objects used by shortcuts.vdf."""
    values: dict = {}
    while offset < len(data):
        value_type = data[offset]
        offset += 1
        if value_type == 8:  # object end
            return values, offset
        key, offset = _read_cstring(data, offset)
        if value_type == 0:
            value, offset = _read_binary_vdf_object(data, offset)
        elif value_type == 1:
            value, offset = _read_cstring(data, offset)
        elif value_type == 2:
            if offset + 4 > len(data):
                raise ValueError("truncated binary VDF integer")
            value = int.from_bytes(data[offset : offset + 4], "little", signed=True)
            offset += 4
        elif value_type == 3:
            # float32 — uncommon in shortcuts; skip safely
            if offset + 4 > len(data):
                raise ValueError("truncated binary VDF float")
            offset += 4
            continue
        elif value_type == 7:
            if offset + 8 > len(data):
                raise ValueError("truncated binary VDF uint64")
            value = int.from_bytes(data[offset : offset + 8], "little")
            offset += 8
        else:
            raise ValueError(f"unsupported binary VDF type {value_type}")
        values[key] = value
    return values, offset


def _shortcut_games(roots: list[Path]) -> list[dict]:
    games: list[dict] = []
    for root in roots:
        for shortcuts_file in sorted((root / "userdata").glob("*/config/shortcuts.vdf")):
            try:
                parsed, _ = _read_binary_vdf_object(shortcuts_file.read_bytes())
            except (OSError, ValueError):
                continue
            shortcuts = parsed.get("shortcuts", {})
            if not isinstance(shortcuts, dict):
                continue
            for shortcut in shortcuts.values():
                if not isinstance(shortcut, dict):
                    continue
                appid = shortcut.get("appid")
                name = shortcut.get("AppName")
                if isinstance(appid, int) and appid and isinstance(name, str) and name.strip():
                    # Steam exposes shortcut AppIDs as signed 32-bit integers.
                    games.append(
                        {
                            "appid": str(appid),
                            "name": name.strip(),
                            "nonSteam": True,
                        }
                    )
    return games


def installed_games() -> list[dict]:
    roots = _steam_roots()
    steamapps_dirs: set[Path] = set()
    for root in roots:
        steamapps_dirs.add(root / "steamapps")
        for library_file in (
            root / "steamapps/libraryfolders.vdf",
            root / "config/libraryfolders.vdf",
        ):
            try:
                lines = library_file.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in lines:
                parts = line.strip().split('"')
                if len(parts) >= 4 and parts[1] == "path":
                    steamapps_dirs.add(Path(parts[3]) / "steamapps")

    games: list[dict] = []
    seen: set[str] = set()
    for steamapps_dir in sorted(steamapps_dirs):
        if not steamapps_dir.is_dir():
            continue
        for manifest in sorted(steamapps_dir.glob("appmanifest_*.acf")):
            values: dict[str, str] = {}
            try:
                lines = manifest.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in lines:
                parts = line.strip().split('"')
                if len(parts) >= 4 and parts[1] in ("appid", "name"):
                    values[parts[1]] = parts[3]
            appid = values.get("appid")
            name = values.get("name")
            if appid and name and appid not in seen and _is_playable_game(name):
                games.append({"appid": str(appid), "name": name, "nonSteam": False})
                seen.add(appid)

    for game in _shortcut_games(roots):
        if game["appid"] not in seen:
            games.append(game)
            seen.add(game["appid"])

    return sorted(games, key=lambda game: game["name"].casefold())


def _is_playable_game(name: str) -> bool:
    lower = name.lower()
    if lower.startswith("proton "):
        return False
    if "steam linux runtime" in lower:
        return False
    if lower.startswith("steamworks"):
        return False
    return True
