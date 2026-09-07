import type { Agent, Confirm } from "@hellohelen-ai/goliath";

export type AgentContext = { conversationId: string };
export type ApprovalRequest = Parameters<Confirm>[0];
type AskOptions = { onApproval?: (request: ApprovalRequest) => void };
type ActiveRun = AskOptions & {
  controller: AbortController;
  resolveApproval?: (approved: boolean) => void;
};
type Session = { agent: Agent<AgentContext>; run?: ActiveRun };

// Owns agent memory and pending work; knows nothing about React, messages, or Zustand.
export function createAgentRuntime(buildAgent: (confirm: Confirm) => Agent<AgentContext>) {
  const sessions = new Map<string, Session>();

  const ask = async (conversationId: string, text: string, options: AskOptions = {}) => {
    if (!text.trim()) throw new Error("Enter a message.");
    let session = sessions.get(conversationId);
    if (!session) {
      const agent = buildAgent((request) => {
        const run = session?.run;
        const onApproval = run?.onApproval;
        if (!run || !onApproval || run.controller.signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          run.resolveApproval = resolve;
          onApproval(request);
        });
      });
      session = { agent };
      sessions.set(conversationId, session);
    }
    if (session.run) throw new Error("This conversation is already running.");
    const run: ActiveRun = { ...options, controller: new AbortController() };
    session.run = run;
    try {
      return await session.agent.run(text.trim(), {
        context: { conversationId },
        signal: run.controller.signal,
      });
    } finally {
      run.resolveApproval?.(false);
      session.run = undefined;
    }
  };

  const approve = (conversationId: string, approved: boolean) => {
    const run = sessions.get(conversationId)?.run;
    if (!run?.resolveApproval || run.controller.signal.aborted) return false;
    const resolve = run.resolveApproval;
    run.resolveApproval = undefined;
    resolve(approved);
    return true;
  };

  const cancel = (conversationId: string) => {
    const run = sessions.get(conversationId)?.run;
    if (!run) return;
    run.controller.abort();
    run.resolveApproval?.(false);
    run.resolveApproval = undefined;
  };

  const dispose = () => {
    for (const id of sessions.keys()) cancel(id);
    sessions.clear();
  };

  return { ask, approve, cancel, dispose };
}
