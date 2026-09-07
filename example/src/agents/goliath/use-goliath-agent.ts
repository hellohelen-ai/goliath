import { useEffect, useState } from "react";
import { createGoliathAgent, isGoliathAvailable } from "./agent";
import { createAgentRuntime } from "./runtime";

export function useGoliathAgent() {
  const [agent] = useState(() => createAgentRuntime(createGoliathAgent));

  useEffect(() => () => agent.dispose(), [agent]);

  return { ...agent, available: isGoliathAvailable() };
}
