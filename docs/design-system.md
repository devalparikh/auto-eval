# Design system

How AutoEval looks and moves, and why. Read this before changing the landing
page, adding a screen, or building any new surface. It records decisions that
are already implemented, so treat a conflict between this file and the code as
a bug in one of them.

Two references shaped the system. A long-form product marketing page in the
vein of **workers.io** gave the page architecture. A dark app-marketing page in
the vein of **x.ai/bot** gave the components and nearly all of the motion. Where
they conflict, the layout follows the first and the components follow the
second.

**[design-references.md](design-references.md) holds the research record**: the
measured values from both pages, their keyframes verbatim, a mapping from each
reference detail to where it lives in our code, and the places we deliberately
diverged. Go there when you need to know *why* a number is what it is, or when
you are extending a pattern and want the original proportions.

## The one rule

**Show the product doing the thing.** Never draw a decorative icon where a
small, real interface would fit. A card about trace policy shows toggles
flipping. A card about snapshots shows rows freezing. A step about comparing
models shows bars growing past a target line. If you cannot make a visual that
says something true about the product, use words and leave the space empty.

## What each reference contributed

Summary only — [design-references.md](design-references.md) has the measured
values and techniques behind each line.

**From the workers.io side — page architecture:**

- A bordered center column that reads like a document.
- Full-bleed hairlines between every section, drawn wider than the column.
- Corner crosshair ticks on visual bands, like registration marks.
- Mono uppercase eyebrows preceded by a 3px color bar.
- A marker highlight behind the second line of a headline, sweeping in on
  scroll.
- Numbered `STEP 01`–`STEP 04` columns.
- A `› link` under each section intro instead of a button.
- Photographic bands, heavily desaturated and tinted, with a grain overlay.
- `kbd` chips on buttons advertising real keyboard shortcuts.
- Per-section accent: each section sets its own `--eyebrow-bar` so the color
  names the topic.

**From the x.ai/bot side — components and motion:**

- 24px radius cards, 32px padding, no border, on a 20px gap grid.
- The visual pinned to the card's bottom edge with `margin-top: auto`.
- Inner panels at a 6% foreground tint, 16px radius.
- Pill badges at 12px on a 14% tint of their own color.
- Two badges stacked in one grid cell, crossfading between working and done.
- Chips that morph open to reveal a label.
- A labeled cursor gliding over a screenshot-like screen.
- A recording bar with a live timer and a pressed capture pill.
- Chat bubbles at 16px radius on a 6% tint, entries popping in with overshoot.
- Scene crossfades at ~0.5s when a card switches what it is showing.

## Tokens

Both the app (`frontend/src/app/globals.css`) and the landing page
(`frontend/src/features/landing/landing.module.css`) define their own token
sets, and the values agree. The landing page keeps its own copy because it
renders in a different color context than the workbench chrome around it.

| Role | Dark | Light |
|---|---|---|
| Page | `#0a0a0a` | `#fbfbfa` |
| Card | `#1a1a1a` | `#f4f3f0` |
| Raised surface | `#1a1a1a` | `#ffffff` |
| Ink | `#f2f2ef` | `#15171b` |
| Muted copy | `#9a9ea3` | `#5f646b` |
| Faint | `#6f7379` | `#8a8f96` |
| Hairline | `rgb(255 255 255 / 0.1)` | `rgb(21 23 27 / 0.11)` |
| Accent | `#f07a65` | `#df654f` |
| Success | `#6cc39a` | `#2f8a6d` |
| Warning | `#e8a33d` | `#b4854a` |
| Info | `#7fb2dc` | `#3f78a8` |
| Danger | `#ee7f74` | `#c2463a` |

Rules:

- **Never hardcode a color.** Every value above is a variable. New surfaces
  compose from them with `color-mix`, not new hexes.
- **The accent is a highlight, not a fill.** It marks the current step, the
  model span in a trace, the winning candidate, and one word in a headline. A
  screen with three accent-colored blocks has none.
- **Semantic colors carry meaning, not decoration.** Green means passed or
  frozen. Amber means working or draft. Blue means live or external. Red means
  failed or rejected. Grey means deterministic or inert.
- Layering is surface on page, hairline border, and a 6% ink wash for panels
  nested inside a card. Shadows appear only on things that genuinely float: the
  product window, tooltips, the dock.

## Type

- One family, Host Grotesk, for everything except code and data.
- A monospace stack for anything a machine produced or a person will copy: ids,
  hashes, paths, timings, costs, env keys, eyebrows, axis ticks, table headers.
  This is the strongest signal in the system. Mono means "this is data."
- Headings are weight 500 with `-0.035em` tracking. Never bold a heading; the
  size carries it.
- Body copy is 16px at 1.625 line-height in cards, smaller in dense product
  chrome. Muted, never full ink.
- Eyebrows are 11px mono, uppercase, `0.14em` tracking.

## Layout patterns

These five compositions cover nearly everything built so far. Reach for one
before inventing a sixth.

**The column.** `min(1120px, 100% - 4rem)` with vertical hairlines on both
sides. Every section draws a full-bleed horizontal rule at its top via an
absolutely positioned `::before` at `width: 100vw`.

