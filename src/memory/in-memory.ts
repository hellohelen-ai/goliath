import type { Memory, MemoryState } from "../types.js";

const emptyMemory = (): MemoryState => ({ summary: "", recent: [] });

/** Memory that lives for the process. The default, and what tests use. */
const inMemory = (initial: MemoryState = emptyMemory()): Memory => {
  let state: MemoryState = { summary: initial.summary, recent: [...initial.recent] };
  return {
    load: async () => ({ summary: state.summary, recent: [...state.recent] }),
    save: async (next) => {
      state = { summary: next.summary, recent: [...next.recent] };
    },
  };
};

export { emptyMemory, inMemory };
