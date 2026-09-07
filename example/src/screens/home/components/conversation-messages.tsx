import type { RefObject } from "react";
import { ScrollView, Text, View, type ScrollViewProps } from "react-native";
import type { Conversation } from "@/types/conversation";
import type { ToolSuggestion } from "@/agents/goliath";
import { styles } from "../home.styles";
import { MessageBubble } from "./message-bubble";
import { ToolSuggestions } from "./tool-suggestions";

export function ConversationMessages({
  chat,
  available,
  suggestions,
  transcriptRef,
  onScroll,
  onContentSizeChange,
  onChooseSuggestion,
  onConfirm,
}: {
  chat: Conversation;
  available: boolean;
  suggestions: readonly ToolSuggestion[];
  transcriptRef: RefObject<ScrollView | null>;
  onScroll: ScrollViewProps["onScroll"];
  onContentSizeChange: () => void;
  onChooseSuggestion: (ask: string) => void;
  onConfirm: (messageId: string, approved: boolean) => void;
}) {
  const date = new Date(chat.createdAt);
  return (
    <ScrollView
      ref={transcriptRef}
      style={styles.flex}
      contentContainerStyle={styles.messages}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={32}
      onContentSizeChange={onContentSizeChange}
    >
      <Text style={styles.date}>
        {date.toLocaleDateString([], { month: "short", day: "numeric" })} ·{" "}
        {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </Text>
      <View style={styles.assistantBubble}>
        <Text style={styles.messageText}>Hey — I’m Goliath.</Text>
        <Text style={styles.messageText}>
          I can help with your to-do list and notes. Add a task, search the sample docs, or save a
          note.
        </Text>
      </View>
      {chat.messages.length === 0 && (
        <View style={styles.assistantBubble}>
          <Text style={styles.messageText}>Where should we start?</Text>
          <Text style={styles.secondaryText}>I’ll ask before changing anything.</Text>
          <ToolSuggestions suggestions={suggestions} onChoose={onChooseSuggestion} />
        </View>
      )}
      {!available && (
        <View style={styles.assistantBubble}>
          <Text style={styles.messageText}>Apple Intelligence isn’t ready</Text>
          <Text style={styles.secondaryText}>
            Enable Apple Intelligence and download its models. In the simulator, the model comes
            from your Apple silicon Mac. Use compatible macOS and iOS versions, then reopen the app.
          </Text>
        </View>
      )}
      {chat.messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          onConfirm={(approved) => onConfirm(message.id, approved)}
          onRetry={
            message.status === "interrupted" && chat.messages[index - 1]?.role === "user"
              ? () => onChooseSuggestion(chat.messages[index - 1].text)
              : undefined
          }
        />
      ))}
    </ScrollView>
  );
}
