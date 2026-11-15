"""GitHub Actions SDK publisher. No credentials or registry error bodies are logged."""

import base64
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

NAME = "@devalparikh/autoeval"
REGISTRY = "https://npm.pkg.github.com"
METADATA_URL = REGISTRY + "/@devalparikh%2fautoeval"
TAG = "private"
FILES = {
    "package/package.json": "package.json",
    "package/README.md": "README.md",
    "package/dist/index.js": "src/index.js",
    "package/dist/contract.js": "src/contract.js",
    "package/dist/index.d.ts": "src/index.d.ts",
}
ERROR_CATEGORIES = {
    "registry-unauthorized",
    "registry-forbidden",
    "registry-rate-limited",
    "registry-server-error",
    "registry-http-error",
    "registry-transport",
    "registry-invalid-json",
    "registry-invalid-metadata",
    "registry-verification-mismatch",
    "npm-pack-failed",
    "npm-publish-failed",
}


class PublicationError(RuntimeError):
    def __init__(self, category):
        self.category = category
        super().__init__(category)


def error_category(error):
    if isinstance(error, PublicationError) and error.category in ERROR_CATEGORIES:
        return error.category
    return "local-validation-or-runtime-error"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the credential to another URL.


def metadata(token):
    request = Request(
        METADATA_URL,
        headers={"Authorization": "Bearer " + token, "Cache-Control": "no-cache"},
    )
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        error.close()
        if error.code == 404:
            return {"versions": {}, "dist-tags": {}}
        category = {
            401: "registry-unauthorized",
            403: "registry-forbidden",
            429: "registry-rate-limited",
        }.get(error.code, "registry-http-error")
        if 500 <= error.code < 600:
            category = "registry-server-error"
        raise PublicationError(category) from None
    except OSError:
        raise PublicationError("registry-transport") from None
    except ValueError:
        raise PublicationError("registry-invalid-json") from None
    if not isinstance(result, dict) or not isinstance(result.get("versions"), dict):
        raise PublicationError("registry-invalid-metadata")
    return result


def identity(package):
    version = package.get("version", "")
    if package.get("name") != NAME or not re.fullmatch(
        r"0\.[0-9]+\.[0-9]+-private\.[1-9][0-9]*", version
    ):
        raise RuntimeError("Unexpected package identity or prerelease version")
    if (
        package.get("license") != "UNLICENSED"
        or package.get("dependencies")
        or package.get("optionalDependencies")
        or package.get("peerDependencies")
        or package.get("bundledDependencies")
        or package.get("bundleDependencies")
        or package.get("publishConfig")
        != {"registry": REGISTRY, "access": "restricted"}
    ):
        raise RuntimeError("Unexpected license, dependencies or publication settings")
    return version


def validate_tarball(archive, package_root, version):
    seen = set()
    with tarfile.open(archive, "r:gz") as packed:
        for member in packed:
            if not member.isfile() or member.name not in FILES or member.name in seen:
                raise RuntimeError("Unexpected tarball member")
            seen.add(member.name)
            expected = (package_root / FILES[member.name]).read_bytes()
            if packed.extractfile(member).read() != expected:
                raise RuntimeError("Tarball differs from source bytes")
            if (
                member.name == "package/package.json"
                and identity(json.loads(expected)) != version
            ):
                raise RuntimeError("Tarball version mismatch")
    if seen != set(FILES):
        raise RuntimeError("Incomplete tarball")
    data = Path(archive).read_bytes()
    return {
        "shasum": hashlib.sha1(data).hexdigest(),
        "integrity": "sha512-"
        + base64.b64encode(hashlib.sha512(data).digest()).decode(),
    }


def verify_registry(document, version, digests):
    published = document.get("versions", {}).get(version, {})
    if (
        published.get("name") != NAME
        or published.get("version") != version
        or document.get("dist-tags", {}).get(TAG) != version
        or any(published.get("dist", {}).get(k) != v for k, v in digests.items())
    ):
        raise PublicationError("registry-verification-mismatch")


