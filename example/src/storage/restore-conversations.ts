import type { Conversation } from "../types/conversation";

// Restoring a transcript never resumes a tool or revives an approval promise.
export function restoreConversations(conversations: Conversation[]): Conversation[] {
  return conversations.map((chat) => ({
    ...chat,
    messages: chat.messages.map((message) =>
      message.status === "running"
        ? {
            ...message,
            status: "interrupted",
            text: "This request was interrupted when the app closed. You can send it again. Some steps may already have finished.",
            confirmation: message.confirmation
              ? {
                  ...message.confirmation,
                  decision: message.confirmation.decision ?? false,
                }
              : undefined,
          }
        : message,
    ),
  }));
}
