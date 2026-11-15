"""Offline adversarial release-consumer tests, without product imports or credentials."""

import io
import json
import re
import shutil
import tarfile
import tempfile
import shlex
import tomllib
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

    def test_schema_contract_is_the_bundled_migration_count(self):
        source = (ROOT / release.MIGRATIONS_FILE).read_text()
        contract = json.loads(self.manifest.read_text())["compatibility"]["schemaUpgradeContract"]
        # Independent of the parser: every defined migration is listed exactly once.
        defined = re.findall(r"^def (_apply_version_\w+)\(", source, re.M)
        self.assertEqual(contract["version"], len(defined))
        self.assertEqual(contract["version"], release.schema_version(source))
        self.assertGreaterEqual(contract["version"], 20)
        self.assertEqual(self.install()["compatibility"]["schemaUpgradeContract"], contract)

    def test_future_migration_moves_the_contract_without_a_script_edit(self):
        root = self.root / "source"
        for name in release.ROOT_FILES:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, root / name)
        for tree in release.TREES:
            shutil.copytree(
                ROOT / tree, root / tree, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
            )
        path = root / release.MIGRATIONS_FILE
        source = path.read_text()
        current = release.schema_version(source)
        source = source.replace(
            "\n)\n\nMIGRATION_VERSION",
            "\n    _apply_version_future,\n)\n\nMIGRATION_VERSION",
        )
        path.write_text(source + "\n\ndef _apply_version_future(connection) -> None:\n    pass\n")
        output = self.root / "future"
        manifest = release.build(root, output, "0.0.0-candidate", SOURCE)
        self.assertEqual(manifest["compatibility"]["schemaUpgradeContract"]["version"], current + 1)
        installed = release.install(
            output / "auto-eval-server.tar.gz",
            output / "server-manifest.json",
            release.digest((output / "server-manifest.json").read_bytes()),
            self.root / "future-stage",
            "0.0.0-candidate",
            SOURCE,
        )
        self.assertEqual(installed["compatibility"], manifest["compatibility"])

    def test_stale_schema_contract_is_refused_even_with_a_valid_manifest_hash(self):
        manifest = json.loads(self.manifest.read_text())
        manifest["compatibility"]["schemaUpgradeContract"]["version"] -= 1
        self.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
        with self.assertRaisesRegex(ValueError, "schema upgrade contract"):
            self.install(manifest_sha256=release.digest(self.manifest.read_bytes()))
        self.assertFalse((self.root / "stage").exists())

    def test_ambiguous_migration_lists_are_refused(self):
        defined = "def a(c):\n    pass\n\ndef b(c):\n    pass\n\n"
        self.assertEqual(release.schema_version(defined + "MIGRATIONS: tuple = (a, b)\n"), 2)
        for body in [
            "",
            "MIGRATIONS = [a, b]\n",
            "MIGRATIONS = (a, a)\n",
            "MIGRATIONS = (a, missing)\n",
            "MIGRATIONS = (a, *rest)\n",
            "MIGRATIONS = ()\n",
            "MIGRATIONS = (a,)\nMIGRATIONS = (a, b)\n",
        ]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                release.schema_version(defined + body)

    def test_backend_service_installs_declared_postgres_extra(self):
        self.install()
        stage = self.root / "stage"
        service = json.loads((stage / "vercel.json").read_text())["services"]["backend"]
        command = shlex.split(service["installCommand"])
        self.assertEqual(command, ["uv", "pip", "install", "--link-mode=copy", ".[hosted]"])
        manifest = tomllib.loads((stage / service["root"] / "pyproject.toml").read_text())
        self.assertIn("psycopg[binary]>=3.2,<4", manifest["project"]["optional-dependencies"]["hosted"])
        self.assertNotIn("installCommand", json.loads((stage / "vercel.json").read_text()))

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
