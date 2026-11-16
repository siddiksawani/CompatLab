"""Rebuild the article tables and CSV from retained observations and reviewed analysis."""
import csv
import argparse
import hashlib
import io
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[2]
SUMMARY = REPOSITORY / "apps/web/src/content/npm-behavior-study-2026-11.json"
PROFILES = ("node", "bun", "deno")
COLUMNS = (
    "package", "version", "tier", "runtime", "runtimeVersion", "status", "classification",
    "exitCode", "timedOut", "testCount", "skippedCount", "replayExitCode", "completionValid", "sourceCommit", "runUrl",
)


def key(row):
    return "/".join(row[field] for field in ("package", "tier", "runtime"))


def passed(row):
    return row["status"] == "pass" and row["exitCode"] == 0 and not any(
        row[field] for field in ("timedOut", "outOfMemory", "containerError")
    ) and (not row["completionRequired"] or row["completionValid"])


def build(check=False):
    evidence = json.loads((ROOT / "results/raw-results.json").read_text())
    analysis = json.loads((ROOT / "analysis.json").read_text())
    followup = runpy.run_path(str(ROOT / "followup/verify.py"))["verify"]()
    assert followup == analysis["denoFollowup"]["totals"]
    cohort = json.loads((ROOT / "cohort.json").read_text())["packages"]
    run = next(row for row in evidence["runs"] if row["sourceCommit"] == analysis["sourceCommit"])
    assert run.get("completedAt") and not run.get("infrastructureError")
    assert hashlib.sha256((ROOT / "pilot/package-lock.json").read_bytes()).hexdigest() == run["lockSha256"]
    assert len(run["preparation"]) == 5
    for preparation in run["preparation"]:
        assert preparation["exitCode"] == 0 and not preparation["timedOut"] and not preparation["outOfMemory"]
        assert not preparation["containerError"] and preparation.get("hookObserved", True)
    assert len(cohort) == len({row["name"] for row in cohort}) == 24
    assert hashlib.sha256((ROOT / "cohort.json").read_bytes()).hexdigest() == analysis["cohortSha256"]
    assert run["shellFailFast"]["exitCode"] == 23
    assert "later-suite-command-ran" not in run["shellFailFast"]["stdoutAndStderr"]
    assert len(run["missingCompletionControls"]) == 3
    for control in run["missingCompletionControls"]:
        assert control["exitCode"] == 0 and control["completion"] is None
    for historic in evidence["supersededRuns"]:
        archived = (ROOT / "results" / historic["file"]).read_bytes()
        assert hashlib.sha256(archived).hexdigest() == historic["sha256"]
        assert json.loads(archived)["sourceCommit"] == historic["sourceCommit"]
    assert len(run["results"]) == analysis["expectedObservations"]
    rows = {key(row): row for row in run["results"]}
    assert len(rows) == len(run["results"])
    assert {row["package"] for row in rows.values()} == {row["name"] for row in cohort}
    for package in cohort:
        assert run["versions"][package["name"]] == package["version"]
        for profile in PROFILES:
            assert f"{package['name']}/root_import/{profile}" in rows
    notes = analysis["nonPasses"]
    assert set(notes) == {name for name, row in rows.items() if not passed(row)}, "Every non-pass needs a reviewed explanation"
    observations = []
    for name, row in rows.items():
        assert row["network"] == "none"
        success = passed(row)
        if row.get("suiteResult"):
            assert row["suiteResultError"] is None
            assert not row["suiteResult"]["truncated"], f"Incomplete structured suite: {name}"
        if success and row["tier"].startswith("upstream_"):
            assert row["suiteCommandsReported"] == (2 if row["package"] in ("pump", "import-fresh") else 1)
            if row["package"] != "pump":
                assert row["testCount"] > 0
            if row.get("suiteResult"):
                assert row["suiteResult"]["stats"]["failures"] == 0
        if not success:
            assert row.get("replay"), f"Missing fresh replay: {name}"
            assert row["replay"]["network"] == "none" and row["replay"]["command"] == row["command"]
        replay = row.get("replay", {})
        observation = {
            "package": row["package"], "version": row["version"], "tier": row["tier"],
            "runtime": row["runtime"], "runtimeVersion": row["runtimeVersion"],
            "status": "pass" if success else notes[name]["status"],
            "classification": "pass" if success else notes[name]["classification"],
            "explanation": "The listed case completed." if success else notes[name]["explanation"],
            "rawStatus": row["status"], "exitCode": row["exitCode"], "timedOut": row["timedOut"],
            "testCount": row.get("testCount"), "skippedCount": row.get("skippedCount"),
            "replayExitCode": replay.get("exitCode"), "completionValid": row.get("completionValid"),
            "sourceCommit": run["sourceCommit"], "runUrl": run["runUrl"],
        }
        observations.append(observation)

    def display(name, tier, profile):
        row = rows[f"{name}/{tier}/{profile}"]
        if passed(row):
            return f"Pass ({row['testCount']}; {row['skippedCount']} skipped)" if row.get("testCount") else "Pass"
        return notes[key(row)]["display"]

    packages = []
    for package in cohort:
        name = package["name"]
        tier = "named_behavior" if f"{name}/named_behavior/node" in rows else "upstream_suite"
        packages.append({
            "name": name, "version": package["version"], "area": package["area"],
            "scope": analysis["scopes"][name], "tier": tier,
            **{profile: display(name, tier, profile) for profile in PROFILES},
        })
    suites = []
    for name, entry in analysis["suiteScopes"].items():
        tier = entry["tier"]
        suites.append({"name": name, "note": entry["note"], **{profile: display(name, tier, profile) for profile in PROFILES}})
    named = [entry for entry in packages if entry["tier"] == "named_behavior"]
    totals = {
        "packages": len(packages), "observations": len(observations), "namedPackages": len(named), "suitePackages": len(suites),
        "namedPass": {profile: sum(passed(rows[f"{entry['name']}/named_behavior/{profile}"]) for entry in named) for profile in PROFILES},
        "rootImportPass": {profile: sum(passed(rows[f"{entry['name']}/root_import/{profile}"]) for entry in packages) for profile in PROFILES},
    }
    assert totals == analysis["expectedTotals"], "Reconcile the written findings with the measured counts"
    summary = {
        **{field: analysis[field] for field in ("sourceCommit", "cohortCommit", "headline", "coverage", "rootImports", "findings", "suiteInterpretation", "denoFollowup", "audit")},
        "schemaVersion": 1, "runUrl": run["runUrl"], "startedAt": run["startedAt"], "completedAt": run["completedAt"],
        "lockSha256": run["lockSha256"], "totals": totals, "packages": packages, "suites": suites, "observations": observations,
    }
    csv_file = io.StringIO(newline="")
    writer = csv.DictWriter(csv_file, fieldnames=COLUMNS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows({key: "" if value is None else str(value).lower() if isinstance(value, bool) else value for key, value in row.items()} for row in observations)
    outputs = {SUMMARY: json.dumps(summary, indent=2) + "\n", ROOT / "results/results.csv": csv_file.getvalue()}
    for path, content in outputs.items():
        if check:
            if path.suffix == ".json":
                assert json.loads(path.read_text()) == json.loads(content), f"Stale generated file: {path}"
            else:
                assert path.read_text() == content, f"Stale generated file: {path}"
        else:
            path.write_text(content)
    print(json.dumps(totals, indent=2))
    print("Raw evidence sha256:", hashlib.sha256((ROOT / "results/raw-results.json").read_bytes()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify generated publication files without modifying them")
    build(parser.parse_args().check)
