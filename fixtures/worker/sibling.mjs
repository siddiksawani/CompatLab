import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

writeFileSync("/tmp/sibling-secret", "private sibling data");
createServer((socket) => socket.end("sibling")).listen(34567, "127.0.0.1", () =>
  writeFileSync("/output/ready", "ready"),
);
