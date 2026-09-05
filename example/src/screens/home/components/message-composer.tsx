import type { RefObject } from "react";
import { Pressable, TextInput, View } from "react-native";
import { colors, Icon, IconButton } from "@/ui/primitives";
import { styles } from "../home.styles";

export function MessageComposer({
  inputRef,
  draft,
  canSend,
  onChangeDraft,
  onSend,
  onSuggestions,
}: {
  inputRef: RefObject<TextInput | null>;
  draft: string;
  canSend: boolean;
  onChangeDraft: (draft: string) => void;
  onSend: () => void;
  onSuggestions: () => void;
}) {
  return (
    <View style={styles.composerBar}>
      <IconButton name="add" label="Suggested requests" onPress={onSuggestions} />
      <View style={styles.composerPill}>
        <TextInput
          ref={inputRef}
          accessibilityLabel="Message Goliath"
          placeholder="Ask Goliath"
          placeholderTextColor={colors.quiet}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          keyboardAppearance="dark"
          style={styles.composerInput}
          maxLength={4000}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          hitSlop={6}
          disabled={!canSend}
          onPress={onSend}
          style={[styles.send, !canSend && styles.sendDisabled]}
        >
          <Icon name="arrow-up" size={23} color={canSend ? colors.background : colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}
