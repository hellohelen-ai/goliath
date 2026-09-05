import type { RefObject } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Conversation } from "@/types/conversation";
import { Icon, IconButton } from "@/ui/primitives";
import { styles } from "../home.styles";
import { ConversationList } from "./conversation-list";

export function ConversationInbox({
  conversations,
  available,
  menuAnchor,
  onOpen,
  onAbout,
  onSearch,
  onNew,
}: {
  conversations: Conversation[];
  available: boolean;
  menuAnchor: RefObject<View | null>;
  onOpen: (id: string) => void;
  onAbout: () => void;
  onSearch: () => void;
  onNew: () => void;
}) {
  return (
    <>
      <View style={styles.inboxToolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="About Goliath"
          onPress={onAbout}
          style={styles.profile}
        >
          <Icon name="person-outline" size={22} color="#CDC7BA" />
        </Pressable>
        <View style={styles.flex} />
        <IconButton name="search-outline" label="Search conversations" onPress={onSearch} />
        <View ref={menuAnchor} collapsable={false}>
          <IconButton name="add" label="New conversation" onPress={onNew} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.inboxContent}>
        <ConversationList conversations={conversations} available={available} onOpen={onOpen} />
      </ScrollView>
    </>
  );
}
