# Dependency security baseline

**Captured:** 2026-08-06
**Status:** Pre-fix baseline. No dependency versions were changed as part of this audit.

## Re-audit, 2026-11-08

The zero-advisory npm result below no longer held. The lockfile had drifted out
of sync with `package.json` (`npm ci` refused it) and pinned `next@16.3.0` and
`sharp@0.35.3`, which `npm audit --omit=dev` reported with critical advisories,
among them unauthenticated RCE in image optimization for AVIF and SVG inputs, plus
high-severity SSRF and denial-of-service issues. No reachable exploit was
established in this application, but the runtime tree must not ship them.

| Package | Was | Now | How |
| --- | --- | --- | --- |
| `next` | 16.3.0 | 16.4.5 | direct; floor raised to `^16.4.5` |
| `eslint-config-next` | 16.3.0 | 16.4.5 | direct; kept in step with `next` |
| `sharp` | 0.35.3 | 0.35.5 | transitive through `next` |
| `nanoid` | 3.3.17 | 3.3.20 | transitive; lockfile only |
| `source-map-js` | 1.2.1 | 1.2.2 | transitive; lockfile only |

`npm audit --omit=dev` now reports zero advisories, and `npm ci` accepts the
regenerated lockfile. The full tree still reports development-only findings
that never ship: `vitest@3` (critical `tinypool` prototype-pollution gadget and
moderate `@vitest/mocker` issues, fixed only in vitest 5) and moderate
`typescript-eslint`/`minimatch` advisories under `eslint-config-next`. Both need
a major toolchain upgrade and are tracked as separate work.

## Follow-up remediation, 2026-11-08

Vitest is now `^5.1.0`, and a targeted typescript-estree override selects
`minimatch@^11.0.5`. Both the full npm audit and production-only audit report
zero advisories. The Node engine requirement matches Vitest 5. Python development
bounds now require `pytest>=9.0.3,<10` and `pytest-asyncio>=1.4,<2`.
`make setup` requires `pip>=26.2`, covering the additional index-URL advisory
CVE-2026-13346 as well as the earlier installer findings. The historical
baseline below remains as captured evidence.

## Scope and evidence

- Python: audited the exact installed `.venv` environment with `pip-audit 2.10.1 --skip-editable --format=json`, checked metadata with `pip show`, and verified dependency consistency with `pip check`.
- JavaScript: audited the exact `frontend/package-lock.json` installation with `npm audit --json` and inspected direct and transitive resolution with `npm ls`.
- The local editable `autoeval-api` distribution was intentionally skipped by `pip-audit`; every third-party package in the environment was scanned.
- Python currently has no resolved lockfile. `backend/pyproject.toml` supplies bounded dependency ranges, so the installed virtual environment is the reproducible evidence for this baseline. The frontend has a lockfile at `frontend/package-lock.json`.

## Executive result

| Tree | Raw findings | Unique advisories | Runtime application exposure |
| --- | ---: | ---: | --- |
| Python | 6 | 5 | None in declared runtime dependencies |
| npm | 0 | 0 | None |

`pip-audit` reports `PYSEC-2026-196` twice for the same pip advisory, so six raw findings represent five unique advisories. Four unique advisories affect the virtual environment's `pip` installer, which is neither a declared runtime nor dev dependency. One affects `pytest`, a direct dev-only dependency. All declared Python runtime dependencies, including FastAPI, LangGraph, HTTPX, SQLAlchemy, Pydantic Settings, and Uvicorn, returned no known advisories.

## Findings

