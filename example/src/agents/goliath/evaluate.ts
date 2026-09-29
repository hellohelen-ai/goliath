import { Platform } from "react-native";
import { apple } from "@react-native-ai/apple";
import { fixtures, runEvals } from "@hellohelen-ai/goliath/evals";
import { appleContextOptions } from "../../../modules/goliath-context";

/** Invoke explicitly from a development action. Tools and memory are disposable fixtures. */
export async function runAppleEvals(options: { device: string; signal?: AbortSignal }) {
  if (!apple.isAvailable())
    throw new Error("Enable Apple Intelligence before running device evals.");
  return runEvals({
    // One native model instance per generation, matching the chat agent's configuration.
    model: () => () => apple(),
    fixtures,
    runs: 3,
    ...appleContextOptions(),
    ...(options.signal ? { signal: options.signal } : {}),
    metadata: {
      device: options.device,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      provider: "@react-native-ai/apple",
      dataset: "goliath-default-v1",
      fallback: "scripted handoff acknowledgement; no cloud quality measured",
    },
  });
}
