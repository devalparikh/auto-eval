# Code Review — The Short Version

Read this first. The full evidence (file:line for everything) is in
[code-readability-review.md](code-readability-review.md). Jargon is decoded at
the bottom of this page.

**Verdict in one sentence:** the architecture is healthy — the problems are
copy-paste duplication and loosely-typed data, not bad design.

---

## Do these 5 first (~1 day total, all low-risk)

1. **Merge the 4 copies of the number-parsing helpers into one file.** (~1 hr)
   Four backend files each have their own private `_number()`, `_dict_list()`,
   etc. — little functions that turn "whatever JSON gave us" into a safe
   number or list. Make one shared `coerce.py`, delete the copies.
   *Why: today a bug fix in one copy silently misses the other three.*

2. **Fix the 2 visible UI bugs.** (~30 min)
   - Two warning messages use `dark:text-amber-*`, which follows your
     *operating system's* theme, not the app's theme toggle — so light-OS
     users get unreadable dark-amber text on a dark card. Use the app's
     existing `--warning` color variable instead.
   - The model-picker checkboxes show nothing when you Tab to them with a
     keyboard. Add a focus outline to the card.

3. **Auto-generate the frontend's API types from the backend.** (~2 hrs)
   Right now the backend describes its API responses in Python
   (`schemas.py`) and the frontend re-describes the *same shapes by hand* in
   TypeScript (`types.ts`, 482 lines). Nothing checks they match — if they
   drift apart, bugs appear silently. FastAPI already publishes a machine-
   readable API description (OpenAPI); run `openapi-typescript` on it to
   generate the frontend types automatically.
   *Why: deletes an entire category of "did you update both files?" bugs.*

4. **Write a root `CLAUDE.md` with the house rules.** (~30 min)
   The repo's important rules ("versions are immutable", "API keys never go
   in frontend env vars", "run `make check` before pushing") are scattered
   across the README and 4 docs. Put the top ~10 in one short root file so
   every engineer — and every AI agent — sees them automatically.

5. **Replace the migration if-ladder with a loop.** (~30 min)
   `migrations.py` repeats `if 1 not in applied... if 2 not in applied...`
   nine times. Put the migrations in a list and loop over it.

---

## The 3 big projects (do later, in this order)

1. **Give the "graph definition" a real type.** (~1–2 days)
   The graph definition is the blueprint that says which steps an agent runs
   and in what order. Today it's a raw untyped dictionary (`dict[str, Any]` —
   basically "a blob of JSON, good luck"), and **every** file that touches it
   re-checks its structure by hand with `node["kind"]`, `isinstance(...)`,
   `.get(..., {})`. Define the blueprint's shape *once* as a Pydantic model,
   validate it at the door, and pass the checked object around.
   *Payoff: this is the biggest one — it deletes defensive code everywhere
   and gives you autocomplete + real error messages. Do it before adding any
   new graph feature, not after.*

2. **Split the 1,050-line `portfolio_query/handlers.py`.** (~1 day)
   One file currently does three jobs: the pipeline steps, ~100 lines of
   options-trading math, and the parsing helpers from quick-win #1. Split it
   into 3–4 files along the seams that already exist. Also: the generic
   evaluation service hardcodes the name of one portfolio node — move that
   special case into the portfolio plugin where it belongs, so shared code
   stops knowing about one specific product.

3. **Build the missing frontend design scale + shared components.** (~2–3 days)
   Two problems with one fix:
   - There's no font-size scale — 200+ hand-typed pixel sizes like
     `text-[9px]` (some text is 7px — illegibly small). Define ~5 named
     sizes once, use those everywhere.
   - The same "card with a table in it" is hand-rebuilt on 9 screens, with
     the column layout string copy-pasted twice per screen (header + rows).
     Build one shared `<Card>` and `<DataList>` component; the
     loading/error/empty handling comes along for free.

---

## Already good — do not "improve" these away

- One place wires the whole backend together (`app.py`) — easy to test, easy
  to trace.
- Routes are thin; real logic lives in services. New engineers can read any
  route file in minutes.
- Immutability rules (finalized datasets, version hashes) are enforced *in
  code*, not just documented.
- The frontend theme system (colors as CSS variables, no flash on load, real
  keyboard/screen-reader support) is genuinely well built.
- `docs/architecture.md` actually matches the code. Keep it that way.

---

## Jargon decoder

| Term | Plain meaning here |
|---|---|
| **Stringly-typed** | Data accessed by magic strings (`node["kind"]`) instead of defined fields. Typos become runtime crashes instead of editor warnings. |
| **Typed model / schema** | A written-down shape for data ("a Node has an id, a kind, a handler"). The computer then checks it for you. |
| **"Parse, don't validate"** | Check messy input *once* at the entrance and convert it to a trusted shape — instead of every function re-checking it forever. |
| **Contract drift** | Backend and frontend each describe the API shape separately; one changes, the other doesn't, nothing warns you. |
| **Composition root** | The single startup file where all the pieces get plugged into each other (`app.py`). One place to look, one place to swap parts in tests. |
| **Plugin seam** | The designed extension point: add a new agent system by adding a folder, not by editing shared code. |
| **Design token** | A named value like `--warning` or `--surface` instead of a raw color/size. Change it once, whole app updates, themes stay consistent. |
| **Coercion helper** | Tiny function that safely converts untrusted input ("maybe a number?") into a definite value. |
| **Migration** | A numbered, one-time script that upgrades the database's table layout. |

---

**Next action:** pick quick win #1 or #2 and do it — both are under an hour
and shippable alone.
