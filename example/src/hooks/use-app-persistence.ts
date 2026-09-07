import { useEffect } from "react";
import { useStore } from "zustand";
import { appPersistence } from "@/storage/app-persistence";

export function useAppPersistence() {
  const state = useStore(appPersistence.state);
  useEffect(() => {
    void appPersistence.initialize();
  }, []);
  return { ...state, retry: appPersistence.retry };
}
