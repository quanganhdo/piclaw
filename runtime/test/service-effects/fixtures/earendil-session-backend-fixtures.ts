import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InMemorySessionRepo,
  JsonlSessionRepo,
  type JsonlSessionMetadata,
  type SessionRepo,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type {
  SessionBackendFixture,
  SessionBackendFixtureFactory,
} from "@earendil-works/pi-agent-core/session/testing";

function withDefaultSessionCwd(repository: JsonlSessionRepo, cwd: string): SessionRepo<JsonlSessionMetadata> {
  return {
    create(options) {
      return repository.create({ ...options, cwd });
    },
    open: (metadata) => repository.open(metadata),
    list: () => repository.list(),
    delete: (metadata) => repository.delete(metadata),
    fork(source, options) {
      return repository.fork(source, { ...options, cwd });
    },
  };
}

/** Fresh public in-memory backend fixture for one unchanged upstream case. */
export const createEarendilMemorySessionFixture: SessionBackendFixtureFactory = () =>
  Promise.resolve<SessionBackendFixture>({
    repository: new InMemorySessionRepo(),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  });

/** Fresh public JSONL backend fixture with the required backend-specific cwd. */
export const createEarendilJsonlSessionFixture: SessionBackendFixtureFactory = async () => {
  const root = await mkdtemp(join(tmpdir(), "piclaw-wp-3b-jsonl-"));
  const environment = new NodeExecutionEnv({ cwd: root });
  const repository = withDefaultSessionCwd(new JsonlSessionRepo({ fs: environment, sessionsRoot: root }), root);
  return {
    repository,
    async [Symbol.asyncDispose]() {
      await environment.cleanup();
      await rm(root, { recursive: true, force: true });
    },
  } satisfies SessionBackendFixture;
};
