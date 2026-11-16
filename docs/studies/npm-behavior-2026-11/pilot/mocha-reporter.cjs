const { writeFileSync } = require("node:fs");
module.exports = class StudyReporter {
  constructor(runner) {
    const tests = [];
    for (const status of ["pass", "pending", "fail"]) {
      runner.on(status, (test, error) => {
        tests.push({
          title: test.fullTitle(),
          status,
          ...(error
            ? {
                message: String(error.message).slice(0, 1500),
                stack: String(error.stack).slice(0, 2000),
              }
            : {}),
        });
      });
    }
    runner.once("end", () => {
      const result = { schemaVersion: 1, stats: runner.stats, tests, truncated: false };
      while (Buffer.byteLength(JSON.stringify(result)) > 200000) {
        result.tests.pop();
        result.truncated = true;
      }
      writeFileSync("/results/suite.json", JSON.stringify(result));
      console.log(JSON.stringify({ stats: result.stats }));
    });
  }
};
