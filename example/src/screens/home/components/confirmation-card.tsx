import { Pressable, Text, View } from "react-native";
import type { ChatMessage } from "@/types/conversation";
import { colors, Icon } from "@/ui/primitives";
import { styles } from "../home.styles";

export function ConfirmationCard({
  confirmation,
  onConfirm,
}: {
  confirmation: NonNullable<ChatMessage["confirmation"]>;
  onConfirm: (approved: boolean) => void;
}) {
  return (
    <View style={styles.assistantBubble}>
      <Text style={styles.messageText}>
        {confirmation.tool === "createTask" ? "Add this task?" : "Mark this task done?"}
      </Text>
      <Text selectable style={styles.secondaryText}>
        {confirmationLabel(confirmation.input)}
      </Text>
      {confirmation.decision === undefined ? (
        <View style={styles.confirmRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onConfirm(false)}
            style={styles.cancelButton}
          >
            <Text style={styles.choiceText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onConfirm(true)}
            style={styles.allowButton}
          >
            <Text style={styles.allowText}>Allow</Text>
            <Icon name="checkmark" size={19} color={colors.green} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.inline}>
          <Icon
            name={confirmation.decision ? "checkmark-circle" : "close-circle-outline"}
            color={confirmation.decision ? colors.green : colors.muted}
            size={18}
          />
          <Text style={styles.secondaryText}>
            {confirmation.decision ? "Allowed" : "Cancelled"}
          </Text>
        </View>
      )}
    </View>
  );
}

function confirmationLabel(input: unknown) {
  if (input && typeof input === "object" && "title" in input && typeof input.title === "string")
    return input.title;
  return JSON.stringify(input, null, 2);
}
