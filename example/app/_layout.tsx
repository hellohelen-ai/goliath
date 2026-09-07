import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PersistenceGate } from "@/ui/persistence-gate";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <PersistenceGate>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#121212" } }}
        />
      </PersistenceGate>
    </>
  );
}
