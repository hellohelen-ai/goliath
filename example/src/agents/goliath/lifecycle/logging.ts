import type { GoliathExtension, TraceEvent } from "@hellohelen-ai/goliath";

export function createLifecycleLogger<C extends { conversationId: string }>(): GoliathExtension<C> {
  const log = (context: { readonly conversationId: string }, message: string) => {
    console.info(`[Goliath ${context.conversationId}] ${message}`);
  };

  return {
    name: "live-log",
    beforeRun: ({ context }) => log(context, "beforeRun"),
    afterRecall: ({ context }) => log(context, "afterRecall"),
    beforePlan: ({ context, attempt }) => log(context, `beforePlan · attempt ${attempt}`),
    afterPlan: ({ context, plan }) => log(context, `afterPlan · ${plan.kind}`),
    beforeTool: ({ context, tool }) => log(context, `beforeTool · ${tool.name}`),
    afterTool: ({ context, tool, outcome }) =>
      log(context, `afterTool · ${tool.name} · ${outcome.status}`),
    beforeFallback: ({ context }) => log(context, "beforeFallback"),
    afterAnswer: ({ context }) => log(context, "afterAnswer"),
    beforeRemember: ({ context }) => log(context, "beforeRemember"),
    onError: ({ context, origin }) => log(context, `onError · ${origin}`),
    onFinish: ({ context, outcome }) => log(context, `onFinish · ${outcome.status}`),
  };
}

export function logTrace(event: TraceEvent) {
  console.info("[Goliath trace]", JSON.stringify(event));
}