def verify_source(root, source):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise RuntimeError("Full source SHA required")
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip()
    if head != source:
        raise RuntimeError("Checkout does not match event source SHA")
    if subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=root
    ):
        raise RuntimeError("Tracked source changes are not allowed")


def write_record(output, record):
    # Replace atomically so a failed later update cannot truncate pre-upload evidence.
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(record, indent=2) + "\n")
    temporary.replace(output)
    print(json.dumps(record, indent=2))
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("```json\n" + json.dumps(record, indent=2) + "\n```\n")


def npm(args, *, category, **kwargs):
    try:
        return subprocess.run(args, capture_output=True, check=True, **kwargs)
    except (subprocess.CalledProcessError, OSError):
        raise PublicationError(category) from None


def publish(root, source, token, output):
    verify_source(root, source)
    package_root = root / "packages/trace-feed"
    version = identity(json.loads((package_root / "package.json").read_text()))
    record = {
        "name": NAME,
        "version": version,
        "source_commit": source,
        "registry": REGISTRY,
        "dist_tag": TAG,
        "run_url": f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
    }
    if version in metadata(token)["versions"]:
        record["status"] = "skipped-existing"
    else:
        with tempfile.TemporaryDirectory(prefix="sdk-publish-") as directory:
            temp = Path(directory)
            # Token stays in the environment, never in the config or argv.
            config = temp / ".npmrc"
            config.write_text("//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n")
            config.chmod(0o600)
            env = {
                **os.environ,
                "NPM_CONFIG_USERCONFIG": str(config),
                "NPM_CONFIG_CACHE": str(temp / "cache"),
                "NODE_AUTH_TOKEN": token,
                "NPM_CONFIG_LOGS_MAX": "0",
            }
            # Build/test ran before credentials were made available. No lifecycle scripts here.
            packed = npm(
                [
                    "npm",
                    "pack",
                    "--ignore-scripts",
                    "--json",
                    "--pack-destination",
                    directory,
                ],
                cwd=package_root,
                env=env,
                text=True,
                category="npm-pack-failed",
            )
            filename = json.loads(packed.stdout)[0]["filename"]
            if Path(filename).name != filename:
                raise RuntimeError("Invalid pack filename")
            archive = temp / filename
            digests = validate_tarball(archive, package_root, version)
            record.update(digests)
            verify_source(root, source)
            record["status"] = "prepared-not-published"
            write_record(output, record)
            # Recheck after packing under the workflow's shared concurrency group.
            if version in metadata(token)["versions"]:
                record["status"] = "skipped-existing"
            else:
                # An upload can succeed even when its response/verification fails.
                # Save expected digests outside the temporary credential/cache directory.
                record["status"] = "publish-attempted-unverified"
                write_record(output, record)
                try:
                    npm(
                        [
                            "npm",
                            "publish",
                            str(archive),
                            "--ignore-scripts",
                            "--registry=" + REGISTRY,
                            "--access=restricted",
                            "--tag=" + TAG,
                        ],
                        cwd=package_root,
                        env=env,
                        category="npm-publish-failed",
                    )
                    record["status"] = "uploaded-unverified"
                    write_record(output, record)
                    verify_registry(metadata(token), version, digests)
                except Exception as error:
                    record["error_category"] = error_category(error)
                    write_record(output, record)
                    raise
                record["status"] = "published-and-verified"
    write_record(output, record)


def main():
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "devalparikh/auto-eval"
        or os.environ.get("GITHUB_REF") != "refs/heads/main"
        or os.environ.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch")
    ):
        raise RuntimeError("Publishing is only supported in the main Actions workflow")
    publish(
        Path(__file__).resolve().parent.parent,
        os.environ["SOURCE_SHA"],
        os.environ["NODE_AUTH_TOKEN"],
        Path(os.environ["RUNNER_TEMP"]) / "sdk-publication.json",
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - never leak third-party exception payloads
        # Do not emit subprocess output, request bodies, headers or credential values.
        raise SystemExit(
            f"SDK publication failed ({error_category(error)}); inspect safe step/checksum evidence"
        ) from None
