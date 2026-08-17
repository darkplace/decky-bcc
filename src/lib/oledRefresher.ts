import { useEffect, useState } from "react";

let active = false;
let durationSec = 3;
let passes = 3;
let swallowClicksUntil = 0;
const listeners = new Set<(value: boolean) => void>();

export function setOledRefresherActive(
  value: boolean,
  opts?: { durationSec?: number; passes?: number },
) {
  if (opts?.durationSec != null) durationSec = Math.max(1, opts.durationSec);
  if (opts?.passes != null) passes = Math.max(1, opts.passes);
  if (active === value) {
    for (const listener of listeners) listener(active);
    return;
  }
  active = value;
  if (!value) swallowClicksUntil = performance.now() + 450;
  for (const listener of listeners) listener(active);
}

export function getOledRefresherActive() {
  return active;
}

export function getOledRefresherOpts() {
  return { durationSec, passes };
}

export function oledRefresherSwallowingClick() {
  return performance.now() < swallowClicksUntil;
}

export function useOledRefresherActive() {
  const [value, setValue] = useState(active);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
