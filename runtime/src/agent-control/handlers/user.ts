/**
 * agent-control/handlers/user.ts – Handlers for user identity commands.
 *
 * Handles /user-name, /user-avatar, and /user-github commands that update
 * the human user's display name, avatar, and GitHub profile settings,
 * persisting changes to the config file.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import {
  getIdentityConfig,
  setUserAvatar,
  setUserAvatarBackground,
  setUserName,
} from "../../core/config.js";
import { updateUserConfig } from "../agent-control-helpers.js";
import { ensureAvatarCache } from "../../channels/web/media/avatar-service.js";
import { splitArgs } from "../parser-utils.js";

const CLEAR_VALUES = ["clear", "none", "off", "default"];
const USER_GITHUB_HANDLE_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

function normalizeHandle(login: string): string | null {
  if (!USER_GITHUB_HANDLE_RE.test(login)) return null;
  return login;
}

type UserNameCommand = Extract<AgentControlCommand, { type: "user_name" }>;
type UserAvatarCommand = Extract<AgentControlCommand, { type: "user_avatar" }>;
type UserGithubCommand = Extract<AgentControlCommand, { type: "user_github" }>;

/** Handle /user-name: update the user display name. */
export async function handleUserName(_session: AgentSession, command: UserNameCommand): Promise<AgentControlResult> {
  if (!command.name) {
    const current = getIdentityConfig().userName || "(default)";
    return { status: "success", message: `User name: ${current}` };
  }

  const trimmed = command.name.trim();
  const normalized = trimmed.toLowerCase();
  const nextName = CLEAR_VALUES.includes(normalized) ? null : trimmed;
  const updated = updateUserConfig({ name: nextName });
  const effective = updated.name || getIdentityConfig().userName || "";
  setUserName(effective);

  return {
    status: "success",
    message: nextName ? `User name set to ${effective}.` : "User name reset to default.",
  };
}

/** Handle /user-avatar: update the user avatar URL. */
export async function handleUserAvatar(_session: AgentSession, command: UserAvatarCommand): Promise<AgentControlResult> {
  if (!command.avatar) {
    const current = getIdentityConfig().userAvatar || "(default)";
    return { status: "success", message: `User avatar: ${current}` };
  }

  const trimmed = command.avatar.trim();
  const normalized = trimmed.toLowerCase();
  const nextAvatar = CLEAR_VALUES.includes(normalized) ? null : trimmed;
  const effective = nextAvatar || "";
  if (effective) {
    try { await ensureAvatarCache("user", effective, { refresh: true }); }
    catch (error) { return { status: "error", message: `User avatar unchanged: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  setUserAvatar(effective);

  if (nextAvatar === null) {
    setUserAvatarBackground("");
  }

  return {
    status: "success",
    message: nextAvatar ? `User avatar set to ${effective || "(default)"}.` : "User avatar reset to default.",
  };
}

function normalizeGithubProfile(input?: string): string | null {
  if (!input) return null;

  const tokens = splitArgs(input);
  if (tokens.length !== 1) return null;

  const raw = tokens[0]!.trim();
  if (!raw) return null;

  const candidate = raw.startsWith("@") ? raw.slice(1).trim() : raw;
  if (!candidate) return null;

  if (candidate.includes("/")) {
    const isPotentialUrl =
      candidate.includes("://") ||
      candidate.startsWith("github.com/") ||
      candidate.startsWith("www.github.com/");
    if (!isPotentialUrl) return null;

    try {
      const normalized = candidate.includes("://") ? candidate : `https://${candidate}`;
      const url = new URL(normalized);
      if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 1) return null;
      return normalizeHandle(segments[0] || "") || null;
    } catch {
      return null;
    }
  }

  return normalizeHandle(candidate);
}

/** Handle /user-github: update the user GitHub profile. */
export async function handleUserGithub(_session: AgentSession, command: UserGithubCommand): Promise<AgentControlResult> {
  const login = normalizeGithubProfile(command.profile);
  if (!login) {
    return {
      status: "error",
      message:
        "Usage: /user-github <github profile URL|@handle|handle>\n" +
        "Examples: /user-github @octocat, /user-github octocat, /user-github https://github.com/octocat.",
    };
  }

  const apiUrl = `https://api.github.com/users/${encodeURIComponent(login)}`;
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "piclaw",
      },
    });
  } catch (error) {
    return {
      status: "error",
      message: `Failed to fetch GitHub profile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to fetch GitHub profile: HTTP ${response.status}`,
    };
  }

  const payload = (await response.json()) as { name?: string; login?: string; avatar_url?: string };
  const resolvedName = (payload.name || payload.login || login || "").trim();
  const resolvedAvatar = (payload.avatar_url || "").trim();
  if (!resolvedName || !resolvedAvatar) {
    return {
      status: "error",
      message: "GitHub profile missing name or avatar URL.",
    };
  }

  const updated = updateUserConfig({
    name: resolvedName,
    avatar: resolvedAvatar,
    avatarBackground: "clear",
  });
  setUserName(updated.name || resolvedName);
  setUserAvatar(updated.avatar || resolvedAvatar);
  setUserAvatarBackground(updated.avatarBackground || "clear");

  return {
    status: "success",
    message: `User profile set to ${resolvedName} (GitHub: ${login}).`,
  };
}
