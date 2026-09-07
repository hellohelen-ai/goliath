import { useEffect, useState } from "react";
import { agent as goliath, isGoliathAvailable } from "./agent";
import { createAgentRuntime } from "./runtime";

export function useGoliathAgent() {
  const [agent] = useState(() => createAgentRuntime(goliath));

  useEffect(() => () => agent.dispose(), [agent]);

  return { ...agent, available: isGoliathAvailable() };
}
