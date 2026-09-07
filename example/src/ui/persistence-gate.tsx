import type { PropsWithChildren } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppPersistence } from "@/hooks/use-app-persistence";
import { colors } from "./theme";

export function PersistenceGate({ children }: PropsWithChildren) {
  const { hydrated, error, retry } = useAppPersistence();
  return (
    <View style={styles.root}>
      {hydrated ? (
        children
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
          <Text style={styles.text}>Loading your conversations…</Text>
        </View>
      )}
      <Modal visible={error !== null} transparent animationType="fade">
        <View style={styles.center}>
          <Text accessibilityRole="alert" style={styles.text}>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.button}>
            <Text style={styles.text}>Try again</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 20,
    backgroundColor: colors.background,
  },
  text: { color: colors.text, fontSize: 16, textAlign: "center" },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: colors.control,
  },
});
