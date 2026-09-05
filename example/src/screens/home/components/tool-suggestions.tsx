import { Pressable, Text } from "react-native";
import type { ToolSuggestion } from "@/tools/mock-tools";
import { colors, Icon, Sheet } from "@/ui/primitives";
import { styles } from "../home.styles";

type SuggestionProps = { suggestions: readonly ToolSuggestion[]; onChoose: (ask: string) => void };

export function ToolSuggestions({ suggestions, onChoose }: SuggestionProps) {
  return suggestions.map((suggestion) => (
    <Pressable
      key={suggestion.id}
      accessibilityLabel={suggestion.title}
      accessibilityRole="button"
      onPress={() => onChoose(suggestion.ask)}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <Icon name={suggestion.icon} size={21} color={colors.muted} />
      <Text style={styles.choiceText}>{suggestion.title}</Text>
      <Icon name="arrow-forward" size={17} color={colors.quiet} />
    </Pressable>
  ));
}

export function SuggestionSheet({
  visible,
  onClose,
  ...suggestions
}: SuggestionProps & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet title="Try asking" visible={visible} onClose={onClose}>
      <ToolSuggestions {...suggestions} />
    </Sheet>
  );
}
