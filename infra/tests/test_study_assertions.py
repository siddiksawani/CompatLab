"""A completed diagnostic must not conceal a changed or incomplete observation."""
import copy
import json
import runpy
import unittest
from pathlib import Path

FOLLOWUP = Path(__file__).resolve().parents[2] / 'docs/studies/npm-behavior-2026-11/followup'
VERIFY = runpy.run_path(str(FOLLOWUP / 'assertions-verify.py'))['verify_observations']


class StudyAssertionEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.run = json.loads((FOLLOWUP / 'assertions.json').read_text())

    def test_complete_diagnostics_retain_runtime_failures(self):
        VERIFY(self.run)

    def test_incomplete_or_forged_success_is_rejected(self):
        for field, value in [('exitCode', 0), ('timedOut', True), ('outOfMemory', True),
                             ('containerError', 'startup error'), ('logTruncated', True),
                             ('network', 'bridge'), ('suiteResult', None)]:
            with self.subTest(field=field):
                run = copy.deepcopy(self.run)
                row = next(row for row in run['results'] if row['label'] == 'deno298 loader-error-repro.mjs / attempt 1')
                row[field] = value
                with self.assertRaises(AssertionError):
                    VERIFY(run)

    def test_lost_side_effect_and_missing_coverage_are_rejected(self):
        row = next(row for row in self.run['results'] if row['label'] == 'deno298 import-attributes-repro.mjs package / attempt 1')
        row['suiteResult']['cases'][-1]['executed'] = 0
        with self.assertRaises(AssertionError):
            VERIFY(self.run)
        self.setUp()
        self.run['results'].pop()
        with self.assertRaises(AssertionError):
            VERIFY(self.run)


if __name__ == '__main__':
    unittest.main()
