import { openDatabaseAsync } from "expo-sqlite";
import { createSqliteStorage } from "./sqlite-storage";

let connection: ReturnType<typeof openDatabaseAsync> | undefined;

export const storage = createSqliteStorage(() => {
  connection ??= openDatabaseAsync("goliath.db").catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
});
