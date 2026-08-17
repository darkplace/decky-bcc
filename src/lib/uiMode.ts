import { useSyncExternalStore } from "react";

type Listener = () => void;

// "Serious" layout is the default: helper descriptions are hidden and the menu
// stays compact. Turning it off restores the detailed guidance text.
let compact = true;
const listeners = new Set<Listener>();

export function getUiCompact(): boolean {
  return compact;
}

export function setUiCompact(next: boolean): void {
  if (compact === next) return;
  compact = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUiCompact(): boolean {
  return useSyncExternalStore(subscribe, getUiCompact, getUiCompact);
}
