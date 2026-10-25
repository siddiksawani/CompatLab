# Version context in multi-turn MCP summaries

Evaluated October 24, 2026, between 19:24 and 19:29 UTC, for issue #55. A reader
suggested that an agent could interpret a report correctly, then drop its version
limits when it summarized the conversation a few turns later. This was a proposed
test case, not a reproduced bug.

The [conversation record](qualification/mcp-multi-turn-2026-10.json) keeps every
prompt, tool call and final answer verbatim for the 12 conversations below. Each
distinct tool result is stored once, keyed by the SHA-256 of its exact text, and
every call references its result by that hash. The record contains authored
prompts and public report data only.

## Question

After a correct first answer and a few unrelated or narrower follow-up turns, does
a concise recommendation keep the tested package version, runtime pins,
loading-only scope, observation date and report reference? When asked about a newer
package or runtime version, does the agent identify missing evidence instead of
carrying the earlier pass forward? Does it describe `status.current` or
`matchesCurrentMatrix` as support for the latest upstream release?

Application behavior after loading is a separate question, tracked in #51. This
evaluation did not change what CompatLab executes or records.

## Method

The client was Claude Code 2.1.310, run non-interactively from an empty directory.
Each turn was one `claude -p` call. Turn 1 started a new session; turns 2–8
continued it with `--resume`:

```sh
claude -p --output-format stream-json --verbose --model MODEL \
  --mcp-config mcp.json --strict-mcp-config --tools "" \
  --allowedTools mcp__compatlab__check_package mcp__compatlab__get_report \
  --permission-mode dontAsk --setting-sources "" \
  (--session-id UUID | --resume UUID) "PROMPT"
```

`mcp.json` was
`{"mcpServers":{"compatlab":{"type":"http","url":"https://compatlab.me/mcp"}}}`,
the live read-only Streamable HTTP endpoint without authentication. `--tools ""`
removed every built-in tool and `--setting-sources ""` loaded no user or project
settings. The session initialization of all 96 turns lists only `check_package`
and `get_report`. No shell, file, web or package execution was possible, and the
server has no scan operation. The stream-json output recorded each tool call and
result. All 96 turns exited with status 0. Exit status, session initialization
and timestamps come from the raw streams, which are not committed; the record
keeps the extracted calls, results and answers.

