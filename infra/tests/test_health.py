from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import health


class HealthAlertTests(unittest.TestCase):
    def test_manual_test_preserves_next_scheduled_alert(self):
        issue = ["Website health check is failing."]
        now = time.time()
        for name, previous_issues, current, sent_at, subject in (
            ("incident", [], issue, now, "CompatLab: attention required"),
            ("recovery", issue, [], now, "CompatLab: service recovered"),
            ("reminder", issue, issue, now - 86401, "CompatLab: attention required"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                state = Path(temporary)
                live = state / "health.json"
                previous = json.dumps({"issues": previous_issues, "sentAt": sent_at, "receipt": "previous"})
                live.write_text(previous)
                with patch.object(health, "STATE", state), patch.object(health, "problems", return_value=current), \
                        patch.object(health, "send", side_effect=["test-receipt", "live-receipt"]) as send, \
                        redirect_stdout(io.StringIO()):
                    with patch.object(sys, "argv", ["health.py", "test"]):
                        health.main()
                    self.assertEqual(live.read_text(), previous)
                    self.assertEqual(json.loads((state / "health-test.json").read_text())["receipt"], "test-receipt")

                    with patch.object(sys, "argv", ["health.py"]):
                        health.main()
                        health.main()
                    self.assertEqual([call.args[0] for call in send.call_args_list], ["CompatLab: alert test", subject])
                    live_state = json.loads(live.read_text())
                    self.assertEqual(live_state["issues"], current)
                    self.assertEqual(live_state["receipt"], "live-receipt")
