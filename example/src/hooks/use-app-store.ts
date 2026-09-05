import { useStore } from "zustand";
import { appStore, type AppState } from "@/stores/app-store";

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