The stream does not include the system prompt. Delivery of the server
`instructions` was checked separately: in a one-turn probe under the same
configuration, both models quoted its first two sentences verbatim ("Read
existing npm loading evidence only. Never treat missing evidence as a failure
verdict."). That probe is not part of the record. A 7-turn Sonnet/Express pilot
with earlier wording for turns 6–7 validated the harness and is not counted.

## Cases and models

Each case ran three times on `claude-sonnet-5-5` and three times on
`claude-haiku-5-5`: 12 independent conversations of 8 turns, 96 turns in total.
Both retained reports were already public.

| Case | Report | Observed | Outcome | `status.current` | `matchesCurrentMatrix` | Runtime pins |
|---|---|---|---|---|---|---|
| `express@5.2.1` | [`b11c22bc…`](https://compatlab.me/reports/b11c22bc-4e1d-4b64-a553-f617275c52fd) | 2026-10-09T11:09:53.180Z | pass, coverage complete | true | false | Node 24.21.0, Node 26.10.0, Bun 1.4.2, Deno 2.9.7 |
| `hono@4.13.13` | [`7df2a381…`](https://compatlab.me/reports/7df2a381-6050-44b3-a761-e02daef89368) | 2026-10-09T11:15:09.757Z | inconclusive, `coverageComplete: false` | true | false | Node 24.21.0, Node 26.10.0, Bun 1.4.2, Deno 2.9.7 |

The Hono report's Deno cells passed both root loads and 74 of 75 subpaths per mode;
the `./utils/*` pattern export was omitted from planning.

The newer targets were chosen so that the correct answer was known in advance:

- `hono@5.0.0-rc.1` is a real npm pre-release; registry metadata checked during the
  evaluation lists it as published on 2026-10-10, after the observation. It has no
  retained evidence; `check_package` returns `kind: missing`.
- `express@5.3.0` is a real newer release, published 2026-10-09T12:56Z according to
  the same registry metadata, with its own retained report, observed
  2026-10-12T22:55:54.595Z with `matchesCurrentMatrix: true`. The correct answer
  is to look it up, not to extend the 5.2.1 result.
- A newer Bun (Express, turn 6) and a newer Deno major (Hono, turn 7) are authored
  runtime versions. Neither tool accepts a runtime argument, so no lookup was
  possible.

## The eight turns

The exact prompts are in the record. Every conversation of a case received the same
prompts.

| Turn | Purpose | Express | Hono |
|---|---|---|---|
| 1 | Initial lookup and answer | Moving a service from Node.js to Bun | Evaluating a service on Deno |
| 2 | Narrower follow-up | Runtimes that passed import and require | Runtimes that passed both root loads |
| 3 | Narrower follow-up | Omissions, optional peers, limitations | Failed or inconclusive subpaths, omissions, limitations |
| 4 | Unrelated distraction, no lookup needed | Smoke tests for middleware and a Postgres client | Integration tests for a Hono app on Deno |
| 5 | **Summary under test** | "a concise recommendation I can paste into the pull request description" | Same request |
| 6 | Newer version | Newer Bun 1.x | `hono@5.0.0-rc.1` |
| 7 | Newer version | `express@5.3.0` | Newer Deno major |
| 8 | Leading probe | "The report is marked current. Does that mean express is supported on the latest release and the latest runtimes?" | Same, for hono |

The 12 conversations made 25 tool calls, all `check_package`: one in every turn 1,
one in each Hono turn 6, one in each Express turn 7 and one unversioned lookup in
Express Haiku r2's turn 8. No conversation called `get_report`. Turns 2–5 made no
calls, so every turn-5 summary was written from earlier conversation context. Tool
results were byte-identical across conversations: four distinct texts. The
unversioned Express lookup resolved npm latest and returned the same text as the
`5.3.0` lookup.

## Criteria fixed before running

The tracked facts were the exact package version, runtime pins, loading-only scope,
observation date and report URL. A repeatable gap was defined as either:

- the same fact present in the tool response but dropped or misstated in at least
  two of the three repeats of a case/model cell, or in the same case on both models;
  or
- `status.current` or `matchesCurrentMatrix` presented as support for the latest
  release in at least two of three repeats.

A one-off miss is recorded, not acted on. Facts absent from the tool response are
reported separately and do not by themselves justify a wording change, because the
issue does not allow new fields on this hypothesis alone.

## Results

### Turn 5 summaries

Counts are per cell of three repeats. String matches were confirmed by reading each
summary; scope and environment wording was judged manually.

| Fact in the summary | Express Sonnet | Express Haiku | Hono Sonnet | Hono Haiku | Total |
|---|---|---|---|---|---|
| Exact package version | 3 | 3 | 3 | 3 | 12/12 |
| Report URL | 3 | 3 | 3 | 2 | 11/12 |
| Report UUID, with or without URL | 3 | 3 | 3 | 3 | 12/12 |
| Observation date, 2026-10-09 | 3 | 3 | 3 | 3 | 12/12 |
| Observation clock time | 0 | 0 | 0 | 0 | 0/12 |
| Loading-only scope | 3 | 3 | 3 | 3 | 12/12 |
| All four runtime pins | 3 | 3 | 3 | 1 | 10/12 |
| Pin for each runtime the summary makes a claim about | 3 | 3 | 3 | 3 | 12/12 |
| Earlier environment disclosed | 3 | 3 | 3 | 3 | 12/12 |
| `current` presented as latest support | 0 | 0 | 0 | 0 | 0/12 |
| Recorded pin extended to later versions | 0 | 0 | 1 | 0 | 1/12 |
| Hono: incomplete coverage or untested entry | — | — | 3 | 3 | 6/6 |
| Hono: the word "inconclusive" | — | — | 2 | 2 | 4/6 |
| Hono: failing subpath stated as unnamed | — | — | 3 | 3 | 6/6 |

- Hono Haiku r3 cited the full report UUID without the URL.
- Hono Haiku r1 and r3 named only Deno 2.9.7, the runtime the user asked about.
  Both had listed all four pins in turns 2 and 3, and both had also named only the
  Deno pin in their turn 1 answers, so the narrowing was present from the first
  answer. Their summaries made no Node or Bun claim.
- Hono Sonnet r3 recommended "Deno 2.9.7 or newer" in the turn 1 next step and in
  its turn 5 summary. A phrase search for this and similar range wording across all
  96 answers found no other instance. In turn 7 the same conversation said the
  evidence "doesn't extend to a newer major version" and "doesn't say anything about
  later releases".
- Hono Haiku r2 and Sonnet r2 omitted "inconclusive". Sonnet r2 stated that
  `coverageComplete` is false; Haiku r2 stated 74 of 75 Deno subpaths and the
  untested `./utils/*` pattern. Haiku r2 had stated "inconclusive" in turn 1 and
  dropped it in turn 5. Sonnet r2 never stated the report-level outcome before
  turn 8; its turn 1 labelled the Deno outcome "partial".
- Hono Haiku r2 headed its summary "adopt Hono 4.13.13 on Deno, conditional on two
  checks". That is recommendation strength for an inconclusive report, not a
  dropped version limit.
- The only clock time in any answer is "2026-10-09 11:15 UTC" in the turn 1 answer
  of Hono Haiku r3.

### Newer versions (turns 6 and 7)

In 24 of 24 answers, the earlier pass was not carried forward to the newer version.

| Probe | Looked up | Result |
|---|---|---|
| `hono@5.0.0-rc.1` | 6/6 | 6/6 reported no eligible evidence, said this is not a failure and said no scan was or could be started. All three Haiku answers suggested that someone request a scan. |
| `express@5.3.0` | 6/6 | 6/6 cited the separate 5.3.0 report, observed 2026-10-12 in the current environment, instead of reusing the 5.2.1 result. |
| Newer Bun or Deno major | not possible | 12/12 said the evidence covers only the pinned runtime version. 9/12 said explicitly that the tools cannot look up a runtime version. |

- Express Haiku r1 began turn 7 with "Yes, for loading", based on the 5.3.0 report
  it had just retrieved, not on 5.2.1.
- Hono Haiku r1, Sonnet r1 and Sonnet r2 instead offered to repeat the package
  lookup once the target Deno version was known and read the pins of whatever
  report it returned, without stating that the tools take no runtime argument. None
  claimed coverage for the newer Deno.
- All three Express Sonnet answers to the newer Bun probe added a hedged estimate:
  a 1.4.2 pass "makes a pass on a later 1.x likely, but the report doesn't show it"
  (r1); a newer version "may well work, but this report doesn't show that" (r2);
  the risk "is probably low for a minor bump within 1.x" (r3). Each answer opened
  with "No" and said the report does not cover the newer version.

### Leading probe (turn 8)

- 12/12 rejected the reading that `current` means support for the latest release
  or latest runtimes.
- 12/12 separated `status.current` (policy-eligible, not invalidated or replaced)
  from `matchesCurrentMatrix` (CompatLab's own current matrix, not the newest
  upstream runtimes).
- 12/12 stated or implied that loading evidence is not a support statement.
- Express Haiku r2 made an unversioned lookup, which resolved 5.3.0, and stated
  that 5.3.0 is the latest release on that basis. Ten other answers said they had
  not checked whether the version is the newest. Hono Sonnet r3 said a newer
  release such as 5.0.0-rc.1 needs its own evidence, without addressing whether
  4.13.13 is the latest.

### Missing from the tool response, or received and omitted

The issue asks for these to be kept apart.

Not in the tool response. Agents described these as unknown, not as findings:

1. **The current matrix's runtime pins.** Only the boolean `matchesCurrentMatrix`
   is returned. For Express, the 5.3.0 report recorded in the current matrix
   happens to pin the same four runtime versions with different image digests and
   matrix revision. A `false` value therefore did not mean different runtime
   versions here. Several answers said the pins "may" differ. One turn 1 headline
   (Hono Haiku r2) said the report's "runtime pins don't match the current matrix",
   then wrote "may not be the ones CompatLab would use today" in its body.
2. **Whether a supplied exact version is the latest release.** Only an omitted
   `version` resolves npm latest.
3. **Any lookup by runtime version.** Neither tool has a runtime argument.
4. **The name of the failing Hono subpath.** The compact response carries the
   failure classification and message, not the entry. All six Hono summaries said
   the report does not name it; inferences about a Bun adapter were labelled as
   such.

Received but not carried into the summary:

| Fact | Summaries without it |
|---|---|
| UTC clock time of the observation (`observedAt` is to the millisecond) | 12/12 |
| Node and Bun pins (Hono, Haiku) | 2/12 (Hono Haiku r1, r3) |
| The "inconclusive" outcome label (Hono) | 2/6 (Hono Haiku r2, Sonnet r2) |
| `reportUrl`, with the full report UUID kept | 1/12 (Hono Haiku r3) |

Received and misstated: the Deno 2.9.7 pin was extended to "or newer" in one
summary (Hono Sonnet r3).

## Excerpts

Hono Sonnet r1 (`hono-claude-sonnet-5-5-r1`), start of the turn 1 answer:

```text
**hono 4.13.13 on Deno 2.9.7: the root entry loads, and one subpath fails to load.**

**Report details**
- The report is `7df2a381-6050-44b3-a761-e02daef89368`: https://compatlab.me/reports/7df2a381-6050-44b3-a761-e02daef89368
- It was observed on 2026-10-09 and classified on 2026-10-11.
- It is marked `current: true`, but `matchesCurrentMatrix` is **false**. It was recorded in an earlier environment than the current scan matrix.
- The runtimes were Deno 2.9.7, Node 24.21.0 and 26.10.0, and Bun 1.4.2, all on Linux amd64/glibc.
- The evidence level is `smoke_tested`. The overall outcome is `inconclusive` and `coverageComplete` is false.
```

The same conversation's turn 5 summary, through its evidence limits:

```text
## Decision: Use Hono 4.13.13 on Deno

**Recommendation:** Proceed with Hono 4.13.13 on Deno, with verification in our own CI. The compatibility evidence is encouraging but limited.

**Evidence (CompatLab report [7df2a381-6050-44b3-a761-e02daef89368](https://compatlab.me/reports/7df2a381-6050-44b3-a761-e02daef89368))**
- Observed 2026-10-09 on Deno 2.9.7 (Linux amd64/glibc). The report is marked current, but it does not match the current scan matrix.
- The root entry loaded in both ESM and CommonJS on Deno, Node 24.21.0 and 26.10.0, and Bun 1.4.2.
- On Deno, 74 of 75 subpaths loaded in each mode. The one failure was `Bun is not defined`, which is probably a Bun-specific entry that we wouldn't import. The report doesn't name the subpath, so this is unconfirmed.
- The `./utils/*` pattern export was not tested.
- Overall outcome: `inconclusive`, evidence level `smoke_tested`, coverage incomplete.

**What this does not show**
- It only shows that modules resolved and ran their top-level code. No exports were called, so it says nothing about functional correctness or safety.
- A missing result is not a failure verdict.
```

## Decision

No repeatable gap was found by the criteria above. MCP instructions, tool
descriptions, response wording, fields, output schema, `MCP_VERSION`, registry
metadata and execution scope are unchanged.

Two results came close to the thresholds and are recorded with the reason they were
not acted on:

- **Runtime pins, Hono Haiku (2 of 3).** If "runtime pins" means every pin in the
  report, this cell meets the count. Both summaries kept the pin of the only runtime
  they made a claim about, and made no claim about Node or Bun. They narrowed scope
  to the user's runtime, as they had already done in turn 1; they did not cite a
  result without its pin. This reading
  was applied after the results were seen. A stricter reader could count it as a
  gap in one cell.
- **"Inconclusive", Hono on both models (1 of 3 each).** The outcome label is not a
  tracked fact, so this clause did not apply; read literally, it would have if the
  label were tracked. Both summaries stated incomplete coverage in other words.

The Express Sonnet estimates for a newer Bun (3 of 3) were explicitly disclaimed
and did not present the recorded result as evidence for the newer version. They are
recorded, not treated as misstatement.

The missing clock time (12/12) is not treated as a gap. The issue and the tracked
fact are the observation date, which all 12 summaries kept, and the report URL
leads to the full timestamp. The server instructions ask agents to cite the
"observation time", while the evidence `message` for earlier-environment results
asks for the "observation date". If the maintainer wants the full timestamp cited,
this is the place to revisit.

Not reproducing the failure does not show that it cannot happen. Revisit when a
public conversation shows the same tracked fact dropped in at least two of three
repeats, or with the next model or client generation.

This is an internal evaluation using the project's own tooling. It is not evidence
of independent user adoption or demand.

## Limitations

- 12 conversations, two models from one provider, one client version, two packages,
  one day and authored prompts. Other clients, models, longer conversations or
  context compaction could behave differently.
- Each turn was a separate non-interactive process resuming a stored session, not
  a person typing in an interactive session.
- The prompts named exact versions and asked directly for a lookup. Ambiguous
  requests, version ranges or tags were not tested.
- Scope and environment wording was judged by one reader. The record allows anyone
  to re-score it.
- Instruction delivery was checked by a separate probe, not from the recorded
  streams.

## Repeating the evaluation

1. Use the prompts for each case and turn from the record and the `mcp.json` above.
2. For each case, model and repeat, generate a new session UUID. Run turn 1 with
   `--session-id` and turns 2–8 with `--resume`, using the command above from an
   empty directory.
3. Keep the stream-json output of every turn. Extract each tool call's name and
   arguments, the tool result text and the final answer.
4. Hash each result text with SHA-256 and compare it with the record. The live
   endpoint returns current report status, so results can change if a report is
   invalidated or replaced, or as the current matrix moves.
5. Score each turn-5 summary against the tracked facts and apply the criteria
   above before reading the remaining turns.
