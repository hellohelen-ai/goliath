import { Pressable, Text, View } from "react-native";
import { AgentMark, IconButton } from "@/ui/primitives";
import { styles } from "../home.styles";

export function ConversationHeader({
  onBack,
  onAbout,
}: {
  onBack: () => void;
  onAbout: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <IconButton name="chevron-back" label="Back to conversations" onPress={onBack} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="About Goliath"
        onPress={onAbout}
        style={({ pressed }) => [styles.agentPill, pressed && styles.pressed]}
      >
        <AgentMark small />
        <Text style={styles.agentName}>Goliath</Text>
      </Pressable>
    </View>
  );
}
