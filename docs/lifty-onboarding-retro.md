Lifty onboarding exposed several generic integration gaps beyond the initial JSON adapter:

1. Standalone CLI import fails: importing the existing versioning hash helper initializes the graph package and loops back into versioning. In-process API tests mask this because imports happen in a different order. Extract the canonical content-hash helper and exercise the documented CLI in a fresh process.
2. A completed run with failed assertions exits successfully. CI needs a failing exit status after saving/submitting evidence, without losing the result file.
3. Comparing candidates requires manually joining per-case results. Add a local comparison operation that rejects different suites, execution modes, models or settings and reports changed named checks, keeping raw outputs private.
4. Whole-document application assertions cannot judge arbitrary coaching quality. Retain deterministic safety/protocol checks; track live model grading, usage and human-reviewed holdouts separately.
5. The fixture loader and reader boundary need a documented auth stub and non-mutating adapter contract. Do not install an endpoint or connect production Supabase simply to evaluate orchestration.

The first three should be fixed in this iteration. Follow-up work: richer artifact provenance, opt-in redacted trajectories, an application-specific UI, atomic onboarding, and bounded live spend with provider-reported identity/usage. No live results are claimed.

Implemented in the follow-up commit: the shared canonical hash helper has no
runtime graph imports; a fresh-process CLI regression catches import-order bugs;
failed checks produce exit 1 after saving/submitting; `compare` joins named
checks only for compatible runs. The real Lifty baseline produced three failed
rewrite checks (unit, per-hand/total convention and sets/reps), with the other
nine cases passing. This validates the need for structured invariants rather
than whole-prose equality. These are injected model-response failures through
real application code, not observations of the live production model.
