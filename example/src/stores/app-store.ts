import { createStore } from "zustand/vanilla";
import type { ChatMessage, Conversation } from "../types/conversation";

export type MessageAddress = { conversationId: string; messageId: string };
export type HomeSheet = "about" | "suggestions" | null;

export type AppState = {
  conversations: Conversation[];
  selectedId: string | null;
  sheet: HomeSheet;
  searching: boolean;
  query: string;
  onlyStarted: boolean;
  newConversation: () => string;
  openConversation: (id: string) => void;
  closeConversation: () => void;
  setSheet: (sheet: HomeSheet) => void;
  setSearching: (searching: boolean) => void;
  setQuery: (query: string) => void;
  toggleStartedFilter: () => void;
  setDraft: (id: string, draft: string) => void;
  startTurn: (address: MessageAddress, ask: string) => boolean;
  updateMessage: (address: MessageAddress, update: (message: ChatMessage) => ChatMessage) => void;
};

const makeConversation = (id: string): Conversation => ({
  id,
  createdAt: Date.now(),
  messages: [],
  draft: "",
});

// Pure, in-memory state. Agent instances and pending native work stay in the runtime hook.
export function createAppStore() {
  let sequence = 0;
  return createStore<AppState>((set, get) => ({
    conversations: [makeConversation("first")],
    selectedId: null,
    sheet: null,
    searching: false,
    query: "",
    onlyStarted: false,
    newConversation: () => {
      const id = `chat-${Date.now()}-${++sequence}`;
      set(({ conversations }) => ({ conversations: [makeConversation(id), ...conversations] }));
      return id;
    },
    openConversation: (id) => {
      if (get().conversations.some((chat) => chat.id === id))
        set({ selectedId: id, searching: false });
    },
    closeConversation: () => set({ selectedId: null }),
    setSheet: (sheet) => set({ sheet }),
    setSearching: (searching) => set({ searching }),
    setQuery: (query) => set({ query }),
    toggleStartedFilter: () => set(({ onlyStarted }) => ({ onlyStarted: !onlyStarted })),
    setDraft: (id, draft) =>
      set(({ conversations }) => ({
        conversations: conversations.map((chat) => (chat.id === id ? { ...chat, draft } : chat)),
      })),
    startTurn: ({ conversationId, messageId }, ask) => {
      const chat = get().conversations.find(({ id }) => id === conversationId);
      if (!ask.trim() || !chat || chat.messages.some(({ status }) => status === "running"))
        return false;
      set(({ conversations }) => ({
        conversations: conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                draft: "",
                messages: [
                  ...item.messages,
                  { id: `${messageId}-user`, role: "user", text: ask.trim() },
                  { id: messageId, role: "assistant", text: "", status: "running" },
                ],
              }
            : item,
        ),
      }));
      return true;
    },
    updateMessage: ({ conversationId, messageId }, update) =>
      set(({ conversations }) => ({
        conversations: conversations.map((chat) =>
          chat.id === conversationId
            ? {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === messageId ? update(message) : message,
                ),
              }
            : chat,
        ),
      })),
  }));
}

export const appStore = createAppStore();

export function selectFilteredConversations({
  conversations,
  onlyStarted,
  query,
}: Pick<AppState, "conversations" | "onlyStarted" | "query">) {
  const search = query.toLowerCase().trim();
  return conversations.filter(
    (chat) =>
      (!onlyStarted || chat.messages.length > 0) &&
      `Goliath ${chat.messages.map(({ text }) => text).join(" ")}`.toLowerCase().includes(search),
  );
}
