import { codexAdapter } from "./codex.js";
import { genericAdapter } from "./generic.js";
import { opencodeAdapter } from "./opencode.js";

const adapters = new Map(
  [codexAdapter, genericAdapter, opencodeAdapter].map((adapter) => [adapter.name, adapter]),
);

export function getAdapter(name: string) {
  const adapter = adapters.get(name);
  if (!adapter)
    throw new Error(`Unknown adapter "${name}". Known adapters: ${adapterNames().join(", ")}`);
  return adapter;
}

export function adapterNames(): string[] {
  return [...adapters.keys()];
}

export function allAdapters() {
  return [...adapters.values()];
}
