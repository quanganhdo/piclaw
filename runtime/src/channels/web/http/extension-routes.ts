/**
 * extension-routes.ts — Registry for extension-registered HTTP routes.
 *
 * Allows piclaw extensions (both built-in and workspace) to serve custom
 * HTTP endpoints from within the same process. Routes are keyed by path
 * prefix and dispatched before the 404 fallback in the request router.
 *
 * Security:
 *   - Routes are served *after* authentication checks, so only
 *     authenticated users can access them.
 *   - The registry freezes after the first real extension/resource load so
 *     late-loaded code cannot register brand-new routes after the initial pass.
 *   - Every registration is logged with the extension path for audit.
 *   - Extensions must sanitise paths against traversal attacks themselves.
 */

import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.extension-routes");

/**
 * Extension-provided HTTP handler invoked for matching route prefixes.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @returns A response to short-circuit routing, or null to allow fallback handling.
 */
export type ExtensionRouteHandler = (req: Request, pathname: string) => Response | Promise<Response> | null;

interface RegisteredRoute {
  prefix: string;
  handler: ExtensionRouteHandler;
  extensionPath: string;
  registeredAt: string;
}

export interface ExtensionRouteConflict {
  type: "exact" | "nested";
  prefix: string;
  extensionPath: string;
  conflictingPrefix: string;
  conflictingExtensionPath: string;
}

const routes: RegisteredRoute[] = [];
let frozen = false;

/**
 * Freeze the route registry. After this call, no new routes can be
 * registered. Called after the initial extension load pass completes.
 */
export function freezeExtensionRoutes(): void {
  if (frozen) return;
  frozen = true;
  log.info("Extension route registry frozen", {
    operation: "web_extension_routes.freeze",
    routeCount: routes.length,
    routes: routes.map(r => ({ prefix: r.prefix, extensionPath: r.extensionPath })),
    conflicts: getExtensionRouteConflicts(),
  });
}

/** Whether the route registry is currently frozen. */
export function isExtensionRouteRegistryFrozen(): boolean {
  return frozen;
}

/**
 * Register an extension HTTP route handler for a path prefix.
 * @param prefix Path prefix to match (normalized to begin with `/`).
 * @param handler Extension route callback invoked for matching requests.
 * @param extensionPath Extension identifier/path used for diagnostics.
 * @returns "created", "updated", or "rejected" if the registry is frozen.
 */
export function prefixesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function findRouteConflicts(prefix: string, extensionPath: string): ExtensionRouteConflict[] {
  return routes
    .filter((route) => route.extensionPath !== extensionPath && prefixesOverlap(prefix, route.prefix))
    .map((route) => ({
      type: prefix === route.prefix ? "exact" as const : "nested" as const,
      prefix,
      extensionPath,
      conflictingPrefix: route.prefix,
      conflictingExtensionPath: route.extensionPath,
    }));
}

export function registerExtensionRoute(
  prefix: string,
  handler: ExtensionRouteHandler,
  extensionPath: string
): "created" | "updated" | "rejected" {
  const normalised = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const now = new Date().toISOString();

  const existing = routes.find((route) => route.prefix === normalised && route.extensionPath === extensionPath);
  if (existing) {
    existing.handler = handler;
    existing.registeredAt = now;
    log.info("Updated extension route", {
      operation: "web_extension_routes.register_updated",
      prefix: normalised,
      extensionPath,
    });
    return "updated";
  }

  if (frozen) {
    log.warn("Rejected extension route registration — registry is frozen", {
      operation: "web_extension_routes.register_rejected",
      prefix: normalised,
      extensionPath,
    });
    return "rejected";
  }

  const conflicts = findRouteConflicts(normalised, extensionPath);
  for (const conflict of conflicts) {
    log.warn("Extension route prefix overlaps another owner; registration order and null fall-through remain active", {
      operation: "web_extension_routes.register_conflict",
      ...conflict,
    });
  }

  routes.push({ prefix: normalised, handler, extensionPath, registeredAt: now });
  log.info("Registered extension route", {
    operation: "web_extension_routes.register_created",
    prefix: normalised,
    extensionPath,
  });
  return "created";
}

