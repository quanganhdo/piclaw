import { fileURLToPath } from "node:url";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxProviderHandle,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import {
  AgentHarness,
  BACKGROUND_CONTEXT,
  MemorySessionRepo,
  type AgentHarnessOptions,
  type Context,
  type OpenOperation,
  type Session,
} from "@earendil-works/pi-agent-core";

/** Historical 0.84.x negative-probe names. They are not 0.85.1 capability results. */
export const EARENDIL_HARNESS_DIRECT_OPERATIONS = Object.freeze([
  "prompt",
  "skill",
  "promptFromTemplate",
  "compact",
  "navigateTree",
  "resume",
  "abort",
  "steer",
  "followUp",
  "nextRun",
  "cancelQueued",
  "recordUsage",
  "waitForIdle",
  "runWhenIdle",
  "peekAction",
  "executeAction",
  "runToCompletion",
  "watch",
  "lane",
  "createLane",
  "lanes",
  "watchSession",
  "hooks.on",
  "events.on",
  "create.restore",
] as const);

export type EarendilHarnessDirectOperation = typeof EARENDIL_HARNESS_DIRECT_OPERATIONS[number];
export type EarendilSelectedSemanticStatus = "pass" | "fail" | "unsupported";
export type EarendilSelectedSemanticId = `HC-${
  | "001" | "002" | "003" | "004" | "005"
  | "006" | "007" | "008" | "009" | "010"
  | "011" | "012" | "013" | "014" | "015"
  | "016" | "017" | "018" | "019" | "020"}`;

export interface EarendilSelectedSemanticOutcome {
  readonly id: EarendilSelectedSemanticId;
  readonly status: EarendilSelectedSemanticStatus;
  /** The exact requirement against which this status is reported. */
  readonly requirement: string;
  /** What this selected-release suite proves, or the boundary that remains unproved. */
  readonly boundary: string;
}

// Selected capability claims live in the versioned manifest and are checked
// against executing tests. Partial coverage never counts as full HC admission.

export interface SelectedHarnessFixture<TContext extends object | undefined = object | undefined> {
  readonly context: Context;
  readonly repo: MemorySessionRepo;
  readonly session: Session;
  readonly faux: FauxProviderHandle;
  readonly harness: import("@earendil-works/pi-agent-core").AgentHarness<TContext>;
  readonly open: OpenOperation[];
}

export interface CreateSelectedHarnessFixtureOptions<TContext extends object | undefined = object | undefined>
  extends Omit<AgentHarnessOptions<TContext>, "session" | "models" | "model"> {
  readonly repo?: MemorySessionRepo;
  readonly session?: Session;
  readonly responses?: FauxResponseStep[];
  readonly providerOptions?: Parameters<typeof fauxProvider>[0];
  readonly context?: Context;
  readonly sessionId?: string;
}

/** Construct the released harness using only package-root public runtime exports. */
export async function createSelectedHarnessFixture<TContext extends object | undefined = object | undefined>(
  options: CreateSelectedHarnessFixtureOptions<TContext> = {},
): Promise<SelectedHarnessFixture<TContext>> {
  const {
    repo = new MemorySessionRepo(),
    session: suppliedSession,
    responses = [],
    providerOptions,
    context = BACKGROUND_CONTEXT,
    sessionId = `selected-0851-${crypto.randomUUID()}`,
    ...harnessOptions
  } = options;
  const session = suppliedSession ?? await repo.create({ id: sessionId }, context);
  const faux = fauxProvider(providerOptions);
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const created = await AgentHarness.create<TContext>({
    session,
    models,
    model: faux.getModel(),
    ...harnessOptions,
  }, context);
  return Object.freeze({ context, repo, session, faux, harness: created.harness, open: created.open });
}

export { fauxAssistantMessage, fauxToolCall };

/** Retained for existing release-selection tests. */
export async function readInstalledEarendilAgentCoreVersion(): Promise<string> {
  const packageUrl = import.meta.resolve("@earendil-works/pi-agent-core/package.json");
  const manifest: unknown = await Bun.file(fileURLToPath(packageUrl)).json();
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string") {
    throw new Error("The public @earendil-works/pi-agent-core/package.json export has no string version.");
  }
  return manifest.version;
}
