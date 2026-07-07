import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommand } from "./commands.js";
import { registerGoalRuntime } from "./runtime.js";
import { registerGoalTools } from "./tools.js";

export { handleGoalCommand, parseGoalCommand, startGoal } from "./commands.js";
export { reduceGoalState } from "./goal-state.js";
export {
	createGoalStateSnapshot,
	GOAL_CUSTOM_TYPE,
	loadGoalState,
	saveGoalState,
} from "./goal-state-persistence.js";
export {
	GOAL_CONTEXT_CUSTOM_TYPE,
	renderGoalCompactionSummary,
	renderGoalContext,
	renderGoalContinuationPrompt,
	renderGoalEvaluationPrompt,
	renderGoalStartPrompt,
} from "./prompts.js";
export { filterGoalContextMessages, registerGoalRuntime } from "./runtime.js";
export { registerGoalTools } from "./tools.js";
export {
	applyGoalUi,
	isGoalWidgetExpanded,
	renderGoalOverlayLines,
	renderGoalStatusLine,
	renderGoalSummary,
	renderGoalWidget,
	setGoalWidgetExpanded,
	showGoalOverlay,
	toggleGoalWidgetExpanded,
} from "./ui.js";

export default function goalExtension(pi: ExtensionAPI): void {
	registerGoalCommand(pi);
	registerGoalTools(pi);
	registerGoalRuntime(pi);
}
