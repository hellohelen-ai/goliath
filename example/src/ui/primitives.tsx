import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, PropsWithChildren } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "./theme";
export { colors } from "./theme";
export { AgentMark } from "./agent-mark";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({
  name,
  size = 23,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

export function IconButton({
  name,
  label,
  onPress,
  disabled = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.circle, (pressed || disabled) && styles.dim]}
    >
      <Icon name={name} />
    </Pressable>
  );
}

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
}>) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheet} edges={["bottom"]}>
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <IconButton name="close" label={`Close ${title}`} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 44,
    height: 44,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.control,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { opacity: 0.45 },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  title: { fontSize: 22, fontWeight: "600", color: colors.text },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
});
