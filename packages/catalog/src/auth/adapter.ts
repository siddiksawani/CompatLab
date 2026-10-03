import { AsyncLocalStorage } from "node:async_hooks";
import type { DBAdapter } from "better-auth";
import { PublicRequestError } from "../public/security.js";

export const refreshFence = new AsyncLocalStorage<{
  id: string;
  accessToken: string;
  refreshToken: string | null;
}>();

export function fenceTokenRefresh(adapter: DBAdapter): DBAdapter {
  return {
    ...adapter,
    async update<T>(input: Parameters<DBAdapter["update"]>[0]): Promise<T | null> {
      const fence = refreshFence.getStore();
      if (!fence || input.model !== "account") return adapter.update<T>(input);
      const updated = await adapter.update<T>({
        ...input,
        where: [
          ...input.where,
          { field: "id", value: fence.id },
          { field: "accessToken", value: fence.accessToken },
          { field: "refreshToken", value: fence.refreshToken },
        ],
      });
      if (!updated) throw new PublicRequestError(409, "credentials_changed_retry");
      return updated;
    },
  };
}
