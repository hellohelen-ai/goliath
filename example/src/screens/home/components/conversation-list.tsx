import { Pressable, Text, View } from "react-native";
import type { Conversation } from "@/types/conversation";
import { AgentMark } from "@/ui/primitives";
import { styles } from "../home.styles";

export function ConversationList({
  conversations,
  available = false,
  search = false,
  onOpen,
}: {
  conversations: Conversation[];
  available?: boolean;
  search?: boolean;
  onOpen: (id: string) => void;
}) {
  return conversations.map((chat) => (
    <ConversationRow
      key={chat.id}
      chat={chat}
      available={available}
      search={search}
      onOpen={onOpen}
    />
  ));
}

function ConversationRow({
  chat,
  available,
  search,
  onOpen,
}: {
  chat: Conversation;
  available: boolean;
  search: boolean;
  onOpen: (id: string) => void;
}) {
  const preview =
    chat.messages.at(-1)?.text ||
    (chat.messages.length ? "Working on it…" : "Your tasks, a little more under control.");
  const time = new Date(chat.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open conversation: ${preview}`}
      onPress={() => onOpen(chat.id)}
      style={({ pressed }) => [styles.conversation, pressed && styles.pressed]}
    >
      <AgentMark online={available && !search} />
      <View style={styles.conversationCopy}>
        <View style={styles.row}>
          <Text style={styles.conversationTitle}>Goliath</Text>
          <Text style={styles.timestamp}>{search ? "Agent" : time}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}