**The band.** A full-width photographic section behind a product visual. The
photo is tinted with its own token, veiled at 76–82% opacity, desaturated to
~0.32, and grained with an inline SVG turbulence filter at low opacity. Corner
ticks mark the four corners. The photo is atmosphere; it must never compete
with the interface on top of it.

**The card.** Title, muted description, then the visual pushed to the bottom
with `margin-top: auto` and a 32px gap. **Visuals align along the bottom edge
of a card row.** That alignment is most of the perceived polish.

**The rail.** A product sidebar: workspace switcher at top, a mono section
label with a counter, the navigable items, and a status footer. Items are
borderless with a soft fill when active, a state dot per item, and progress
drawn as a thin bar down the active row's leading edge. Never give sidebar rows
their own borders and shadows; the rail is one surface.

**The window.** Chrome with three dots, a centered breadcrumb pill, and
right-aligned tools. Inside, a real layout at reduced scale. Never a
screenshot: these are live DOM and they animate, which is the point.

## Motion

Motion exists to explain a sequence, not to decorate.

### Curves

| Purpose | Curve | Duration |
|---|---|---|
| Enter with overshoot | `cubic-bezier(0.2, 0.9, 0.3, 1.15)` | 420ms |
| Settle, draw, morph | `cubic-bezier(0.22, 1, 0.36, 1)` | 320–600ms |
| Scroll reveal | `cubic-bezier(0.16, 1, 0.3, 1)` | 580–640ms |
| Color and opacity only | `ease` | 160–260ms |

### Timing

| Thing | Value |
|---|---|
| First element's delay after a scene opens | 80–120ms |
| Stagger between siblings | 110–140ms |
| Label trailing its own mark | +200ms |
| Scene beat (one step of a loop) | 1.2–2.6s |
| Auto-advance between tabs | ~7s, with a visible progress bar |
| Continuous breathe on an accent | 3.2s |
| Spinner rotation | 2.4s linear |

**Front-load the entrance.** An opening delay above ~200ms reads as lag, not
choreography. Stagger creates the sense of sequence; the leading delay only
creates waiting.

### The vocabulary

- **Pop in** — `opacity 0→1`, `translateY(8px)→0`, `scale(0.97)→1`. Every new
  entry, bubble, and row.
- **Row enter** — `translateX(-10px)→0`. List rows arriving in order.
- **Receipt check** — `scale(0.4)→1`. A check landing after its row.
- **Tile pop** — `scale(0.7) translateY(3px)→1`. Grid cells like pass/fail.
- **Dot pop** — same shape, animated from each element's **own** center via
  `transform-box: fill-box`. Chart points.
- **Badge swap** — two badges in one grid cell, the inactive at `opacity: 0`,
  crossfading over 260ms.
- **Pill morph** — a chip opens to reveal its label by animating
  `grid-template-columns: 0fr → 1fr`, label fading and sliding 6px.
- **Draw** — an edge or bar fills via `stroke-dashoffset` or `scaleX`, timed to
  the step that produced it.
- **Scene crossfade** — swapping what a panel shows, ~320ms opacity only.
- **Typing** — `clip-path: inset(0 100% 0 0)` animated with `steps()`, plus a
  blinking caret. Never a JS character loop.
- **Breathe** — opacity 1→0.5→1 over 3.2s. The only thing allowed to loop
  forever, and only on one element per view.

### Rules that matter more than the vocabulary

1. **Loop only while on screen.** `useSceneActive` gates every loop on
   `useInView` plus `prefers-reduced-motion`.
2. **One clock per scene.** A scene's beats come from a single `useCycle`
   schedule. An element on its own timer beside state-driven ones reads as
   confusing, not alive.
3. **Never loop back to empty.** Build once, settle in the finished state, and
   breathe a single accent element if you want continued life.
4. **Reserve the final height.** Anything that grows must already occupy its
   finished size, or the page jitters. Panels set `min-height`; late rows are
   rendered from the start and only revealed.
5. **Interaction beats playback.** Auto-advancing surfaces pause on hover and
   yield permanently once clicked. Always give a way back: an explicit replay
   control, never a timeout.
6. **Reduced motion is a real branch.** Render the finished state with every
   element visible. Never just set `animation: none` on something whose resting
   state is `opacity: 0` — that renders nothing.
7. **Animate from an element's own origin.** Scaling a group scales it from the
   group's corner and everything slides. Set `transform-box: fill-box` and
   `transform-origin: center` per element.
8. **Order by data, not by DOM.** Chart points enter cheapest-first so the eye
   reads the axis. Source order is an implementation detail.
9. **Motion is state, not decoration.** If an animation cannot be described as
   "this step finished, so this happened," cut it.

## Data visualization

- Quality on Y, cost on X. Shade the "most attractive quadrant" bounded by the
  medians and label it.
- Label points beside their marks; flip the label to the other side near an
  edge so it never clips.
