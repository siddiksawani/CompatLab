# Published Study 2 evidence

`raw-results.json` contains the final 24-version run, including initial observations,
fresh-container replays, structured Mocha failures, completion records, preparation,
controls, image/runtime pins and bounded logs. `logTruncated` discloses shortened logs.
The final run has 189 runtime/case observations; replays and harness diagnostics are
nested evidence, not additional packages or observations in that denominator.

`results.csv` contains reviewed classifications for those 189 observations. The
[article summary](../../../../apps/web/src/content/npm-behavior-study-2026-11.json)
also includes every package row, suite scope and written findings. The input
[analysis](../analysis.json) records the reviewed explanation for every non-pass.
`replay_required` is the original runner label; it does **not** mean the retained
fresh-container replay is still outstanding. Reviewed classifications preserve that
raw label and reference its evidence.

`history/` retains the eleven-package verified pilot and the three expanded runs
that led to runner corrections. `supersededRuns` in the raw file records their
SHA-256 hashes and limitations. They are historical observations, not rows to pool
with the final run or use as additional independent packages. Earlier failed setup
attempts remain linked from the workflow history and initial pilot notes.

Regenerate the article data and CSV without executing any candidate package:

```sh
python3 docs/studies/npm-behavior-2026-11/publish.py
python3 docs/studies/npm-behavior-2026-11/publish.py --check
```

The validation checks the frozen cohort, lock, every primary root-import cell,
coverage totals, suite evidence, missing-completion and fail-first controls, all
non-pass annotations, replay commands, archive hashes and generated outputs.
`pnpm check` runs the consistency check. A new experiment needs a separately
reviewed analysis; it must not silently replace these findings.

See the [protocol](../README.md) for execution, reproduction and limits.
