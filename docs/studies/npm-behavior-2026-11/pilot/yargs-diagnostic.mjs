if (Deno.args.includes("after-helper")) await import("yargs/helpers");

try {
  await import("yargs/browser");
  console.log(JSON.stringify({ imported: true }));
} catch (error) {
  console.log(
    JSON.stringify({ imported: false, name: error.name, code: error.code, message: error.message }),
  );
}
