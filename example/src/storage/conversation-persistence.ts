import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { AppState } from "../stores/app-store";
import type { Conversation } from "../types/conversation";
import type { ConversationStorage } from "./sqlite-storage";
import { restoreConversations } from "./restore-conversations";

export function createConversationPersistence(
  app: StoreApi<AppState>,
  storage: ConversationStorage,
) {
  const state = createStore<{ hydrated: boolean; error: string | null }>(() => ({
    hydrated: false,
    error: null,
  }));
  const dirty = new Map<string, Conversation>();
  let pending: Promise<void> | undefined;
  let initialization: Promise<void> | undefined;

  const reportError = (error: unknown) => {
    console.error("Conversation storage failed", error);
    state.setState({ error: "Your chats couldn’t be saved or loaded. Please try again." });
  };

  const drain = () => {
    pending ??= (async () => {
      while (dirty.size) {
        const batch = [...dirty.values()];
        await storage.save(batch);
        for (const chat of batch) if (dirty.get(chat.id) === chat) dirty.delete(chat.id);
      }
    })()
      .catch(reportError)
      .finally(() => {
        pending = undefined;
        if (dirty.size && !state.getState().error) void drain();
      });
    return pending;
  };

  const initialize = () => {
    initialization ??= (async () => {
      try {
        state.setState({ error: null });
        const saved = await storage.load();
        const conversations = restoreConversations(
          saved.length ? saved : app.getState().conversations,
        );
        await storage.save(conversations);
        app.setState({ conversations });
        app.subscribe((next, previous) => {
          if (next.conversations === previous.conversations) return;
          const before = new Map(previous.conversations.map((chat) => [chat.id, chat]));
          for (const chat of next.conversations)
            if (before.get(chat.id) !== chat) dirty.set(chat.id, chat);
          if (!state.getState().error) void drain();
        });
        state.setState({ hydrated: true });
      } catch (error) {
        reportError(error);
        initialization = undefined;
      }
    })();
    return initialization;
  };

  const flush = async () => {
    if (!state.getState().hydrated) throw new Error("Your conversations are still loading.");
    while ((dirty.size || pending) && !state.getState().error) await drain();
    if (state.getState().error) throw new Error("Your conversation could not be saved.");
  };

  const retry = async () => {
    if (!state.getState().hydrated) return initialize();
    state.setState({ error: null });
    // flush follows any newer batch queued while an earlier write was settling.
    await flush().catch(() => {});
  };

  return { state, initialize, flush, retry };
}
