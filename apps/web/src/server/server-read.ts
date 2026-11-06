import { setTimeout as sleep } from "node:timers/promises";
import { createReadQueue, ReadBusy } from "./read-queue";

export function createServerRead(read: (path: string) => Promise<Response>) {
  const queue = createReadQueue<{ status: number; headers: Headers; body: string }>();
  return async (path: string): Promise<Response> => {
    try {
      const result = await queue(path, async () => {
        let response = await read(path);
        const delay = Number(response.headers.get("retry-after"));
        if (
          response.status === 503 &&
          delay >= 1 &&
          delay <= 2 &&
          (
            await response
              .clone()
              .json()
              .catch(() => null)
          )?.error === "busy"
        ) {
          await response.body?.cancel();
          await sleep(delay * 1000);
          response = await read(path);
        }
        return { status: response.status, headers: response.headers, body: await response.text() };
      });
      return new Response(result.body || null, { status: result.status, headers: result.headers });
    } catch (error) {
      if (!(error instanceof ReadBusy)) throw error;
      return new Response(JSON.stringify({ error: "busy" }), {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": "2",
        },
      });
    }
  };
}
