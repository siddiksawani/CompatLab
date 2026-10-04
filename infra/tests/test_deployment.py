import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import deploy
import origin
import release

spec = importlib.util.spec_from_file_location("receiver", Path(__file__).resolve().parents[1] / "backup-receiver.py")
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def manifest(sha):
    return {"schemaVersion": 1, "repository": "siddiksawani/CompatLab", "commit": sha,
            "archiveDigest": "a" * 64, "archiveBytes": 100, "workerRevision": "b" * 64,
            "migrationsDigest": "c" * 64, "hostRevision": "e" * 64,
            "images": {name: f"ghcr.io/siddiksawani/compatlab-{name}@sha256:" + "d" * 64 for name in ("web", "control", "proxy")}}


class ReleaseTests(unittest.TestCase):
    def test_rejects_unexpected_registry_and_mutable_image(self):
        value = manifest("1" * 40)
        release.validate_manifest(value, "1" * 40)
        for image in ("node:latest", "ghcr.io/other/compatlab-web@sha256:" + "d" * 64):
            value["images"]["web"] = image
            with self.assertRaises(ValueError):
                release.validate_manifest(value, "1" * 40)
        with self.assertRaises(ValueError):
            release.commit("main; reboot")

    def test_rejects_unmerged_deploy_request(self):
        with patch.object(release, "get_json", return_value={"object": {"sha": "2" * 40}}):
            with self.assertRaisesRegex(ValueError, "current qualified main"):
                release.current_main("1" * 40)

    def test_blocks_archive_path_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, link in (("../outside", None), ("link", "/etc")):
                archive = root / "app.tar.gz"
                with tarfile.open(archive, "w:gz") as output:
                    member = tarfile.TarInfo(name)
                    if link:
                        member.type, member.linkname = tarfile.SYMTYPE, link
                    output.addfile(member)
                with self.assertRaises(tarfile.FilterError):
                    release.extract(archive, root / "release")
            self.assertFalse((root / "outside").exists())

    def test_keeps_internal_dependency_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "app.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                member = tarfile.TarInfo("node_modules/.pnpm/pkg/index.js")
                member.size = 2
                output.addfile(member, io.BytesIO(b"ok"))
                member = tarfile.TarInfo("node_modules/pkg")
                member.type, member.linkname = tarfile.SYMTYPE, ".pnpm/pkg"
                output.addfile(member)
            release.extract(archive, root / "release")
            self.assertEqual((root / "release/node_modules/pkg/index.js").read_text(), "ok")

    def test_failed_app_health_restores_previous_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old, new, config, state = [root / name for name in ("1" * 40, "2" * 40, "config", "state")]
            for path in (old, new, config, state):
                path.mkdir()
            (old / "manifest.json").write_text(json.dumps(manifest(old.name)))
            (old / "worker-inventory.json").write_text("{}")
            (old / "worker-release").write_text(old.name)
            for path in (old, new):
                (path / "infra").mkdir()
                (path / "infra/cloudflare-ips.json").write_text('{"ipv4":[],"ipv6":[]}')
            (config / "proxy.env").write_text("CLOUDFLARE_CIDRS=original\n")
            (config / "web.env").write_text("PUBLIC_MATRIX_ID=original\n")
            current = root / "current"
            current.symlink_to(old)
            activated, actions = [], []

            def wait(description, predicate, seconds):
                if description == "website health":
                    raise RuntimeError("Candidate failed")

            with patch.multiple(deploy, CURRENT=current, CONFIG=config, STATE=state), \
                 patch.object(deploy, "current_main"), \
                 patch.object(deploy, "stage", return_value=(new, manifest(new.name))), \
                 patch.object(deploy, "compose"), patch.object(deploy, "run"), \
                 patch.object(deploy, "activate", side_effect=lambda path: activated.append(path)), \
                 patch.object(deploy, "wait_for", side_effect=wait), \
                 patch.object(deploy, "admin", side_effect=lambda directory, *args, **kw: actions.append(args)):
                with self.assertRaisesRegex(RuntimeError, "Candidate failed"):
                    deploy.deploy(new.name)
            self.assertEqual(activated, [new, old.resolve()])
            self.assertEqual((config / "proxy.env").read_text(), "CLOUDFLARE_CIDRS=original\n")
            self.assertIn(("deployment-end", new.name), actions)
            self.assertTrue((state / "last-failure.json").exists())


class FirewallTests(unittest.TestCase):
    def test_rejects_private_empty_and_overly_broad_ranges(self):
        for ranges in ([], ["10.0.0.0/8"], ["0.0.0.0/0"], ["100.64.0.0/10"], ["104.16.0.0/13", "104.16.0.0/13"]):
            with self.assertRaises(ValueError):
                origin.validate({"ipv4": ranges, "ipv6": ["2606:4700::/32"]})
        with self.assertRaises(ValueError):
            origin.validate({"ipv4": ["104.16.0.0/13"], "ipv6": ["::/0"]})


class BackupTests(unittest.TestCase):
    name = "compatlab-2026-10-04T00-00-00.000Z-12345678-1234-1234-1234-123456789012.clb"
    payload = b"CLB1" + b"encrypted fixture" * 20

    def test_rejects_arbitrary_commands_and_paths(self):
        for command in ("bash", "receive ../../etc/passwd " + "a" * 64 + " 123", f"receive {self.name} " + "a" * 64 + " 99999999999"):
            with self.assertRaises(ValueError):
                receiver.parse(command)

    def test_truncation_and_wrong_digest_leave_no_archive(self):
        digest = hashlib.sha256(self.payload).hexdigest()
        with tempfile.TemporaryDirectory() as temporary, patch.object(receiver, "FLOOR_BYTES", 0):
            for data in (self.payload[:-1], b"bad!" + self.payload[4:]):
                with self.assertRaises(ValueError):
                    receiver.receive(temporary, self.name, digest, len(self.payload), io.BytesIO(data))
                self.assertEqual(list(Path(temporary).iterdir()), [])
            first = receiver.receive(temporary, self.name, digest, len(self.payload), io.BytesIO(self.payload))
            second = receiver.receive(temporary, self.name, digest, len(self.payload), io.BytesIO(self.payload))
            self.assertEqual(first, second)
            self.assertEqual((Path(temporary) / self.name).read_bytes(), self.payload)


if __name__ == "__main__":
    unittest.main()
