import { apple } from "@react-native-ai/apple";
import { useRef } from "react";
import { ActionSheetIOS, findNodeHandle, Keyboard, Platform, type View } from "react-native";
import { mockSuggestions } from "@/tools/mock-tools";
import { useShallow } from "zustand/react/shallow";
import { selectFilteredConversations } from "@/stores/app-store";
import { useAppStore } from "./use-app-store";
import { useConversations } from "./use-conversations";

export function useHomeScreen() {
  const { send, confirm } = useConversations();
  const state = useAppStore(
    useShallow((state) => ({
      conversations: state.conversations,
      selectedId: state.selectedId,
      sheet: state.sheet,
      searching: state.searching,
      query: state.query,
      onlyStarted: state.onlyStarted,
      setDraft: state.setDraft,
      newConversation: state.newConversation,
      openConversation: state.openConversation,
      closeConversation: state.closeConversation,
      setSheet: state.setSheet,
      setSearching: state.setSearching,
      setQuery: state.setQuery,
      toggleStartedFilter: state.toggleStartedFilter,
    })),
  );
  const {
    conversations,
    selectedId,
    sheet,
    searching,
    query,
    onlyStarted,
    setDraft,
    newConversation,
    openConversation,
    closeConversation,
    setSheet,
    setSearching,
    setQuery,
    toggleStartedFilter,
  } = state;
  const menuAnchor = useRef<View>(null);
  const available = apple.isAvailable();
  const chat = conversations.find(({ id }) => id === selectedId);

  const openChat = (id: string) => {
    Keyboard.dismiss();
    openConversation(id);
  };
  const startChat = () => openChat(newConversation());
  const showNewMenu = () => {
    if (Platform.OS !== "ios") return startChat();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["New conversation", "Cancel"],
        cancelButtonIndex: 1,
        userInterfaceStyle: "dark",
        anchor: findNodeHandle(menuAnchor.current) ?? undefined,
      },
      (index) => {
        if (index === 0) startChat();
      },
    );
  };
  const closeSheet = () => setSheet(null);
  const showAbout = () => setSheet("about");
  const changeDraft = (text: string) => {
    if (chat) setDraft(chat.id, text);
  };

  return {
    conversation: chat
      ? {
          chat,
          available,
          suggestions: mockSuggestions,
          onBack: () => {
            Keyboard.dismiss();
            closeConversation();
          },
          onAbout: showAbout,
          onSuggestions: () => setSheet("suggestions"),
          onChangeDraft: changeDraft,
          onSend: (text: string) => {
            if (available) void send(chat.id, text);
          },
          onConfirm: (messageId: string, approved: boolean) =>
            confirm(chat.id, messageId, approved),
        }
      : null,
    inbox: {
      conversations,
      available,
      menuAnchor,
      onOpen: openChat,
      onAbout: showAbout,
      onSearch: () => setSearching(true),
      onNew: showNewMenu,
    },
    search: {
      visible: searching,
      query,
      onlyStarted,
      conversations: selectFilteredConversations(state),
      onChangeQuery: setQuery,
      onToggleFilter: toggleStartedFilter,
      onClose: () => setSearching(false),
      onOpen: openChat,
    },
    about: { visible: sheet === "about", available, onClose: closeSheet },
    suggestions: {
      visible: sheet === "suggestions",
      suggestions: mockSuggestions,
      onClose: closeSheet,
      onChoose: (ask: string) => {
        changeDraft(ask);
        closeSheet();
      },
    },
  };
}
