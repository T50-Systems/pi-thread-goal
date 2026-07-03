import { completeGoalEvaluation } from "./evaluator-adapter.js";
import type { GoalEvaluatorProvider } from "./evaluator-provider.js";

export function createPiEvaluatorProvider(): GoalEvaluatorProvider {
	return {
		complete(model, context, options) {
			return completeGoalEvaluation(model as never, context, options);
		},
	};
}

export const piEvaluatorProvider = createPiEvaluatorProvider();
