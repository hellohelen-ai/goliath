import { StyleSheet, View } from "react-native";
import Stone from "../../../website/src/assets/logo.svg";
import { colors } from "./theme";

export function AgentMark({
  small = false,
  online = false,
}: {
  small?: boolean;
  online?: boolean;
}) {
  const size = small ? 26 : 48;
  return (
    <View accessibilityElementsHidden style={[styles.frame, small && styles.small]}>
      <Stone width={size} height={size} color={colors.stone} />
      {online && <View style={styles.online} />}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 52, height: 54, alignItems: "center", justifyContent: "center" },
  small: { width: 26, height: 28 },
  online: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.green,
    borderWidth: 3,
    borderColor: colors.background,
  },
});
