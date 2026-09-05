import { KeyboardAvoidingView, Platform } from "react-native";
import { useChatComposer } from "@/hooks/use-chat-composer";
import type { Conversation } from "@/types/conversation";
import type { ToolSuggestion } from "@/tools/mock-tools";
import { styles } from "../home.styles";
import { ConversationHeader } from "./conversation-header";
import { ConversationMessages } from "./conversation-messages";
import { MessageComposer } from "./message-composer";

export function ConversationView({
  chat,
  available,
  suggestions,
  onBack,
  onAbout,
  onSuggestions,
  onChangeDraft,
  onSend,
  onConfirm,
}: {
  chat: Conversation;
  available: boolean;
  suggestions: readonly ToolSuggestion[];
  onBack: () => void;
  onAbout: () => void;
  onSuggestions: () => void;
  onChangeDraft: (draft: string) => void;
  onSend: (text: string) => void;
  onConfirm: (messageId: string, approved: boolean) => void;
}) {
  const composer = useChatComposer({
    draft: chat.draft,
    running: chat.messages.some(({ status }) => status === "running"),
    available,
    onChangeDraft,
    onSend,
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ConversationHeader onBack={onBack} onAbout={onAbout} />
      <ConversationMessages
        chat={chat}
        available={available}
        suggestions={suggestions}
        transcriptRef={composer.transcript}
        onScroll={composer.onScroll}
        onContentSizeChange={composer.onContentSizeChange}
        onChooseSuggestion={composer.onChooseSuggestion}
        onConfirm={onConfirm}
      />
      <MessageComposer
        inputRef={composer.composer}
        draft={chat.draft}
        canSend={composer.canSend}
        onChangeDraft={onChangeDraft}
        onSend={composer.onSend}
        onSuggestions={onSuggestions}
      />
    </KeyboardAvoidingView>
  );
}
