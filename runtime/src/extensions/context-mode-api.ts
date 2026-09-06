/**
 * extensions/context-mode-api.ts – Stable extension-facing API for context-mode helpers.
 *
 * Provides a narrow, documented import surface for `extensions/integrations/context-mode.ts`
 * so extension code does not reach into multiple internal module paths.
 */

export {
  createBatchExecTool,
  createToolOutputSearchTool,
} from "../tools/context-tools.js";

export { canUseLegacyToolOutput, createToolOutputAccessGuard, ToolOutputAccessDenied } from "../core/tool-output-access.js";

export {
  buildPreview,
  readToolOutputFile,
  saveToolOutput,
  startToolOutputCleanup,
} from "../tool-output.js";

export {
  getToolResultCompactionEnabled,
  getToolResultCompactionThresholdsByTool,
  getToolResultCompactionTools,
  getToolResultSemanticSummaryConfig,
} from "../core/config.js";
