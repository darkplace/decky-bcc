import { Router } from "@decky/ui";
import type { Config, DropdownChoice, GameRef } from "../types";

export function gameDisplayName(game: GameRef | null | undefined): string {
  if (!game?.appid) return "";
  const base = game.name || `App ${game.appid}`;
  return game.nonSteam ? `${base} (Non-Steam)` : base;
}

export function availableGames(config: Config): GameRef[] {
  const games = new Map<string, GameRef>();
  for (const game of config.installedGames || []) {
    if (game?.appid) {
      games.set(String(game.appid), {
        appid: String(game.appid),
        name: game.name || `App ${game.appid}`,
        nonSteam: !!game.nonSteam,
      });
    }
  }
  for (const [appid, settings] of Object.entries(config.tweaks?.games || {})) {
    if (!appid) continue;
    const name = (settings as { name?: string }).name || `App ${appid}`;
    if (!games.has(appid)) {
      games.set(appid, { appid, name });
    }
  }
  return Array.from(games.values()).sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b)));
}

export function editTargetOptions(config: Config): DropdownChoice[] {
  return [
    { data: "", label: "Default" },
    ...availableGames(config).map((game) => ({ data: game.appid, label: gameDisplayName(game) })),
  ];
}

export function currentGame(): GameRef | null {
  const running = (Router as any)?.MainRunningApp || window.Router?.MainRunningApp;
  const appid = running?.appid;
  if (!appid) return null;
  const id = String(appid);
  let name = running?.display_name || running?.displayName || "";
  try {
    const details: any = window.appDetailsStore?.GetAppDetails?.(Number(id));
    name = details?.strDisplayName || details?.strName || details?.name || name;
  } catch (error) {
  }
  return { appid: id, name: name || `App ${id}` };
}
