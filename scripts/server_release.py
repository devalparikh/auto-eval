"""Build and install an independently pinned Vercel source release. Never deploys."""

import argparse
import gzip
import hashlib
import io
import json
import re
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

SCHEMA = 1
MAX_BYTES = 100 * 1024 * 1024
# Deliberately excludes .env, local databases, SDK packages, tests and build caches.
ROOT_FILES = [
    "vercel.json",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/next.config.ts",
    "frontend/tsconfig.json",
    "frontend/next-env.d.ts",
    "frontend/postcss.config.mjs",
    "backend/pyproject.toml",
    "backend/main.py",
    "backend/requirements.txt",
]
TREES = ["frontend/src", "frontend/public", "backend/src"]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check_hex(value):
    if not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("expected a lowercase SHA-256")


def check_identity(version, source):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("exact semantic version required")
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError("full source commit required")


def safe_name(name):
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts or str(p) != name or "\\" in name:
        raise ValueError("unsafe archive path")
    return p


def build(root, output, version, source):
    check_identity(version, source)
    root, output = Path(root).resolve(), Path(output).resolve()
    if root == output or root in output.parents:
        raise ValueError("output must be outside source")
    if output.exists():
        raise ValueError("output already exists")
    files = list(ROOT_FILES)
    for tree in TREES:
        files.extend(
            str(p.relative_to(root))
            for p in (root / tree).rglob("*")
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
        )
    contents = {}
    for name in sorted(set(files)):
        p = root / name
        if p.is_symlink() or root not in p.resolve().parents:
            raise ValueError("symlinks are not release inputs")
        safe_name(name)
        if any(
            part.startswith(".") or part in {"__pycache__", "node_modules"}
            for part in p.relative_to(root).parts
        ):
            raise ValueError(f"forbidden input: {name}")
        data = p.read_bytes()
        if re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}", data):
            raise ValueError(f"possible secret: {name}")
        contents[name] = data
    if sum(map(len, contents.values())) > MAX_BYTES:
        raise ValueError("release too large")
    raw = io.BytesIO()
    with (
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as gz,
        tarfile.open(fileobj=gz, mode="w") as tar,
    ):
        for name, data in contents.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))
    bundle = raw.getvalue()
    manifest = {
        "schemaVersion": SCHEMA,
        "product": "auto-eval-server",
        "version": version,
        "sourceCommit": source,
        "target": "vercel-services",
        "archive": "auto-eval-server.tar.gz",
        "archiveSha256": digest(bundle),
        "files": {n: digest(d) for n, d in contents.items()},
        "compatibility": {
            "migrationCli": None,
            "schemaUpgradeContract": None,
            "hostedFeed": False,
            "supabaseAuth": False,
            "productionReady": False,
        },
    }
    output.mkdir()
    (output / manifest["archive"]).write_bytes(bundle)
    (output / "server-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.copyfile(Path(__file__), output / "server_release.py")
    hashes = {p.name: digest(p.read_bytes()) for p in sorted(output.iterdir())}
    (output / "SHA256SUMS").write_text("".join(f"{h}  {n}\n" for n, h in hashes.items()))
    return manifest


def install(bundle, manifest, manifest_sha256, destination, version, source):
    """Verify before any extraction; destination must not exist, including symlinks."""
    check_identity(version, source)
    check_hex(manifest_sha256)
    data = Path(manifest).read_bytes()
    if digest(data) != manifest_sha256:
        raise ValueError("manifest checksum mismatch")
    m = json.loads(data)
    if (m["schemaVersion"], m["product"], m["version"], m["sourceCommit"], m["target"]) != (
        SCHEMA,
        "auto-eval-server",
        version,
        source,
        "vercel-services",
    ):
        raise ValueError("release identity mismatch")
    archive = Path(bundle).read_bytes()
    if len(archive) > MAX_BYTES or digest(archive) != m["archiveSha256"]:
        raise ValueError("archive checksum/size mismatch")
    dest = Path(destination).absolute()
    if dest.exists() or dest.is_symlink():
        raise ValueError("destination must not exist")
    verified = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            safe_name(member.name)
            total += member.size
            if not member.isfile() or member.name in verified or total > MAX_BYTES:
                raise ValueError("invalid archive member or size")
            content = tar.extractfile(member).read()
            if digest(content) != m["files"].get(member.name):
                raise ValueError("file checksum mismatch")
            verified[member.name] = content
    if set(verified) != set(m["files"]):
        raise ValueError("file inventory mismatch")
    for name in ROOT_FILES:
        if name not in verified:
            raise ValueError("required build file missing")
    config = json.loads(verified["vercel.json"])
    if (
        config["services"]["frontend"]["root"] != "frontend"
        or config["services"]["backend"]["root"] != "backend"
    ):
        raise ValueError("unexpected service roots")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as temp:
        stage = Path(temp) / "product"
        stage.mkdir()
        for name, content in verified.items():
            p = stage / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(content)
        stage.rename(dest)
    return m


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    b = commands.add_parser("build")
    b.add_argument("--source", required=True)
    b.add_argument("--output", required=True)
    i = commands.add_parser("install")
    i.add_argument("--bundle", required=True)
    i.add_argument("--manifest", required=True)
    i.add_argument("--manifest-sha256", required=True)
    i.add_argument("--destination", required=True)
    for command in [b, i]:
        command.add_argument("--version", required=True)
        command.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    if args.command == "build":
        build(args.source, args.output, args.version, args.source_commit)
    else:
        install(
            args.bundle,
            args.manifest,
            args.manifest_sha256,
            args.destination,
            args.version,
            args.source_commit,
        )
    print("Verified release operation complete; no deployment or migration performed.")


if __name__ == "__main__":
    main()
