import copy
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import sdk_publish as sdk

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "packages/trace-feed"
VERSION = json.loads((PACKAGE / "package.json").read_text())["version"]
SHA = "a" * 40


class PublisherTests(unittest.TestCase):
    def test_only_404_means_absence(self):
        for code, category in (
            (401, "registry-unauthorized"),
            (403, "registry-forbidden"),
            (429, "registry-rate-limited"),
            (500, "registry-server-error"),
            (302, "registry-http-error"),
        ):
            with self.subTest(code=code), patch.object(sdk, "build_opener") as opener:
                opener.return_value.open.side_effect = HTTPError(
                    "url", code, "", {}, None
                )
                with self.assertRaisesRegex(RuntimeError, category):
                    sdk.metadata("synthetic")
        with patch.object(sdk, "build_opener") as opener:
            opener.return_value.open.side_effect = HTTPError("url", 404, "", {}, None)
            self.assertEqual(sdk.metadata("synthetic")["versions"], {})

    def test_network_and_malformed_metadata_fail(self):
        for failure, category in (
            (URLError("sensitive transport details"), "registry-transport"),
            (ValueError("sensitive response body"), "registry-invalid-json"),
        ):
            with patch.object(sdk, "build_opener") as opener:
                opener.return_value.open.side_effect = failure
                with self.assertRaisesRegex(RuntimeError, category):
                    sdk.metadata("synthetic")
        with patch.object(sdk, "build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value = io.BytesIO(
                b"{}"
            )
            with self.assertRaisesRegex(RuntimeError, "registry-invalid-metadata"):
                sdk.metadata("synthetic")

    def test_error_categories_never_include_untrusted_details(self):
        for failure in (
            RuntimeError("synthetic-secret"),
            sdk.PublicationError("synthetic-secret"),
            subprocess.CalledProcessError(1, ["synthetic-secret"]),
        ):
            self.assertEqual(
                sdk.error_category(failure), "local-validation-or-runtime-error"
            )
        self.assertEqual(
            sdk.error_category(sdk.PublicationError("registry-forbidden")),
            "registry-forbidden",
        )

    def test_real_npm_pack_matches_validated_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "npm_config_cache": "/tmp/autoeval-npm-cache"}
            subprocess.run(
                ["npm", "run", "build"],
                cwd=PACKAGE,
                env=env,
                capture_output=True,
                check=True,
            )
            result = subprocess.run(
                [
                    "npm",
                    "pack",
                    "--ignore-scripts",
                    "--json",
                    "--pack-destination",
                    directory,
                ],
                cwd=PACKAGE,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            archive = Path(directory) / json.loads(result.stdout)[0]["filename"]
            self.assertIn("integrity", sdk.validate_tarball(archive, PACKAGE, VERSION))

    def test_identity(self):
        package = json.loads((PACKAGE / "package.json").read_text())
        self.assertEqual(sdk.identity(package), VERSION)
        for key, value in (
            ("name", "other"),
            ("version", "0.2.0"),
            ("dependencies", {"surprise": "*"}),
            ("license", "MIT"),
        ):
            altered = {**package, key: value}
            with self.assertRaises(RuntimeError):
                sdk.identity(altered)

    def pack(self, archive, *, change=None, omit=None, extra=None, duplicate=False):
        with tarfile.open(archive, "w:gz") as tar:
            for name, source in sdk.FILES.items():
                if name == omit:
                    continue
                content = (PACKAGE / source).read_bytes()
                if name == change:
                    content += b"\nchanged"
                member = tarfile.TarInfo(name)
                member.size = len(content)
                tar.addfile(member, io.BytesIO(content))
                if duplicate:
                    tar.addfile(member, io.BytesIO(content))
            if extra:
                member = tarfile.TarInfo(extra)
                member.type = tarfile.SYMTYPE
                member.linkname = "/etc/passwd"
                tar.addfile(member)

    def test_tarball_exact_bytes_inventory_and_version(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "sdk.tgz"
            self.pack(archive)
            digest = sdk.validate_tarball(archive, PACKAGE, VERSION)
            self.assertTrue(digest["integrity"].startswith("sha512-"))
            with self.assertRaises(RuntimeError):
                sdk.validate_tarball(archive, PACKAGE, "0.0.0-private.999999")
            for mutation in (
                {"change": "package/dist/index.js"},
                {"omit": "package/README.md"},
                {"extra": "../escape"},
                {"duplicate": True},
            ):
                self.pack(archive, **mutation)
                with self.assertRaises(RuntimeError):
                    sdk.validate_tarball(archive, PACKAGE, VERSION)

    def test_source_commit_and_dirty_checkout(self):
        with patch.object(subprocess, "check_output", side_effect=[(SHA + "\n"), b""]):
            sdk.verify_source(ROOT, SHA)
        for values in (["b" * 40], [SHA, b" M package.json"]):
            with (
                patch.object(subprocess, "check_output", side_effect=values),
                self.assertRaises(RuntimeError),
            ):
                sdk.verify_source(ROOT, SHA)
        with self.assertRaises(RuntimeError):
            sdk.verify_source(ROOT, "main")

    def test_registry_verification(self):
        digests = {"shasum": "sha1", "integrity": "sha512-value"}
        document = {
            "versions": {
                VERSION: {"name": sdk.NAME, "version": VERSION, "dist": digests}
            },
            "dist-tags": {"private": VERSION},
        }
        sdk.verify_registry(document, VERSION, digests)
        for key in ("dist-tags", "versions"):
            altered = copy.deepcopy(document)
            altered[key] = {}
            with self.assertRaises(RuntimeError):
                sdk.verify_registry(altered, VERSION, digests)
        with self.assertRaises(RuntimeError):
            sdk.verify_registry(document, VERSION, {**digests, "integrity": "wrong"})

    def exercise_publish(
        self, documents, *, expect_error=False, upload_error=False, verify_error=None
    ):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "record.json"
            summary = Path(directory) / "summary"
            env = {
                "GITHUB_REPOSITORY": "devalparikh/auto-eval",
                "GITHUB_RUN_ID": "123",
                "GITHUB_STEP_SUMMARY": str(summary),
            }

            def npm(args, **kwargs):
                if args[1] == "pack":
                    self.pack(Path(args[-1]) / "sdk.tgz")
                    return MagicMock(stdout='[{"filename":"sdk.tgz"}]')
                self.assertEqual(args[1], "publish")
                self.assertIn("--ignore-scripts", args)
                self.assertIn("--access=restricted", args)
                self.assertIn("--tag=private", args)
                # Evidence must be durable BEFORE any upload can occur.
                before_upload = json.loads(output.read_text())
                self.assertEqual(
                    before_upload["status"], "publish-attempted-unverified"
                )
                self.assertEqual(before_upload["source_commit"], SHA)
                expected = sdk.validate_tarball(Path(args[2]), PACKAGE, VERSION)
                for key, value in expected.items():
                    self.assertEqual(before_upload[key], value)
                self.assertEqual(
                    len(
                        list(
                            Path(kwargs["env"]["NPM_CONFIG_USERCONFIG"]).parent.glob(
                                "*.tgz"
                            )
                        )
                    ),
                    1,
                )
                if upload_error:
                    raise subprocess.CalledProcessError(
                        1, args, output=b"synthetic-secret", stderr=b"synthetic-secret"
                    )
                return MagicMock()

            with (
                patch.dict(os.environ, env),
                patch.object(sdk, "verify_source"),
                patch.object(sdk, "metadata", side_effect=documents),
                patch.object(subprocess, "run", side_effect=npm) as run,
                patch.object(
                    sdk, "verify_registry", side_effect=verify_error
                ) as verify,
                patch("builtins.print"),
            ):
                if expect_error:
                    with self.assertRaises(RuntimeError):
                        sdk.publish(ROOT, SHA, "synthetic", output)
                else:
                    sdk.publish(ROOT, SHA, "synthetic", output)
                record = json.loads(output.read_text())
                self.assertNotIn("synthetic-secret", output.read_text())
                self.assertNotIn("synthetic-secret", summary.read_text())
                self.assertIn(record["status"], summary.read_text())
                if run.called:
                    config = Path(run.call_args.kwargs["env"]["NPM_CONFIG_USERCONFIG"])
                    self.assertFalse(config.exists())
                return record, run.call_count, verify.call_count

    def test_existing_version_skips_without_pack_or_publish(self):
        record, calls, verifies = self.exercise_publish([{"versions": {VERSION: {}}}])
        self.assertEqual(
            (record["status"], calls, verifies), ("skipped-existing", 0, 0)
        )

    def test_final_check_handles_another_publisher(self):
        record, calls, verifies = self.exercise_publish(
            [{"versions": {}}, {"versions": {VERSION: {}}}]
        )
        self.assertEqual(
            (record["status"], calls, verifies), ("skipped-existing", 1, 0)
        )

    def test_publishes_packed_archive_and_records_source(self):
        record, calls, verifies = self.exercise_publish([{"versions": {}}] * 3)
        self.assertEqual(
            (record["status"], calls, verifies), ("published-and-verified", 2, 1)
        )
        self.assertEqual(record["source_commit"], SHA)
        self.assertIn("shasum", record)

    def test_successful_upload_retains_evidence_when_verification_fails(self):
        for category in ("registry-transport", "registry-verification-mismatch"):
            with self.subTest(category=category):
                documents = [{"versions": {}}] * 3
                verify_error = None
                if category == "registry-transport":
                    documents[-1] = sdk.PublicationError(category)
                else:
                    verify_error = sdk.PublicationError(category)
                record, calls, _ = self.exercise_publish(
                    documents, expect_error=True, verify_error=verify_error
                )
                self.assertEqual(calls, 2)
                self.assertEqual(record["status"], "uploaded-unverified")
                self.assertEqual(record["source_commit"], SHA)
                self.assertEqual(record["error_category"], category)
                self.assertTrue(record["integrity"].startswith("sha512-"))
                self.assertEqual(len(record["shasum"]), 40)

    def test_upload_command_failure_preserves_unverified_evidence(self):
        record, calls, _ = self.exercise_publish(
            [{"versions": {}}] * 2, expect_error=True, upload_error=True
        )
        self.assertEqual(calls, 2)
        self.assertEqual(record["status"], "publish-attempted-unverified")
        self.assertEqual(record["error_category"], "npm-publish-failed")
        self.assertIn("integrity", record)

    def test_workflow_boundary_and_serialization(self):
        workflow = (ROOT / ".github/workflows/sdk-publish.yml").read_text()
        self.assertIn("branches: [main]", workflow)
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertIn("group: autoeval-sdk-publish", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("id-token:", workflow)
        self.assertIn("if: ${{ always() }}", workflow)
        self.assertIn("if-no-files-found: ignore", workflow)
        with (
            patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}),
            self.assertRaises(RuntimeError),
        ):
            sdk.main()


if __name__ == "__main__":
    unittest.main()
