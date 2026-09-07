import type { Agent, Confirm } from "@hellohelen-ai/goliath";

export type ApprovalRequest = Parameters<Confirm>[0];
type AskOptions = { onApproval?: (request: ApprovalRequest) => void };
type ActiveRun = {
  controller: AbortController;
  resolveApproval?: (approved: boolean) => void;
};

// Adapts the app's approval buttons and cancellation to a shared agent.
export function createAgentRuntime(agent: Agent) {
  const activeRuns = new Map<string, ActiveRun>();

  const ask = async (conversationId: string, text: string, options: AskOptions = {}) => {
    if (!text.trim()) throw new Error("Enter a message.");
    if (activeRuns.has(conversationId)) throw new Error("This conversation is already running.");
    const run: ActiveRun = { controller: new AbortController() };
    activeRuns.set(conversationId, run);
    try {
      return await agent.run(text.trim(), {
        conversationId,
        signal: run.controller.signal,
        confirm: (request) => {
          const onApproval = options.onApproval;
          if (!onApproval || run.controller.signal.aborted) return Promise.resolve(false);
          return new Promise<boolean>((resolve) => {
            run.resolveApproval = resolve;
            onApproval(request);
          });
        },
      });
    } finally {
      run.resolveApproval?.(false);
      if (activeRuns.get(conversationId) === run) activeRuns.delete(conversationId);
    }
  };

  const approve = (conversationId: string, approved: boolean) => {
    const run = activeRuns.get(conversationId);
    if (!run?.resolveApproval || run.controller.signal.aborted) return false;
    const resolve = run.resolveApproval;
    run.resolveApproval = undefined;
    resolve(approved);
    return true;
  };

  const cancel = (conversationId: string) => {
    const run = activeRuns.get(conversationId);
    if (!run) return;
    run.controller.abort();
    run.resolveApproval?.(false);
    run.resolveApproval = undefined;
  };

  const dispose = () => {
    for (const id of activeRuns.keys()) cancel(id);
    activeRuns.clear();
  };

  return { ask, approve, cancel, dispose };
}
