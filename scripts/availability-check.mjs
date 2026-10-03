const url = new URL(process.argv[2] ?? "");
if (url.protocol !== "https:" || url.username || url.password)
  throw new Error("Pass the public HTTPS origin.");
url.pathname = "/healthz";
url.search = "";
url.hash = "";
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) throw new Error("Health check failed.");
  process.stdout.write('{"available":true}\n');
} catch {
  process.stderr.write('{"available":false}\n');
  process.exitCode = 1;
}
