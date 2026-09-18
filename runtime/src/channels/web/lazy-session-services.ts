import type {
  TerminalSessionService,
  TerminalSocketData,
} from "./terminal/terminal-session-service.js";
import type {
  VncSessionService,
  VncSocketData,
} from "./vnc/vnc-session-service.js";

export function createLazyTerminalService(factory: () => TerminalSessionService): TerminalSessionService {
  let instance: TerminalSessionService | null = null;
  const get = (): TerminalSessionService => {
    instance ??= factory();
    return instance;
  };
  return {
    resolveOwnerFromRequest(req: Request, allowUnauthenticated = false) {
      return get().resolveOwnerFromRequest(req, allowUnauthenticated);
    },
    getSessionInfo(owner: { token: string; userId: string }) {
      return get().getSessionInfo(owner);
    },
    attachClient(ws: Bun.ServerWebSocket<TerminalSocketData>) {
      return get().attachClient(ws);
    },
    handleMessage(ws: Bun.ServerWebSocket<TerminalSocketData>, rawMessage: string | Buffer | Uint8Array) {
      return get().handleMessage(ws, rawMessage);
    },
    detachClient(ws: Bun.ServerWebSocket<TerminalSocketData>) {
      return get().detachClient(ws);
    },
    createHandoffFromRequest(req: Request, allowUnauthenticated = false) {
      return get().createHandoffFromRequest(req, allowUnauthenticated);
    },
    shutdown() {
      return instance?.shutdown();
    },
  } as unknown as TerminalSessionService;
}

export function createLazyVncService(factory: () => VncSessionService): VncSessionService {
  let instance: VncSessionService | null = null;
  const get = (): VncSessionService => {
    instance ??= factory();
    return instance;
  };
  return {
    prepareTargetReference(targetRef: string) {
      return get().prepareTargetReference(targetRef);
    },
    resolveTargetReference(targetRef: string) {
      return get().resolveTargetReference(targetRef);
    },
    resolveOwnerFromRequest(req: Request, targetRef: string, allowUnauthenticated = false) {
      return get().resolveOwnerFromRequest(req, targetRef, allowUnauthenticated);
    },
    createHandoffFromRequest(req: Request, targetRef: string, allowUnauthenticated = false) {
      return get().createHandoffFromRequest(req, targetRef, allowUnauthenticated);
    },
    getSessionInfo(targetRef?: string | null) {
      return get().getSessionInfo(targetRef);
    },
    attachClient(ws: Bun.ServerWebSocket<VncSocketData>) {
      return get().attachClient(ws);
    },
    handleMessage(ws: Bun.ServerWebSocket<VncSocketData>, message: string | Buffer | Uint8Array) {
      return get().handleMessage(ws, message);
    },
    detachClient(ws: Bun.ServerWebSocket<VncSocketData>) {
      return get().detachClient(ws);
    },
    shutdown() {
      return instance?.shutdown();
    },
  } as unknown as VncSessionService;
}
