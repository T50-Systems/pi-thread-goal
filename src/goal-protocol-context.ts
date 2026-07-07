export interface GoalProtocolContext {
	sessionId: string;
	branchId: string;
	actorId?: string;
}

export interface GoalProtocolContextSource {
	goalProtocol?: GoalProtocolContext;
}

export function goalProtocolContextKey(context: GoalProtocolContext): string {
	return JSON.stringify([
		context.sessionId,
		context.branchId,
		context.actorId ?? "default",
	]);
}

export function requireGoalProtocolContext(
	context: GoalProtocolContextSource,
): GoalProtocolContext {
	const protocol = context.goalProtocol;
	if (
		!protocol ||
		typeof protocol.sessionId !== "string" ||
		protocol.sessionId.trim().length === 0 ||
		typeof protocol.branchId !== "string" ||
		protocol.branchId.trim().length === 0 ||
		(protocol.actorId !== undefined && typeof protocol.actorId !== "string")
	) {
		throw new Error(
			"Goal protocol requires explicit sessionId and branchId context.",
		);
	}
	return protocol;
}
