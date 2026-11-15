/**
 * workspace-search – indexes workspace notes + skills into SQLite FTS and exposes a search tool.
 */
import { Type, type Static } from "typebox";
import type {
  AgentToolResult,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { refreshWorkspaceIndex, searchWorkspace, type WorkspaceSearchRow } from "../workspace-search.js";

export const WorkspaceSearchSchema = Type.Object({
  query: Type.String({ description: "FTS query text (matches workspace content)." }),
  scope: Type.Optional(
    Type.String({ description: "Scope to search: notes|skills|all (default all)." }),
  ),
  limit: Type.Optional(Type.Integer({ description: "Max results (1-50).", minimum: 1, maximum: 50 })),
  offset: Type.Optional(Type.Integer({ description: "Offset for pagination.", minimum: 0 })),
  refresh: Type.Optional(Type.Boolean({ description: "Re-index notes/skills before searching (default false; true forces a blocking refresh)." })),
  max_kb: Type.Optional(Type.Integer({ description: "Max file size (KB) to index (default 512)." })),
});

type WorkspaceSearchParams = Static<typeof WorkspaceSearchSchema>;

const WORKSPACE_SEARCH_WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type WorkspaceSearchUiContext = {
  hasUI?: boolean;
  ui?: {
    setWorkingIndicator: (options?: { frames?: string[]; intervalMs?: number }) => void;
    setWorkingMessage: (message?: string) => void;
  };
};

function startWorkspaceSearchProgress(ctx: WorkspaceSearchUiContext | undefined, message: string): void {
  if (!ctx?.hasUI || !ctx.ui) return;
  ctx.ui.setWorkingIndicator({ frames: WORKSPACE_SEARCH_WORKING_FRAMES, intervalMs: 90 });
  ctx.ui.setWorkingMessage(message);
}

function finishWorkspaceSearchProgress(ctx: WorkspaceSearchUiContext | undefined): void {
  if (!ctx?.hasUI || !ctx.ui) return;
  ctx.ui.setWorkingMessage(undefined);
  ctx.ui.setWorkingIndicator({ frames: [] });
}

type WorkspaceSearchDetails = {
  count: number;
  results: WorkspaceSearchRow[];
};

async function execute(
  _toolCallId: string,
  params: WorkspaceSearchParams,
  _signal?: AbortSignal,
  _onUpdate?: unknown,
  ctx?: ExtensionContext & WorkspaceSearchUiContext,
): Promise<AgentToolResult<WorkspaceSearchDetails>> {
  startWorkspaceSearchProgress(
    ctx,
    params.refresh ? "Workspace search: refreshing index and searching…" : "Workspace search: searching index…",
  );
  const result = await (async () => {
    try {
      return await searchWorkspace({
        query: params.query,
        scope: params.scope,
        limit: params.limit,
        offset: params.offset,
        refresh: params.refresh ?? false,
        max_kb: params.max_kb,
      });
    } finally {
      finishWorkspaceSearchProgress(ctx);
    }
  })();

  if (result.error) {
    return { content: [{ type: "text", text: result.error }], details: { count: 0, results: [] } };
  }

  if (!result.rows.length) {
    return { content: [{ type: "text", text: "No matching workspace files found." }], details: { count: 0, results: [] } };
  }

  const header = `Found ${result.rows.length} file${result.rows.length === 1 ? "" : "s"} (limit ${result.limit}, offset ${result.offset}).`;
  const lines = result.rows.map((row) => `• ${row.path} — ${row.snippet}`);
  return {
    content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }],
    details: { count: result.rows.length, results: result.rows },
  };
}

const WORKSPACE_SEARCH_HINT = [
  "## Workspace search",
  "Use `search_workspace` for note/skill lookups in the workspace.",
  "Configured workspace-search roots are indexed by a background process.",
  "Searches do not block on indexing by default; use `refresh_workspace_index` or `refresh: true` when you want a blocking rebuild.",
].join("\n");

/** Extension factory that registers the search_workspace tool. */
export const workspaceSearch: ExtensionFactory = (api) => {
  api.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${WORKSPACE_SEARCH_HINT}`,
  }));

  api.registerTool({
    name: "search_workspace",
    label: "search_workspace",
    description: "Search indexed workspace content (configured FTS roots; notes + skills by default).",
    promptSnippet: "search_workspace: full-text search over indexed workspace files from the configured FTS roots.",
    parameters: WorkspaceSearchSchema,
    execute,
  });

  api.registerTool({
    name: "refresh_workspace_index",
    label: "refresh_workspace_index",
    description: "Refresh the workspace FTS index for the configured roots.",
    promptSnippet: "refresh_workspace_index: rebuild workspace FTS indexing for the configured roots.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx?: ExtensionContext & WorkspaceSearchUiContext) {
      startWorkspaceSearchProgress(ctx, "Workspace search: refreshing index…");
      try {
        await refreshWorkspaceIndex({ scope: "all" });
      } finally {
        finishWorkspaceSearchProgress(ctx);
      }
      return {
        content: [{ type: "text", text: "Workspace index refreshed." }],
        details: { refreshed: true },
      };
    },
  });
};
