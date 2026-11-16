module.exports = ({ a, b }) => ({
  value: a + b,
  runtime: process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node",
});
