import type { createApplicationHostInput } from "./host-application-input.js";

/** Parent composition only: the add-on owns protocol, pairing and transport lifetime.
 * Supply bindNativeRemotePeer from the installed add-on's native entrypoint. */
export async function createHostRemotePeerService<T>(options: {
  bundle: ReturnType<typeof createApplicationHostInput>;
  nativeRootServiceOwner: { assertCurrent(): void };
  dataDir: string;
  bindNativeRemotePeer(input: {
    bundle: ReturnType<typeof createApplicationHostInput>;
    nativeRootServiceOwner: { assertCurrent(): void };
    dataDir: string;
  }): Promise<T>;
}): Promise<T> {
  options.nativeRootServiceOwner.assertCurrent();
  return options.bindNativeRemotePeer(options);
}
