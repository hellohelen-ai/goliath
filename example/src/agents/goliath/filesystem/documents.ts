// App-owned reference content is available immediately, without a database seed step.
export const documents = {
  "/guide.md": [
    "# Goliath example",
    "Use glob to discover paths, grep to find literal text, and readFile to read excerpts.",
    "Continue with nextCursor when a response has more results.",
    "",
    "## Storage",
    "/docs contains read-only documents shipped with this app.",
    "/notes contains notes saved on this device across conversations and app launches.",
    "Other paths are temporary scratch files for the current conversation.",
    "Scratch files and demo tasks reset when the app restarts.",
    "",
    "## Writing",
    "The app asks before creating or editing a file.",
    "Read an existing file first to get its revision before replacing or editing it.",
    "You cannot write to /docs.",
  ].join("\n"),
  "/garden.md": [
    "# Garden notes",
    "Water the basil on Tuesday and Friday.",
    "Keep the rosemary near a sunny window.",
    "The spare watering can is in the shed.",
    ...Array.from({ length: 40 }, (_, i) => `Week ${i + 1}: check soil moisture before watering.`),
    "The greenhouse access code is BLUEBELL.",
  ].join("\n"),
};
