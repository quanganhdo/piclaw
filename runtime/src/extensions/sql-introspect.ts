/**
 * sql-introspect – registers a read-only SQL tool for database introspection.
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { getDb } from "../db.js";
import { readAccessConfig } from "../core/config-access.js";

const SqlIntrospectSchema = Type.Object({
  query: Type.String({
    description: "Read-only SQLite query (SELECT/PRAGMA/WITH/EXPLAIN).",
  }),
  limit: Type.Optional(
    Type.Integer({
      description: "Max rows returned in details (default 200, max 1000).",
      minimum: 1,
      maximum: 1000,
    }),
  ),
});

function clampLimit(value: number | undefined, fallback = 200): number {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, 1), 1000);
}

function normalizeQuery(value: string): string {
  return String(value || "").trim().replace(/;+\s*$/g, "");
}

function isReadOnlyIntrospectionQuery(query: string): boolean {
  const text = query.trim();
  if (!text) return false;

  // Single statement only.
  if (text.includes(";")) return false;

  const head = text.toUpperCase();
  const allowedStart =
    head.startsWith("SELECT ")
    || head.startsWith("WITH ")
    || head.startsWith("PRAGMA ")
    || head.startsWith("EXPLAIN ");
  if (!allowedStart) return false;

  // Defensive deny-list for mutating SQL.
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
  if (forbidden.test(text)) {
    // Allow EXPLAIN ... which may include keywords in explained SQL.
    if (!head.startsWith("EXPLAIN ")) return false;
  }

  return true;
}

function safePreview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return "null";
    return text.length > 220 ? `${text.slice(0, 219)}…` : text;
  } catch {
    return String(value);
  }
}

const SQL_HINT = [
  "## Database Introspection",
  "Use introspect_sql for read-only SQLite introspection (tables/schema/rows).",
  "Only read-only SELECT/PRAGMA/WITH/EXPLAIN queries are allowed.",
].join("\n");

/** Extension factory that registers introspect_sql. */
export const sqlIntrospect: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${readAccessConfig().mode === "single-user" ? SQL_HINT : "## Database Introspection\nRaw SQL introspection is disabled in this access mode. Use owner-scoped message reads instead."}`,
  }));

  pi.registerTool({
    name: "introspect_sql",
    label: "introspect_sql",
    description: "Run read-only SQL against the messages database for introspection.",
    promptSnippet: "introspect_sql: Run read-only SELECT/PRAGMA/WITH/EXPLAIN SQL queries against SQLite.",
    parameters: SqlIntrospectSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      if (readAccessConfig().mode !== "single-user") return {
        content: [{ type: "text", text: "Raw SQL introspection is disabled in this access mode." }],
        details: { error: "access_denied", rows: [], count: 0, returned: 0, truncated: false },
      };
      const query = normalizeQuery(params.query);
      const limit = clampLimit(params.limit, 200);

      if (!query) {
        return {
          content: [{ type: "text", text: "Provide a SQL query." }],
          details: { query: "", count: 0, returned: 0, truncated: false, rows: [] },
        };
      }

      if (!isReadOnlyIntrospectionQuery(query)) {
        return {
          content: [{ type: "text", text: "Only read-only single-statement SELECT/PRAGMA/WITH/EXPLAIN queries are allowed." }],
          details: { query, count: 0, returned: 0, truncated: false, rows: [] },
        };
      }

      try {
        const db = getDb();
        const stmt = db.prepare(query);
        const rows = stmt.all() as Array<Record<string, unknown>>;
        const truncated = rows.length > limit;
        const sliced = rows.slice(0, limit);

        if (!sliced.length) {
          return {
            content: [{ type: "text", text: "Query executed successfully (0 rows)." }],
            details: { query, count: 0, returned: 0, truncated: false, rows: [] },
          };
        }

        const previewLines = sliced.slice(0, 5).map((row) => `• ${safePreview(row)}`);
        const header = truncated
          ? `Query returned ${rows.length} rows (showing first ${limit}).`
          : `Query returned ${rows.length} rows.`;

        return {
          content: [{ type: "text", text: `${header}\n${previewLines.join("\n")}` }],
          details: {
            query,
            count: rows.length,
            returned: sliced.length,
            truncated,
            rows: sliced,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message || "SQL query failed." }],
          details: { query, count: 0, returned: 0, truncated: false, rows: [] },
        };
      }
    },
  });
};
