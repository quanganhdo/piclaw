import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { formatSkillsForPrompt, loadProjectContextFiles, loadSkills } from "@earendil-works/pi-coding-agent";

/** Current host policy, not imported historical session state. No session, extension
 * reload, package discovery or tool activation is performed here. The caller owns
 * trust and the effective settings-derived skill paths (including package skills).
 * Deliberately not a legacy system-prompt clone: durable owns its own base prompt.
 */
export interface HostInstructionsOptions {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  additionalSkillPaths?: string[];
  noSkills?: boolean;
  /** The real channel appendix from buildChannelSystemPromptAppendix, if any. */
  channelAppendix?: string;
}

export function loadHostInstructions(options: HostInstructionsOptions): string {
  const { cwd, agentDir, projectTrusted } = options;
  if (!isAbsolute(cwd) || !isAbsolute(agentDir)) {
    throw new Error("Host instruction roots must be absolute");
  }
  const readPrompt = (name: string): string => {
    const project = join(cwd, ".pi", name);
    const profile = join(agentDir, name);
    const path = projectTrusted && existsSync(project) ? project : profile;
    return existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : "";
  };
  // Do not call the ancestry walker at all for an untrusted project: even
  // using agentDir as cwd would walk its parents and expose unrelated AGENTS.
  const context = projectTrusted ? loadProjectContextFiles({ cwd, agentDir }) :
    ["AGENTS.md", "CLAUDE.md"].flatMap(name => {
      const path = join(agentDir, name);
      return existsSync(path) ? [{ path, content: readFileSync(path, "utf8") }] : [];
    }).slice(0, 1);
  const skills = options.noSkills ? "" : formatSkillsForPrompt(loadSkills({
    cwd, agentDir, includeDefaults: false,
    skillPaths: [join(agentDir, "skills"),
      ...(projectTrusted ? [join(cwd, ".pi", "skills")] : []),
      ...(options.additionalSkillPaths ?? [])],
  }).skills, "indirect");
  return [
    readPrompt("SYSTEM.md"),
    readPrompt("APPEND_SYSTEM.md"),
    options.channelAppendix ?? "",
    context.length ? `<project_context>\n${context.map(({ path, content }) =>
      `<project_instructions path="${path}">\n${content}\n</project_instructions>`).join("\n\n")}\n</project_context>` : "",
    skills,
  ].filter(part => part.trim()).join("\n\n");
}
