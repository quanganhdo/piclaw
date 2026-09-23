/** Repository web URLs only: no credentials, query, fragment or executable scheme. */
export function normalizeProjectRepository(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new Error("Provide a GitHub/Gitea repository web URL.");
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || /[\\\s]/.test(raw)) throw new Error("Repository URL must use HTTP or HTTPS.");
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Repository URL cannot contain credentials, a query or a fragment.");
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(1);
  if (parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) throw new Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");
  const rawParts = raw.slice(raw.indexOf("://") + 3).split("/").slice(1);
  if (rawParts.some(part => part === "." || part === "..")) throw new Error("Repository URL cannot contain traversal segments.");
  if (parts.at(-1)!.endsWith(".git")) parts[parts.length - 1] = parts.at(-1)!.slice(0, -4);
  if (!parts.at(-1)) throw new Error("Repository name is required.");
  if (url.hostname.toLowerCase() === "github.com" && parts.length !== 2) throw new Error("GitHub repository URLs must end at github.com/owner/repository.");
  if (url.hostname.toLowerCase() !== "github.com" && parts.length !== 2 && parts.length !== 3) throw new Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");
  const reservedTail = new Set(["issues", "issue", "pulls", "pull", "explore", "src", "commits", "commit", "actions", "releases", "projects", "settings", "wiki", "compare", "branches", "tags", "milestones"]);
  const repository = parts.at(-1)!.toLowerCase();
  if (parts.some(part => reservedTail.has(part.toLowerCase())) || /^\d+$/.test(repository)) throw new Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");
  return `${url.origin}/${parts.join("/")}`;
}
