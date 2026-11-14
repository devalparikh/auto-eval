"""Offline adversarial release-consumer tests, without product imports or credentials."""

import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

import server_release as release

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "55e823125c4135d5096c72b6047340dd0844d900"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "release"
        release.build(ROOT, self.output, "0.0.0-candidate", SOURCE)
        self.manifest = self.output / "server-manifest.json"
        self.bundle = self.output / "auto-eval-server.tar.gz"
        self.expected = release.digest(self.manifest.read_bytes())

    def install(self, **kw):
        options = dict(
            bundle=self.bundle,
            manifest=self.manifest,
            manifest_sha256=self.expected,
            destination=self.root / "stage",
            version="0.0.0-candidate",
            source=SOURCE,
        )
        options.update(kw)
        return release.install(**options)

    def test_round_trip_reproducible_and_service_discovery(self):
        other = self.root / "other"
        release.build(ROOT, other, "0.0.0-candidate", SOURCE)
        self.assertEqual(self.bundle.read_bytes(), (other / self.bundle.name).read_bytes())
        self.install()
        stage = self.root / "stage"
        config = json.loads((stage / "vercel.json").read_text())
        for service in config["services"].values():
            self.assertTrue((stage / service["root"]).is_dir())
        self.assertTrue((stage / "backend/main.py").is_file())
        self.assertTrue((stage / "backend/requirements.txt").is_file())
        self.assertFalse((stage / ".env.example").exists())
        self.assertFalse((stage / "packages").exists())
        self.assertEqual(
            (stage / "frontend/package-lock.json").read_bytes(),
            (ROOT / "frontend/package-lock.json").read_bytes(),
        )

    def test_archive_tamper(self):
        self.bundle.write_bytes(self.bundle.read_bytes() + b"tamper")
        with self.assertRaisesRegex(ValueError, "archive checksum"):
            self.install()
        self.assertFalse((self.root / "stage").exists())

    def test_manifest_tamper(self):
        self.manifest.write_bytes(self.manifest.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "manifest checksum"):
            self.install()

    def test_wrong_version_and_source(self):
        for options in [dict(version="1.0.0"), dict(source="a" * 40)]:
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                self.install(**options)

    def test_no_overwrite(self):
        (self.root / "stage").mkdir()
        with self.assertRaisesRegex(ValueError, "destination"):
            self.install()

    def malicious(self, member, content=b"x"):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w:gz") as tar:
            tar.addfile(member, io.BytesIO(content) if member.isfile() else None)
        self.bundle.write_bytes(raw.getvalue())
        manifest = json.loads(self.manifest.read_bytes())
        manifest["archiveSha256"] = release.digest(raw.getvalue())
        manifest["files"] = {member.name: release.digest(content)}
        self.manifest.write_text(json.dumps(manifest))
        self.expected = release.digest(self.manifest.read_bytes())

    def test_traversal_even_with_valid_archive_hash(self):
        member = tarfile.TarInfo("../escape")
        member.size = 1
        self.malicious(member)
        with self.assertRaisesRegex(ValueError, "unsafe archive"):
            self.install()
        self.assertFalse((self.root / "escape").exists())

    def test_symlink_even_with_valid_archive_hash(self):
        member = tarfile.TarInfo("frontend/link")
        member.type, member.linkname = tarfile.SYMTYPE, "/tmp"
        self.malicious(member)
        with self.assertRaisesRegex(ValueError, "invalid archive"):
            self.install()

    def test_member_checksum(self):
        m = json.loads(self.manifest.read_bytes())
        m["files"]["backend/main.py"] = "0" * 64
        self.manifest.write_text(json.dumps(m))
        self.expected = release.digest(self.manifest.read_bytes())
        with self.assertRaisesRegex(ValueError, "file checksum"):
            self.install()


if __name__ == "__main__":
    unittest.main()
