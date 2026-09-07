import type { GoliathExtension, TraceEvent } from "@hellohelen-ai/goliath";

export function createLifecycleLogger(): GoliathExtension {
  const log = (conversationId: string | undefined, message: string) => {
    console.info(`[Goliath ${conversationId ?? "default"}] ${message}`);
  };

  return {
    name: "live-log",
    beforeRun: ({ conversationId }) => log(conversationId, "beforeRun"),
    afterRecall: ({ conversationId }) => log(conversationId, "afterRecall"),
    beforePlan: ({ conversationId, attempt }) =>
      log(conversationId, `beforePlan · attempt ${attempt}`),
    afterPlan: ({ conversationId, plan }) => log(conversationId, `afterPlan · ${plan.kind}`),
    beforeTool: ({ conversationId, tool }) => log(conversationId, `beforeTool · ${tool.name}`),
    afterTool: ({ conversationId, tool, outcome }) =>
      log(conversationId, `afterTool · ${tool.name} · ${outcome.status}`),
    beforeFallback: ({ conversationId }) => log(conversationId, "beforeFallback"),
    afterAnswer: ({ conversationId }) => log(conversationId, "afterAnswer"),
    beforeRemember: ({ conversationId }) => log(conversationId, "beforeRemember"),
    onError: ({ conversationId, origin }) => log(conversationId, `onError · ${origin}`),
    onFinish: ({ conversationId, outcome }) => log(conversationId, `onFinish · ${outcome.status}`),
  };
}

export function logTrace(event: TraceEvent) {
  console.info("[Goliath trace]", JSON.stringify(event));
}
