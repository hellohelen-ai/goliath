import { SafeAreaView } from "react-native-safe-area-context";
import { useHomeScreen } from "@/hooks/use-home-screen";
import { AboutAgent } from "./components/about-agent";
import { ConversationInbox } from "./components/conversation-inbox";
import { ConversationSearch } from "./components/conversation-search";
import { ConversationView } from "./components/conversation-view";
import { SuggestionSheet } from "./components/tool-suggestions";
import { styles } from "./home.styles";

export function HomeScreen() {
  const home = useHomeScreen();

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      {home.conversation ? (
        <ConversationView key={home.conversation.chat.id} {...home.conversation} />
      ) : (
        <ConversationInbox {...home.inbox} />
      )}
      <ConversationSearch {...home.search} />
      <AboutAgent {...home.about} />
      <SuggestionSheet {...home.suggestions} />
    </SafeAreaView>
  );
}
