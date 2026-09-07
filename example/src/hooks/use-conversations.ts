import { useRef } from "react";
import { useGoliathAgent } from "@/agents/goliath";
import { appStore } from "@/stores/app-store";
import { appPersistence } from "@/storage/app-persistence";

export function useConversations() {
  const agent = useGoliathAgent();
  const sequence = useRef(0);
  const { startTurn, completeTurn, failTurn, requestApproval, recordApproval } =
    appStore.getState();

  const send = async (conversationId: string, text: string) => {
    const messageId = `message-${Date.now()}-${++sequence.current}`;
    const message = { conversationId, messageId };
    if (!startTurn(message, text)) return;

    try {
      await appPersistence.flush();
      const result = await agent.ask(conversationId, text, {
        onApproval: (request) => requestApproval(message, request),
      });
      completeTurn(message, result);
    } catch (error) {
      failTurn(message, error);
    }
  };

  const confirm = async (conversationId: string, messageId: string, approved: boolean) => {
    const chat = appStore.getState().conversations.find(({ id }) => id === conversationId);
    const message = chat?.messages.find(({ id }) => id === messageId);
    if (
      message?.status !== "running" ||
      !message.confirmation ||
      message.confirmation.decision !== undefined
    )
      return;
    recordApproval({ conversationId, messageId }, approved);
    try {
      await appPersistence.flush();
      agent.approve(conversationId, approved);
    } catch {
      recordApproval({ conversationId, messageId }, false);
      agent.approve(conversationId, false);
    }
  };

  return { send, confirm, available: agent.available };
}
