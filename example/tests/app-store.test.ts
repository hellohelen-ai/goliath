import { describe, expect, test } from "bun:test";
import { createAppStore, selectFilteredConversations } from "../src/stores/app-store";

describe("example app state", () => {
  test("preserves each draft and routes background replies to their original conversation", () => {
    const store = createAppStore();
    const actions = store.getState();
    actions.setDraft("first", "List my tasks");
    actions.openConversation("first");
    const address = { conversationId: "first", messageId: "reply" };
    expect(actions.startTurn(address, "List my tasks")).toBe(true);

    const secondId = actions.newConversation();
    actions.openConversation(secondId);
    actions.setDraft(secondId, "Water the plants");
    const second = store.getState().conversations[0];
    actions.updateMessage(address, (message) => ({
      ...message,
      text: "Call the dentist",
      status: "completed",
    }));

    expect(store.getState().selectedId).toBe(secondId);
    expect(store.getState().conversations[0]).toBe(second);
    expect(second.draft).toBe("Water the plants");
    actions.openConversation("first");
    const first = store.getState().conversations.find(({ id }) => id === "first")!;
    expect(first.draft).toBe("");
    expect(first.messages.at(-1)).toMatchObject({ text: "Call the dentist", status: "completed" });
    actions.openConversation(secondId);
    expect(store.getState().conversations[0].draft).toBe("Water the plants");
  });

  test("rejects empty and duplicate sends while allowing independent conversations", () => {
    const store = createAppStore();
    const actions = store.getState();
    const address = { conversationId: "first", messageId: "reply" };
    actions.setDraft("first", "Keep this draft");
    expect(actions.startTurn(address, "  ")).toBe(false);
    expect(actions.startTurn({ ...address, conversationId: "missing" }, "Hello")).toBe(false);
    expect(store.getState().conversations[0].draft).toBe("Keep this draft");
    expect(actions.startTurn(address, "  Hello  ")).toBe(true);
    expect(actions.startTurn({ ...address, messageId: "duplicate" }, "Hello again")).toBe(false);
    expect(store.getState().conversations[0].messages).toHaveLength(2);
    expect(store.getState().conversations[0].messages[0].text).toBe("Hello");

    const secondId = actions.newConversation();
    expect(actions.startTurn({ conversationId: secondId, messageId: "other" }, "Hi")).toBe(true);
    actions.updateMessage(address, (message) => ({ ...message, status: "error" }));
    expect(actions.startTurn({ ...address, messageId: "retry" }, "Try again")).toBe(true);
  });

  test("searches sent content and combines the started filter with the query", () => {
    const store = createAppStore();
    const actions = store.getState();
    actions.startTurn({ conversationId: "first", messageId: "reply" }, "List my tasks");
    actions.updateMessage({ conversationId: "first", messageId: "reply" }, (message) => ({
      ...message,
      text: "Call the dentist",
      status: "completed",
    }));
    const secondId = actions.newConversation();
    actions.setDraft(secondId, "Unsent draft");
    actions.setQuery("  DENTIST  ");
    expect(selectFilteredConversations(store.getState()).map(({ id }) => id)).toEqual(["first"]);
    actions.setQuery("Unsent");
    expect(selectFilteredConversations(store.getState())).toEqual([]);
    actions.setQuery("Goliath");
    expect(selectFilteredConversations(store.getState())).toHaveLength(2);
    actions.toggleStartedFilter();
    expect(selectFilteredConversations(store.getState()).map(({ id }) => id)).toEqual(["first"]);
    actions.setSearching(true);
    actions.openConversation("missing");
    expect(store.getState().searching).toBe(true);
    actions.openConversation("first");
    expect(store.getState().searching).toBe(false);
  });
});
