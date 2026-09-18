import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import {
  JsonlSessionRepo,
  MemorySessionRepo,
  type JsonlSessionMetadata,
  type SessionRepo,
} from "@earendil-works/pi-agent-core/harness/session";

const NOW = 1_700_000_000_000;
const CONFORMANCE_CWD = "/workspace";

export interface EarendilSessionRepoFixture<TRepository> {
  readonly createRepository: () => Promise<TRepository>;
  readonly closeRepository: () => Promise<void>;
}

async function cleanupJsonlResources(
  repository: JsonlSessionRepo,
  environment: NodeExecutionEnv,
  root: string,
): Promise<void> {
  try {
    await repository.close(BACKGROUND_CONTEXT);
  } finally {
    try {
      await environment.cleanup(BACKGROUND_CONTEXT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

/** Owns the real public memory repository used by one conformance case at a time. */
export function createEarendilMemorySessionFixture(): EarendilSessionRepoFixture<MemorySessionRepo> {
  let repository: MemorySessionRepo | undefined;

  return {
    createRepository() {
      if (repository !== undefined) throw new Error("Memory conformance repository was not cleaned up");
      repository = new MemorySessionRepo({ now: () => NOW });
      return Promise.resolve(repository);
    },
    async closeRepository() {
      const ownedRepository = repository;
      repository = undefined;
      if (ownedRepository !== undefined) await ownedRepository.close(BACKGROUND_CONTEXT);
    },
  };
}

/** Owns the real public JSONL repository, execution environment, and temporary directory. */
export function createEarendilJsonlSessionFixture(): EarendilSessionRepoFixture<
  SessionRepo<JsonlSessionMetadata>
> {
  let owned:
    | {
        readonly environment: NodeExecutionEnv;
        readonly repository: JsonlSessionRepo;
        readonly root: string;
      }
    | undefined;

  return {
    async createRepository() {
      if (owned !== undefined) throw new Error("JSONL conformance repository was not cleaned up");

      const root = await mkdtemp(join(tmpdir(), "piclaw-earendil-0851-jsonl-"));
      const environment = new NodeExecutionEnv({ cwd: root });
      const repository = new JsonlSessionRepo({
        fileSystem: environment,
        sessionsRoot: "sessions",
        now: () => NOW,
      });
      owned = { environment, repository, root };

      return {
        create(options, context: Context) {
          return repository.create({ ...options, cwd: CONFORMANCE_CWD }, context);
        },
        open(metadata, context: Context) {
          return repository.open(metadata, context);
        },
        list(_options, context: Context) {
          return repository.list({ cwd: CONFORMANCE_CWD }, context);
        },
        delete(metadata, context: Context) {
          return repository.delete(metadata, context);
        },
        fork(source, options, context: Context) {
          return repository.fork(source, options, context);
        },
      } satisfies SessionRepo<JsonlSessionMetadata>;
    },
    async closeRepository() {
      const resource = owned;
      owned = undefined;
      if (resource === undefined) return;

      await cleanupJsonlResources(resource.repository, resource.environment, resource.root);
    },
  };
}
