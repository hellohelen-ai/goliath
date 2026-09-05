import { createAgent, type RunResult, type StepRecord } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { appleContextOptions } from "../modules/goliath-context";

import { completeTask, createTask, listTasks } from "@/tasks";

/** A write tool never runs until the person says yes. */
const askTheUser = (tool: string, input: unknown) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(tool, JSON.stringify(input, null, 2), [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Allow", onPress: () => resolve(true) },
    ]);
  });

export default function Home() {
  const [ask, setAsk] = useState("if I don't already have it, add call the dentist");
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = apple.isAvailable();

  const agent = useMemo(
    () =>
      createAgent({
        model: () => apple(),
        ...appleContextOptions(),
        tools: { listTasks, createTask, completeTask },
        confirm: ({ tool, input }) => askTheUser(tool, input),
        // No fallback here on purpose: this example is about what the phone
        // can finish on its own. Add one and escalation stops being visible.
      }),
    [],
  );

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await agent.run(ask));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  if (!available) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.heading}>No on-device model</Text>
        <Text style={styles.body}>
          Apple Intelligence is not available on this device. Goliath requires iOS 26 or later with
          Apple Intelligence enabled. The Simulator has no on-device model.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag">
        <TextInput
          style={styles.input}
          value={ask}
          onChangeText={setAsk}
          placeholder="Ask for something"
          multiline
        />

        <Pressable
          style={[styles.button, (running || ask.trim() === "") && styles.buttonDisabled]}
          onPress={run}
          disabled={running || ask.trim() === ""}
        >
          {running ? <ActivityIndicator /> : <Text style={styles.buttonText}>Run the turn</Text>}
        </Pressable>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        {result !== null && (
          <View style={styles.result}>
            <Text style={styles.answer}>
              {result.text || "I couldn’t finish this request. Try asking for one smaller step."}
            </Text>
            <Text style={styles.meta}>
              {result.handledBy === "device" ? "handled on device" : "escalated to the cloud"}
              {result.bestEffort === true ? " · best effort" : ""}
            </Text>
            {result.steps.map((step: StepRecord) => (
              <Text key={step.index} style={styles.step}>
                {step.index + 1}. {step.brief}
                {step.skipped === true ? " (skipped)" : ""}
                {step.cached === true ? " (cached)" : ""}
                {step.failed === true ? " (failed)" : ""}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 16 },
  heading: { fontSize: 20, fontWeight: "600", padding: 20, paddingBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, paddingHorizontal: 20, opacity: 0.7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8888",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 88,
  },
  button: {
    backgroundColor: "#111",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#b00020", fontSize: 14 },
  result: { gap: 8 },
  answer: { fontSize: 17, lineHeight: 24 },
  meta: { fontSize: 13, opacity: 0.6 },
  step: { fontSize: 13, opacity: 0.8, fontVariant: ["tabular-nums"] },
});
