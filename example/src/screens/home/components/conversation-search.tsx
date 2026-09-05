import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Conversation } from "@/types/conversation";
import { colors, Icon, IconButton } from "@/ui/primitives";
import { styles } from "../home.styles";
import { ConversationList } from "./conversation-list";

export function ConversationSearch({
  visible,
  query,
  onlyStarted,
  conversations,
  onChangeQuery,
  onToggleFilter,
  onClose,
  onOpen,
}: {
  visible: boolean;
  query: string;
  onlyStarted: boolean;
  conversations: Conversation[];
  onChangeQuery: (query: string) => void;
  onToggleFilter: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <View style={styles.searchToolbar}>
          <IconButton name="close" label="Close search" onPress={onClose} />
          <View style={styles.searchPill}>
            <Icon name="search-outline" color={colors.quiet} size={20} />
            <TextInput
              accessibilityLabel="Search conversations"
              autoFocus
              value={query}
              onChangeText={onChangeQuery}
              placeholder="Search"
              placeholderTextColor={colors.quiet}
              keyboardAppearance="dark"
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
          <IconButton
            name={onlyStarted ? "filter" : "filter-outline"}
            label={onlyStarted ? "Show all conversations" : "Show conversations with messages"}
            onPress={onToggleFilter}
          />
        </View>
        {onlyStarted && <Text style={styles.filterLabel}>With messages</Text>}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.inboxContent}
        >
          <ConversationList conversations={conversations} search onOpen={onOpen} />
          {conversations.length === 0 && <Text style={styles.empty}>No conversations found.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