| Severity | Package | Installed | Affected | Fixed | Dependency path | Runtime class | Exploitability here | Minimal remediation |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| Moderate, CVSS 5.3 | `pip` | 25.3 | `<26.1` | 26.1 | virtualenv bootstrap/tooling -> `pip` | Installer only; not an app dependency | Requires installing an attacker-controlled wheel whose module name is imported by pip's deferred self-update logic. It is not reachable through API or UI requests. | Upgrade the environment installer to `pip>=26.1.2`, which also covers the other pip findings. |
| Moderate, CVSS 4.6 | `pip` | 25.3 | `<=26.0.1` | 26.1 | virtualenv bootstrap/tooling -> `pip` | Installer only; not an app dependency | Requires a deliberately ambiguous concatenated tar/ZIP package and an explicit install action. It is not reachable at application runtime. | Upgrade the environment installer to `pip>=26.1.2`. |
| Moderate, CVSS 4.1 | `pip` | 25.3 | `<26.1.2` | 26.1.2 | virtualenv bootstrap/tooling -> `pip` | Installer only; not an app dependency | Requires installing a malicious package with a crafted console or GUI entry point. It can write entry points outside the intended install directory, but cannot be triggered by an agent-system request. | Upgrade the environment installer to `pip>=26.1.2`. |
| Low, CVSS 2.0 | `pip` | 25.3 | `<26.0` | 26.0 | virtualenv bootstrap/tooling -> `pip` | Installer only; not an app dependency | Requires explicitly installing a malicious wheel. Traversal is constrained to install-directory prefixes and is not a normal remote-service attack path. | Upgrade the environment installer to `pip>=26.1.2`. |
| Moderate, CVSS 6.8 | `pytest` | 8.4.2 | `<9.0.3` | 9.0.3 | `autoeval-api[dev]` -> `pytest` | Direct dev/test dependency | UNIX temp-directory handling may let another local user cause denial of service or potentially gain privileges while tests run. It is absent from production installs but matters on shared developer or CI hosts. | Change the dev bound to `pytest>=9.0.3,<10`, reinstall dev dependencies, and rerun the test suite. |

## npm result

`npm audit --json` reported zero info, low, moderate, high, or critical advisories across 647 resolved dependency records: 70 production, 530 development, 142 optional, and 26 peer records as classified by npm. There are therefore no direct or transitive npm remediation paths to recommend in this baseline.

A separate `npm audit --omit=dev --json` returned the same zero-advisory result for the production view. Because neither view has an advisory, affected versions, fixed versions, dependency paths, and runtime exploitability are all not applicable for the npm tree.

### Frontend package and install-script review

- Every resolved tarball in `package-lock.json` uses `https://registry.npmjs.org` and an integrity hash. No Git, local-file, plain-HTTP, or alternate-registry source is present.
- Every direct runtime package is used: Phosphor supplies icons, XYFlow renders trace DAGs, Motion animates the modal, Recharts renders the cost/accuracy plot, and Next/React supply the application runtime.
- Every direct development package is connected to linting, TypeScript, Tailwind/PostCSS, unit tests, DOM test setup, or Playwright end-to-end tests. No suspicious or unnecessary direct dependency was found.
- `esbuild@0.28.1` has `postinstall: node install.js`. It is dev-only and transitive through `autoeval-web -> vitest@3.2.7 -> vite@7.3.6 -> esbuild@0.28.1`; the script selects and verifies the platform binary.
- `unrs-resolver@1.12.2` has `postinstall: node postinstall.js`. It is dev-only and transitive through `autoeval-web -> eslint-config-next@16.3.0 -> eslint-import-resolver-typescript@3.10.1 -> unrs-resolver@1.12.2`; the script selects the native resolver binding.
- Optional dev-only `fsevents@2.3.2` and `fsevents@2.3.3` lockfile entries are marked as install-script packages. They are optional macOS file-watcher dependencies and are not installed in the current tree.
- `npm prune --dry-run` identified leftover optional WASM/native fallback packages as extraneous. A clean `npm ci` is the minimal housekeeping action; it does not require a dependency upgrade.

No runtime dependency in the installed Next.js application has an install/lifecycle script recorded by the lockfile.

## Recommended order

1. Preserve this report as the before-fix record.
2. Upgrade only the virtual environment's installer to `pip>=26.1.2`; this is a tooling change and does not alter application resolution.
3. In a separate dependency-remediation change, widen the dev-only pytest major bound to `pytest>=9.0.3,<10`, reinstall, and rerun unit and end-to-end tests.
4. Generate and commit a Python lockfile after the remediation so advisory scans can compare both the declared and resolved Python trees in CI.
5. Add CI gates for `pip-audit` and `npm audit --omit=dev` plus a full-tree npm audit. Keep development-tree findings visible but separate from runtime release blockers.

## Advisory references

- pip entry-point path traversal: GHSA-wf93-45jw-7689 / CVE-2026-8643
- pip wheel extraction traversal: GHSA-6vgw-5pg2-w6jp / CVE-2026-1703
- pip concatenated archive confusion: GHSA-58qw-9mgm-455v / CVE-2026-3219
- pip deferred self-update import: GHSA-jp4c-xjxw-mgf9 / CVE-2026-6357
- pytest predictable temporary directory: GHSA-6w46-j5rx-g56g / CVE-2025-71176
