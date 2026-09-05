import { ActivityIndicator, Text, View } from "react-native";
import type { ChatMessage } from "@/types/conversation";
import { colors, Icon } from "@/ui/primitives";
import { styles } from "../home.styles";
import { ConfirmationCard } from "./confirmation-card";

export function MessageBubble({
  message,
  onConfirm,
}: {
  message: ChatMessage;
  onConfirm: (approved: boolean) => void;
}) {
  return (
    <View style={styles.messageGroup}>
      {message.confirmation && (
        <ConfirmationCard confirmation={message.confirmation} onConfirm={onConfirm} />
      )}
      {message.status === "running" ? (
        <View accessibilityLiveRegion="polite" style={styles.working}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.secondaryText}>
            {message.confirmation?.decision === undefined && message.confirmation
              ? "Waiting for your permission"
              : "Working on it…"}
          </Text>
        </View>
      ) : (
        <View style={message.role === "user" ? styles.userBubble : styles.assistantBubble}>
          {message.result?.bestEffort && (
            <Text style={styles.caution}>Couldn’t complete every step</Text>
          )}
          {message.status === "error" && <Text style={styles.caution}>Something went wrong</Text>}
          <Text selectable style={styles.messageText}>
            {message.text}
          </Text>
        </View>
      )}
      {message.result && (
        <View style={styles.resultFootnote}>
          <Icon name="checkmark-circle-outline" color={colors.quiet} size={14} />
          <Text style={styles.footnote}>
            {message.result.handledBy === "device" ? "On-device" : "Cloud"} ·{" "}
            {message.result.steps.length} {message.result.steps.length === 1 ? "step" : "steps"}
          </Text>
        </View>
      )}
    </View>
  );
}
