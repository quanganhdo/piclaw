/** Existing widget contract for read-only native and imported history snapshots. */
import type { AgentControlResult } from '../agent-control-types.js';
import { getWidgetKindRenderer } from '../../channels/web/http/extension-routes.js';

/** Shared existing widget contract for read-only database histories. */
export function renderSessionTreeWidget(tree: import("../session-tree-snapshot.js").SessionTreeSnapshot, chatJid: string): AgentControlResult | null {
    const renderer = getWidgetKindRenderer("session_tree");
    if (renderer) {
      const html = renderer({ tree, chatJid });
      if (typeof html === "string" && html.trim()) {
        const widgetBlock = {
          type: "generated_widget",
          widget_id: `session-tree-${Date.now()}`,
          title: "Session Tree",
          subtitle: `${tree.total} ${tree.total === 1 ? "entry" : "entries"}`,
          description: "Inspect the invocation snapshot, navigate branches, or request a branch summary.",
          open_label: "Open tree viewer",
          auto_open: true,
          capabilities: ["interactive"],
          artifact: { kind: "html", html },
        };
        return { status: "success", message: "", contentBlocks: [widgetBlock] };
      }
    }

  return null;
}
