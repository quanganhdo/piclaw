import type { qualifyInstalledAddon } from "./host-extension-catalog.js";
type Qualified = NonNullable<Awaited<ReturnType<typeof qualifyInstalledAddon>>>;

/** Native source policy, never a replay of legacy extension handlers. */
export function infrastructurePrompt(qualified: Qualified): string {
  qualified.assertCurrent();
  const name = qualified.kind === "proxmox" ? "getProxmoxPrompt" : qualified.kind === "portainer" ? "getPortainerPrompt" : undefined;
  const prompt = name ? (qualified.nativeExports["index.ts"]![name] as () => string)() : "";
  qualified.assertCurrent();
  return prompt;
}

/** Coverage follows the actual captured registration keys, not profile events. */
export function infrastructureLifecycle(qualified: Qualified): Record<string, (...args: any[]) => unknown> {
  const supported: Record<string, (...args: any[]) => unknown> = {
    before_agent_start: () => infrastructurePrompt(qualified),
    resources_discover: () => { qualified.assertCurrent(); return { skills: [...qualified.skillPaths] }; },
  };
  return Object.fromEntries(qualified.capabilities.events.map(event => {
    if (!supported[event]) throw Error(`Unqualified native infrastructure lifecycle: ${event}`);
    return [event, supported[event]!];
  }));
}
