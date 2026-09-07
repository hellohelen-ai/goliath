import { appStore } from "../stores/app-store";
import { createConversationPersistence } from "./conversation-persistence";
import { storage } from "./database";

export const appPersistence = createConversationPersistence(appStore, storage.conversations);
