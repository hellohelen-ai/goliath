import { requireOptionalNativeModule } from "expo";
import type { GoliathConfig } from "@hellohelen-ai/goliath";

type NativeContext = {
  supportsTokenCounting(): boolean;
  contextSize(): Promise<number>;
  countTokens(text: string): Promise<number>;
};

const native = requireOptionalNativeModule<NativeContext>("GoliathContext");

/** Older OS versions keep the harness estimate. A supported counter failure is surfaced. */
export function appleContextOptions(): Pick<GoliathConfig, "window" | "countTokens"> {
  if (!native) return {};
  return {
    window: () => native.contextSize(),
    ...(native.supportsTokenCounting()
      ? { countTokens: (text: string) => native.countTokens(text) }
      : {}),
  };
}