/**
 * Attempt to serve a request via registered extension routes.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @returns A matched extension response, or null when no route handled the request.
 */
export async function handleExtensionRoutes(
  req: Request,
  pathname: string
): Promise<Response | null> {
  // Route introspection endpoint
  if (req.method === "GET" && pathname === "/api/extension-routes") {
    return new Response(JSON.stringify(getRegisteredRoutes()), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  for (const route of routes) {
    if (pathname === route.prefix || pathname.startsWith(route.prefix + "/") || pathname.startsWith(route.prefix + "?")) {
      try {
        const result = route.handler(req, pathname);
        const response = result instanceof Promise ? await result : result;
        if (response) return response;
      } catch (error) {
        log.error("Extension route handler failed", {
          operation: "web_extension_routes.handle_registered_route",
          prefix: route.prefix,
          extensionPath: route.extensionPath,
          err: error,
        });
        return new Response("Internal Server Error", { status: 500 });
      }
    }
  }
  return null;
}

/**
 * Remove all registered extension routes and unfreeze (used during extension reload).
 * @returns Nothing.
 */
export function clearExtensionRoutes(): void {
  routes.length = 0;
  frozen = false;
}

/**
 * Return the currently registered extension route prefixes for diagnostics.
 * @returns A lightweight route listing with prefix and owning extension path.
 */
export function getRegisteredRoutes(): Array<{ prefix: string; extensionPath: string; registeredAt: string }> {
  return routes.map(r => ({ prefix: r.prefix, extensionPath: r.extensionPath, registeredAt: r.registeredAt }));
}

/** Return cross-owner exact/nested overlaps without changing dispatch policy. */
export function getExtensionRouteConflicts(): ExtensionRouteConflict[] {
  const conflicts: ExtensionRouteConflict[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    for (const other of routes.slice(index + 1)) {
      if (route.extensionPath === other.extensionPath || !prefixesOverlap(route.prefix, other.prefix)) continue;
      conflicts.push({
        type: route.prefix === other.prefix ? "exact" : "nested",
        prefix: other.prefix,
        extensionPath: other.extensionPath,
        conflictingPrefix: route.prefix,
        conflictingExtensionPath: route.extensionPath,
      });
    }
  }
  return conflicts;
}

/**
 * Expose registerExtensionRoute on globalThis so workspace extensions
 * (loaded via jiti) can call it without direct imports.
 *
 * This runs as a module side-effect when request-router-service.ts
 * imports this module — i.e., at web server startup, BEFORE any
 * session/extension creation.
 */
(globalThis as any).__piclaw_registerRoute = (
  prefix: string,
  handler: ExtensionRouteHandler,
  extensionPath?: string
): "created" | "updated" | "rejected" => {
  return registerExtensionRoute(prefix, handler, extensionPath || "unknown");
};

// Also expose registerToolStatusHintProvider for addon extensions
import { registerToolStatusHintProvider } from "../../../tool-status-hints.js";
(globalThis as any).__piclaw_registerToolStatusHintProvider = registerToolStatusHintProvider;

/**
 * Generic widget-kind registry.
 *
 * Addons call `__piclaw_registerWidgetKind(kind, renderer)` to provide an HTML
 * renderer for a named widget kind. A producer can pass an invocation-scoped
 * artifact to the registered renderer and emit its result as a generic HTML
 * widget. The web app does not need kind-specific routing or components.
 *
 * Example:
 *   __piclaw_registerWidgetKind('custom_report', (artifact) =>
 *     `<section>${artifact.title}</section>`);
 */
type WidgetKindRenderer = (artifact: Record<string, unknown>) => string;
const _widgetKindRegistry = new Map<string, WidgetKindRenderer>();

export function getWidgetKindRenderer(kind: string): WidgetKindRenderer | null {
  return _widgetKindRegistry.get(kind) ?? null;
}

(globalThis as any).__piclaw_registerWidgetKind = (
  kind: string,
  renderer: WidgetKindRenderer,
): void => {
  if (typeof kind !== "string" || !kind.trim()) return;
  if (typeof renderer !== "function") return;
  _widgetKindRegistry.set(kind.trim(), renderer);
};
