import {
  afterPatch,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  MenuItem,
  showModal,
  type Patch,
} from "@decky/ui";
import { createElement } from "react";
import { getEmulationManagedAppids } from "../backend";
import { EmulationSettingsModal } from "../components/EmulationSettingsModal";

const MENU_ITEM_KEY = "batocera-emulation-settings";
let managedAppids = new Set<number>();

function unsignedAppid(value: unknown): number {
  return Number(value) >>> 0;
}

export async function refreshEmulationManagedAppids(): Promise<void> {
  const appids = await getEmulationManagedAppids();
  managedAppids = new Set(appids.map(unsignedAppid).filter(Boolean));
}

function eligible(appid: number): boolean {
  return managedAppids.has(unsignedAppid(appid));
}

function openSettings(appid: number): void {
  if (!eligible(appid)) return;
  showModal(
    createElement(EmulationSettingsModal, { appid: String(unsignedAppid(appid)) }),
  );
}

function dedupe(items: unknown[]): void {
  const index = items.findIndex((item) => (item as { key?: string } | null)?.key === MENU_ITEM_KEY);
  if (index >= 0) items.splice(index, 1);
}

function resolveItemsAppid(items: unknown[], fallback: number): number {
  const owned = items as Array<{
    _owner?: { pendingProps?: { overview?: { appid?: number } } };
  }>;
  const current = owned.find((item) => {
    const appid = item?._owner?.pendingProps?.overview?.appid;
    return !!appid && appid !== fallback;
  })?._owner?.pendingProps?.overview?.appid;
  if (current) return current;
  const found = findInTree(
    items,
    (node: { app?: { appid?: number } }) => !!node?.app?.appid,
    { walkable: ["props", "children"] },
  );
  return found?.app?.appid ?? fallback;
}

function insertItem(items: unknown[], fallbackAppid: number): void {
  dedupe(items);
  const appid = resolveItemsAppid(items, fallbackAppid);
  if (!eligible(appid)) return;
  const propertiesIndex = items.findIndex((item) =>
    findInReactTree(
      item,
      (node: { onSelected?: { toString(): string } }) =>
        !!node?.onSelected && node.onSelected.toString().includes("AppProperties"),
    ),
  );
  const menuItem = createElement(
    MenuItem,
    { key: MENU_ITEM_KEY, onSelected: () => openSettings(appid) },
    "Emulation Settings",
  );
  if (propertiesIndex >= 0) items.splice(propertiesIndex, 0, menuItem);
  else items.push(menuItem);
}

function isLibraryAppMenu(items: unknown): items is unknown[] {
  return (
    Array.isArray(items) &&
    !!findInReactTree(
      items,
      (node: { props?: { onSelected?: { toString(): string } } }) =>
        !!node?.props?.onSelected &&
        node.props.onSelected.toString().includes("launchSource"),
    )
  );
}

function componentAppid(component: {
  _owner?: { pendingProps?: { overview?: { appid?: number } } };
  props?: { children?: unknown };
}): number {
  const ownerAppid = component?._owner?.pendingProps?.overview?.appid;
  if (ownerAppid) return ownerAppid;
  const found = findInTree(
    component?.props?.children,
    (node: { app?: { appid?: number } }) => !!node?.app?.appid,
    { walkable: ["props", "children"] },
  );
  return found?.app?.appid ?? 0;
}

function libraryContextMenu(): { prototype: Record<string, any> } | null {
  try {
    const module = findModuleByExport(
      (candidate: { toString?: () => string }) =>
        typeof candidate?.toString === "function" &&
        candidate.toString().includes("().LibraryContextMenu"),
    );
    const factory = Object.values(module || {}).find(
      (candidate: any) =>
        typeof candidate?.toString === "function" &&
        candidate.toString().includes("navigator:"),
    );
    return factory ? fakeRenderComponent(factory as Function)?.type ?? null : null;
  } catch (error) {
    console.error("[Batocera Control] LibraryContextMenu lookup failed", error);
    return null;
  }
}

export interface EmulationMenuPatch {
  unpatch(): void;
}

export function applyEmulationMenuPatch(): EmulationMenuPatch {
  const menu = libraryContextMenu();
  if (!menu) return { unpatch: () => undefined };

  const patches: Patch[] = [];
  let innerInstalled = false;
  const outer = afterPatch(
    menu.prototype,
    "render",
    (_args: unknown[], component: unknown) => {
      const appid = componentAppid(component as Parameters<typeof componentAppid>[0]);
      if (!innerInstalled) {
        innerInstalled = true;
        const inner = afterPatch(component, "type", (_innerArgs: unknown[], rendered: unknown) => {
          const prototype = (rendered as { type?: { prototype?: Record<string, any> } })?.type?.prototype;
          if (!prototype) return rendered;
          patches.push(
            afterPatch(prototype, "render", (_renderArgs: unknown[], result: unknown) => {
              const items = (result as { props?: { children?: unknown[] } })?.props?.children?.[0];
              if (isLibraryAppMenu(items)) {
                try {
                  insertItem(items, appid);
                } catch (error) {
                  console.error("[Batocera Control] menu insertion failed", error);
                }
              }
              return result;
            }),
          );
          if (typeof prototype.shouldComponentUpdate === "function") {
            patches.push(
              afterPatch(
                prototype,
                "shouldComponentUpdate",
                (updateArgs: unknown[], shouldUpdate: unknown) => {
                  const next = (updateArgs?.[0] as { children?: unknown })?.children;
                  if (Array.isArray(next)) {
                    dedupe(next);
                    if (shouldUpdate === true) insertItem(next, appid);
                  }
                  return shouldUpdate;
                },
              ),
            );
          }
          return rendered;
        });
        patches.push(inner);
      } else {
        const children = (component as { props?: { children?: unknown } })?.props?.children;
        if (Array.isArray(children)) insertItem(children, appid);
      }
      return component;
    },
  );
  patches.push(outer);

  return {
    unpatch() {
      for (const patch of [...patches].reverse()) {
        try {
          if (!patch.hasUnpatched) patch.unpatch();
        } catch (error) {
          console.error("[Batocera Control] menu unpatch failed", error);
        }
      }
    },
  };
}
