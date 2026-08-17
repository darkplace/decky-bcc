import { useEffect, useState } from "react";

let active = false;
const listeners = new Set<(value: boolean) => void>();

export function setOledScreensaverActive(value: boolean) {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener(active);
}

export function getOledScreensaverActive() {
  return active;
}

export function useOledScreensaverActive() {
  const [value, setValue] = useState(active);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
