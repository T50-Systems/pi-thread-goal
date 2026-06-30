import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommand } from "./commands.js";
import { registerGoalRuntime } from "./runtime.js";
import { registerGoalTools } from "./tools.js";

export { parseGoalCommand, handleGoalCommand, startGoal } from "./commands.js";
export { registerGoalRuntime, filterGoalContextMessages } from "./runtime.js";
export { registerGoalTools } from "./tools.js";
export { GOAL_CUSTOM_TYPE, createGoalStateSnapshot, loadGoalState, reduceGoalState, saveGoalState } from "./state.js";
export {
  GOAL_CONTEXT_CUSTOM_TYPE,
  renderGoalContext,
  renderGoalStartPrompt,
  renderGoalEvaluationPrompt,
  renderGoalContinuationPrompt,
  renderGoalCompactionSummary,
} from "./prompts.js";
export { applyGoalUi, renderGoalSummary, renderGoalStatusLine, renderGoalWidget } from "./ui.js";

export default function goalExtension(pi: ExtensionAPI): void {
  registerGoalCommand(pi);
  registerGoalTools(pi);
  registerGoalRuntime(pi);
}
