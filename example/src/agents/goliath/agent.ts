import { createAgent } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { appleContextOptions } from "../../../modules/goliath-context";
import { createLifecycleLogger, logTrace } from "./lifecycle/logging";
import { mockTools } from "./tools";
import { storage } from "@/storage/database";

// One definition serves every conversation; Goliath owns their separate memory and queues.
export const agent = createAgent({
  model: () => apple(),
  ...appleContextOptions(),
  tools: mockTools,
  memory: storage.memory,
  confirm: async () => false,
  extensions: [createLifecycleLogger()],
  onEvent: logTrace,
});

export const isGoliathAvailable = () => apple.isAvailable();
