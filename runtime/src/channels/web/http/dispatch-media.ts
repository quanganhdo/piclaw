/**
 * web/http/dispatch-media.ts – Media route dispatch helpers.
 */

import {
  handleMedia,
  handleMediaInfo,
  handleMediaUpload,
  type MediaResponseContext,
} from "../handlers/media.js";

/** Channel contract required by media-route HTTP dispatcher. */
export interface MediaDispatchChannel extends MediaResponseContext {
  /** Parse path id segments into optional integer ids. */
  parseOptionalInt(value: string | null): number | null;
  /** Optional override for POST `/media/upload` requests. */
  handleMediaUpload?(req: Request): Promise<Response>;
  /** Optional override for GET `/media/:id` and thumbnail binary routes. */
  handleMedia?(id: number, thumbnail: boolean, req?: Request): Response;
  /** Optional override for GET `/media/:id/info` metadata route. */
  handleMediaInfo?(id: number): Response;
}

/**
 * Dispatch `/media/*` routes and return null when no media route matches.
 * @param channel Media dispatcher contract with optional handler overrides.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname used for route matching and id extraction.
 * @returns Matched media response, or null when the request should fall through.
 */
export async function handleMediaRoutes(
  channel: MediaDispatchChannel,
  req: Request,
  pathname: string
): Promise<Response | null> {
  if (req.method === "POST" && pathname === "/media/upload") {
    return await (channel.handleMediaUpload?.(req) ?? handleMediaUpload(channel, req));
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/media/") && pathname.endsWith("/thumbnail")) {
    const id = channel.parseOptionalInt(pathname.replace("/media/", "").replace("/thumbnail", ""));
    if (!id) return channel.json({ error: "Media not found" }, 404);
    return channel.handleMedia?.(id, true, req) ?? handleMedia(channel, id, true, req);
  }

  if (req.method === "GET" && pathname.startsWith("/media/") && pathname.endsWith("/info")) {
    const id = channel.parseOptionalInt(pathname.replace("/media/", "").replace("/info", ""));
    if (!id) return channel.json({ error: "Media not found" }, 404);
    return channel.handleMediaInfo?.(id) ?? handleMediaInfo(channel, id);
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/media/")) {
    const id = channel.parseOptionalInt(pathname.replace("/media/", ""));
    if (!id) return channel.json({ error: "Media not found" }, 404);
    return channel.handleMedia?.(id, false, req) ?? handleMedia(channel, id, false, req);
  }

  return null;
}
