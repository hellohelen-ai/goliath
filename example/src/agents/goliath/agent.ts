import { createAgent, type Confirm } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { appleContextOptions } from "../../../modules/goliath-context";
import { createLifecycleLogger, logTrace } from "./lifecycle/logging";
import { mockTools } from "./tools";

// Create one instance per conversation so each agent owns its memory.
export function createGoliathAgent<C extends { conversationId: string }>(confirm: Confirm) {
  return createAgent<C>({
    model: () => apple(),
    ...appleContextOptions(),
    tools: mockTools,
    confirm,
    extensions: [createLifecycleLogger<C>()],
    onEvent: logTrace,
  });
}

export const isGoliathAvailable = () => apple.isAvailable();
