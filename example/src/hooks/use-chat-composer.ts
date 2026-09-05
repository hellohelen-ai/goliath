import { useRef } from "react";
import {
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type TextInput,
} from "react-native";

export function useChatComposer({
  draft,
  running,
  available,
  onChangeDraft,
  onSend,
}: {
  draft: string;
  running: boolean;
  available: boolean;
  onChangeDraft: (draft: string) => void;
  onSend: (text: string) => void;
}) {
  const transcript = useRef<ScrollView>(null);
  const composer = useRef<TextInput>(null);
  const nearBottom = useRef(true);
  const canSend = available && !running && !!draft.trim();

  return {
    transcript,
    composer,
    canSend,
    onChooseSuggestion: (ask: string) => {
      onChangeDraft(ask);
      composer.current?.focus();
    },
    onSend: () => {
      if (!canSend) return;
      Keyboard.dismiss();
      nearBottom.current = true;
      onSend(draft);
    },
    onScroll: ({
      nativeEvent: { contentOffset, layoutMeasurement, contentSize },
    }: NativeSyntheticEvent<NativeScrollEvent>) => {
      nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
    },
    onContentSizeChange: () => {
      if (nearBottom.current) transcript.current?.scrollToEnd({ animated: true });
    },
  };
}
