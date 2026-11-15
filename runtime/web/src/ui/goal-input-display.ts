const legacyGoalPrefixes = [
  ["Continue working toward the active thread goal.\n", "Continue goal", "objective"],
  ["The active thread goal objective was edited by the user.\n", "Goal updated", "untrusted_objective"],
  ["The active thread goal has reached its token budget.\n", "Goal budget reached", "objective"],
  ["The current Plan Sidebar checklist has no pending or in-progress items.\n", "Finalize goal", "objective"],
] as const;

/** Presentation only: accepted source text and model instructions stay intact. */
export function goalInputDisplayText(content: string): string {
  const compact = /^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(content);
  const legacy = legacyGoalPrefixes.find(([prefix]) => content.startsWith(prefix));
  if (!compact && !legacy) return content;
  const match = /\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(content);
  if (!match) return content;
  try {
    const identity = JSON.parse(match[1]!);
    if (!identity || Object.keys(identity).sort().join(",") !== "generation,goalId" ||
      typeof identity.goalId !== "string" || !identity.goalId.trim() || identity.goalId !== identity.goalId.trim() || identity.goalId.length > 256 ||
      !Number.isSafeInteger(identity.generation) || identity.generation < 1) return content;
    const body = content.slice(0, match.index);
    if (compact) return body;
    const [, reason, tag] = legacy!;
    const objective = new RegExp(`<${tag}>\n([\\s\\S]*?)\n</${tag}>`).exec(body)?.[1];
    if (objective === undefined) return content;
    const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", apos: "'" };
    return `🎯 ${reason}: ${objective.replace(/&(lt|gt|amp|quot|#39|apos);/g, (_, key: string) => entities[key]!)}`;
  } catch { return content; }
}
