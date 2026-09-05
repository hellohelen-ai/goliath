import { createAgent, type Agent } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { useEffect, useRef } from "react";

import { appleContextOptions } from "../../modules/goliath-context";
import { mockTools } from "@/tools/mock-tools";
import { appStore, type MessageAddress } from "@/stores/app-store";

type RunContext = MessageAddress;

export function useConversations() {
  const { updateMessage, startTurn } = appStore.getState();
  const agents = useRef(new Map<string, Agent<RunContext>>());
  const controllers = useRef(new Map<string, AbortController>());
  const confirmations = useRef(new Map<string, (approved: boolean) => void>());
  const sequence = useRef(0);
  const activeRuns = useRef(new Map<string, RunContext>());

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      for (const resolve of confirmations.current.values()) resolve(false);
    },
    [],
  );

  const getAgent = (conversationId: string) => {
    const existing = agents.current.get(conversationId);
    if (existing) return existing;
    const log = (context: RunContext, message: string) => {
      console.info(`[Goliath ${context.conversationId}] ${message}`);
    };
    // Each conversation owns an agent and its memory. Demo tasks are shared.
    const agent = createAgent<RunContext>({
      model: () => apple(),
      ...appleContextOptions(),
      tools: mockTools,
      confirm: ({ tool, input }) => {
        const context = activeRuns.current.get(conversationId)!;
        updateMessage(context, (message) => ({ ...message, confirmation: { tool, input } }));
        return new Promise<boolean>((resolve) => {
          confirmations.current.set(context.messageId, resolve);
        });
      },
      extensions: [
        {
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
        },
      ],
    });
    agents.current.set(conversationId, agent);
    return agent;
  };

  const confirm = (conversationId: string, messageId: string, approved: boolean) => {
    const resolve = confirmations.current.get(messageId);
    if (!resolve) return;
    confirmations.current.delete(messageId);
    updateMessage({ conversationId, messageId }, (message) => ({
      ...message,
      confirmation: message.confirmation
        ? { ...message.confirmation, decision: approved }
        : undefined,
    }));
    resolve(approved);
  };

  const send = async (conversationId: string, text: string) => {
    const ask = text.trim();
    if (!ask || controllers.current.has(conversationId)) return;
    const messageId = `message-${Date.now()}-${++sequence.current}`;
    const context = { conversationId, messageId };
    if (!startTurn(context, ask)) return;
    const controller = new AbortController();
    controllers.current.set(conversationId, controller);
    activeRuns.current.set(conversationId, context);
    try {
      const result = await getAgent(conversationId).run(ask, {
        context,
        signal: controller.signal,
        onEvent: (event) => {
          console.info("[Goliath trace]", JSON.stringify(event));
        },
      });
      updateMessage(context, (message) => ({
        ...message,
        result,
        status: "completed",
        text: result.text || "I couldn’t finish this request. Try asking for one smaller step.",
      }));
    } catch (error) {
      updateMessage(context, (message) => ({
        ...message,
        status: "error",
        text: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      controllers.current.delete(conversationId);
      activeRuns.current.delete(conversationId);
      confirmations.current.delete(messageId);
    }
  };

  return { send, confirm };
}