- Color by vendor or category with a legend, not by value.
- **Every point is hoverable.** Give it an invisible ~14px hit circle, grow the
  mark, dim the others to 35%, and raise a card with the numbers **plus the run
  that produced them**. Provenance is the product; show it in the tooltip.
- Ticks, axis labels, and all numbers in mono.

## Diagrams must be true

A picture of a pipeline is a claim about how the system works. Reviewers read
it literally.

- **Show the real topology.** An early graph forked into two parallel branches
  for no reason and immediately drew the question "why would it fork like
  that?" It became one honest path: input → deterministic step → live fetch →
  model → check.
- **Type every node and color by type**, with the same colors the app uses.
- **Attach the interesting mechanism to the node that owns it.** The snapshot
  tag hangs off the live-fetch node and moves from pending, to capturing, to
  frozen as the run passes through.
- **Fill dead canvas with real content.** A large empty area under a diagram
  reads as unfinished. Ours became a step-output panel that follows the
  selected node.

## Components

### Status badge

A pill: `min-height: 20px`, `line-height: 1`, `padding: 3px 8px`, 12px text, a
14% tint of its tone, the tone as text color, with a 5px dot or a 10px spinner
at `flex: 0 0 auto`.

**Do not set a fixed height equal to the line-height.** That leaves flex
centering no slack and the glyphs sit high. Padding plus `line-height: 1` is
what actually centers text in a pill.

**Align a swap to the edge of the row it sits in** — `justify-items: end` in a
right-aligned header, `start` in a left-aligned column. Otherwise the narrower
badge visibly jumps as it swaps.

### Buttons

Ink-filled with a coral hover, 6px radius in the app, 3px on the landing page.
A `kbd` chip advertises a shortcut, and the shortcut is actually wired up. Do
not print a shortcut you have not implemented.

## Voice

Terse and concrete. The reader is an engineer who already knows the domain.

- **Cut anything the interface already says.** A panel titled "Datasets" does
  not need "Here you can manage your datasets."
- **Cut descriptions that restate their heading.** "Cost and accuracy" followed
  by "lower cost and higher accuracy are better" says nothing twice.
- **Cut trailing clauses that carry no fact** — "…so you can reuse it later"
  is the most common offender.
- **Keep anything stating a rule or consequence** the reader cannot infer:
  immutability, loopback-only operation, what to do next in an empty state.
- **State facts, not intentions.** "Finalizing locks the dataset" beats "This
  will allow you to lock your dataset."
- **No hedges**: you can, simply, please, in order to, just, note that.
- **Sentence case everywhere**, including buttons and headings.
- **Names over labels.** `claude-sonnet-5`, `failure-modes / v4`,
  `tr_01J8F2KQ`. Real identifiers make a mock feel like a product; generic
  placeholders like "Model A" make a product feel like a mock. Sample data uses
  real model names plus one plausible fine-tuned name of the user's own.
- Numbers belong in mono, in a table or on their own line, never buried in a
  sentence.

## Accessibility

- Decorative visuals are `aria-hidden`. Interactive ones get a role, a label,
  `tabIndex`, and keyboard handlers. Every clickable graph node responds to
  Enter and Space.
- Focus rings are a 2px accent outline at 3px offset. Never remove one without
  putting a visible substitute in the same place.
- Contrast holds in both themes. Muted copy is the floor; faint is for
  non-essential detail only.
- An aria-label is a promise about what the control does. When you shorten a
  visible label that doubles as the accessible name, keep it unambiguous.
- Changing an accessible name is a breaking change for tests. Grep before
  renaming.

## Learned the hard way

Every line here is a fix, not a preference. They repeat rules above because
these are the ones that actually got shipped wrong.

| Symptom | Cause | Fix |
|---|---|---|
| Badge text sits high in its pill | `height` equal to `line-height` | Padding plus `line-height: 1` |
| Badge jumps sideways as it swaps | Swap aligned to the wrong edge | Align to the row's own edge |
| A traveling dot "feels confusing" | Its own timer, ignoring node state | One clock; draw edges as steps finish |
| Cards resize while animating | Growing content with no reserved height | `min-height`; render late rows hidden |
| Marks look broken mid-scroll | Loop resetting to empty | Build once and settle |
| Nothing renders under reduced motion | `animation: none` on `opacity: 0` at rest | Force the finished state explicitly |
| Chart entrance "feels off" | Group scaled from a shared corner | Per-element origin, ordered by data |
| Dots take too long to appear | 420ms leading delay | 80ms, stagger does the work |
| Sidebar looks unpolished | Per-row borders and shadows | One surface, soft fill, state dots |
| Large empty canvas | Diagram sized for a bigger area | Fill it with a real output panel |
| "Why would it fork like that?" | Diagram not semantically true | Draw the actual topology |

## Checklist before shipping a surface

1. Does it read in both themes? Screenshot both.
2. Does anything shift height or width while it animates?
3. Does every loop stop off screen and under reduced motion?
4. Does the finished state make sense with all motion disabled?
5. Is there exactly one accent per view?
6. Is every number and identifier in mono?
7. Is every data point hoverable, and does the tooltip name its provenance?
8. Can you delete a sentence without losing a fact? Delete it.
