import { Text, View } from "react-native";
import { AgentMark, Sheet } from "@/ui/primitives";
import { styles } from "../home.styles";

export function AboutAgent({
  visible,
  available,
  onClose,
}: {
  visible: boolean;
  available: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet title="Goliath" visible={visible} onClose={onClose}>
      <AgentMark />
      <Text style={styles.messageText}>A little help, right here.</Text>
      <Text style={styles.secondaryText}>
        An assistant for your tasks and notes, powered by Apple Intelligence. Conversations and
        notes stay on this device across launches. Demo tasks and scratch files reset when the app
        restarts.
      </Text>
      <View style={styles.infoCard}>
        <View style={styles.inline}>
          <View style={[styles.statusDot, !available && styles.offline]} />
          <Text style={styles.choiceText}>
            {available ? "Apple Intelligence available" : "Apple Intelligence unavailable"}
          </Text>
        </View>
        <Text style={styles.secondaryText}>
          Task and file changes always ask for your permission.
        </Text>
      </View>
    </Sheet>
  );
}
