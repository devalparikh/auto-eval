# Design system

How AutoEval looks and moves, and why. Read this before changing the landing
page, adding a screen, or building any new surface. It records decisions that
are already implemented, so treat a conflict between this file and the code as
a bug in one of them.

Two references shaped the current system. The bordered center column, the
full-bleed rules, the mono eyebrows, and the marker highlights come from a
long-form product marketing page in the vein of workers.io. The rounded cards
with live product miniatures inside, and nearly all of the motion vocabulary,
come from a dark app-marketing page in the vein of x.ai/bot. Where the two
conflict, the layout is the first and the components are the second.

## The one rule

**Show the product doing the thing.** Never draw a decorative icon where a
small, real interface would fit. A card about trace policy shows toggles
flipping. A card about snapshots shows rows freezing. A step about comparing
models shows bars growing past a target line. If you cannot make a visual that
says something true about the product, use words instead and leave the space
empty.

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
- Eyebrows are 11px mono, uppercase, `0.14em` tracking, preceded by a 3px color
  bar whose color names the section.

## Layout

- The landing page is a **bordered center column**, `min(1120px, 100% - 4rem)`,
  with vertical hairlines on both sides. Every section draws a **full-bleed
  horizontal rule** across the whole viewport at its top, using an absolutely
  positioned `::before` at `width: 100vw`. The column feels like a document, the
  rules feel like a spec sheet.
- Visual bands get **corner crosshair ticks** drawn as eight background
  gradients inset by 5px. They read as registration marks.
- Cards are 24px radius, 32px padding, no border in dark, hairline in light,
  laid out on a 20px gap grid. Compact variants are 24px padding.
- The card interior is always: title, muted description, then the visual pushed
  to the bottom with `margin-top: auto` and a 32px gap. **Visuals align along
  the bottom edge of a card row.** That alignment is most of the polish.

## Motion

Motion exists to explain a sequence, not to decorate. Everything below is
implemented in `landing.module.css` and `landing-motion.ts`.

### Curves

| Purpose | Curve | Duration |
|---|---|---|
| Enter with overshoot | `cubic-bezier(0.2, 0.9, 0.3, 1.15)` | 420ms |
| Settle, draw, morph | `cubic-bezier(0.22, 1, 0.36, 1)` | 320-600ms |
| Scroll reveal | `cubic-bezier(0.16, 1, 0.3, 1)` | 580-640ms |
| Color and opacity only | `ease` | 160-260ms |

### The vocabulary

- **Pop in**: `opacity 0 → 1`, `translateY(8px) → 0`, `scale(0.97) → 1`. Every
  new entry, bubble, and row uses this. Stagger siblings by 110-140ms.
- **Row enter**: `translateX(-10px) → 0`. For list rows that arrive in order.
- **Receipt check**: `scale(0.4) → 1`. For a check mark landing after its row.
- **Tile pop**: `scale(0.7) translateY(3px) → 1`. For grid cells like pass/fail.
- **Badge swap**: two badges in one grid cell, the inactive one at `opacity: 0`,
  crossfading over 260ms. Used everywhere a thing goes from working to done.
- **Pill morph**: a chip opens to reveal a label by animating
  `grid-template-columns: 0fr → 1fr` with the label fading and sliding 6px.
- **Draw**: an edge or bar fills via `stroke-dashoffset` or `scaleX` from its
  origin, timed to the step that produced it.

### Rules that matter more than the vocabulary

1. **Loop only while on screen.** `useSceneActive` gates every loop on
   `useInView` plus `prefers-reduced-motion`. Nothing animates off screen.
2. **One clock per scene.** A scene's beats come from a single `useCycle`
   schedule. Independent timers that drift out of sync read as broken. A
   free-running element that ignores the scene's state is worse than no motion:
   an earlier version had a pulse traveling a graph on its own timer while the
   nodes advanced on another, and it read as confusing rather than alive.
3. **Never loop back to empty.** If a build-up animation resets, a viewer
   arriving mid-cycle sees a half-drawn or blank state and reads it as broken.
   Build once, settle in the finished state, and if you want continued life,
   breathe a single accent element.
4. **Reserve the final height.** Anything that grows as it animates must
   already occupy its finished height, or the page jitters. Compact panels set
   a `min-height`; rows that appear late are rendered from the start and only
   revealed.
5. **Interaction beats playback.** Any auto-advancing surface pauses on hover
   and yields permanently once the viewer clicks. Give them a way back: an
   explicit replay control, not a timeout.
6. **Reduced motion is a real branch.** Under `prefers-reduced-motion`, scenes
   render their finished state with every element visible. Never just set
   `animation: none` on something whose resting state is `opacity: 0`.

## Components

### Status badge

A pill: `min-height: 20px`, `line-height: 1`, `padding: 3px 8px`, 12px text, a
14% tint of its tone, the tone as text color, with a 5px dot or a 10px spinner
at `flex: 0 0 auto`.

**Do not set a fixed height equal to the line-height.** That was a real bug
here: `height: 19px` with `line-height: 19px` leaves flex centering no slack, so
the glyphs sit high inside the pill. Padding plus `line-height: 1` is what
actually centers text in a pill.

When two badges swap in place, align them to the same edge as the row they sit
in: `justify-items: end` for a right-aligned header, `start` for a left-aligned
column. Otherwise the narrower badge visibly jumps.

### Buttons

Ink-filled with a coral hover, 6px radius on the app, 3px on the landing page.
A `kbd` chip inside a landing button advertises its shortcut, and the shortcut
is actually wired up. Do not print a shortcut you have not implemented.

### Product miniatures

A window chrome with three dots, a centered breadcrumb, and right-aligned tools.
Inside, a real layout at reduced scale. Never a screenshot: these are live DOM
and they animate, which is the whole point.

### Charts

Score on Y, cost on X, a shaded "most attractive quadrant" bounded by the
medians, model names labeled beside their points, mono ticks. Points enter
staggered in data order, not DOM order, so the eye reads the axis. Hovering a
point dims the others to 35% and raises a card with the numbers plus the run
that produced them.

## Voice

Terse and concrete. The reader is an engineer who already knows the domain.

- **Cut anything the interface already says.** A panel titled "Datasets" does
  not need "Here you can manage your datasets."
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

Non-negotiable, and cheap if you do it while building:

- Decorative visuals are `aria-hidden`. Interactive ones get a role, a label,
  `tabIndex`, and keyboard handlers. Every clickable graph node in the trace
  preview responds to Enter and Space.
- Focus rings are a 2px accent outline at 3px offset. Never remove one without
  putting a visible substitute in the same place.
- Contrast holds in both themes. Muted copy is the floor, faint is for
  non-essential detail only.
- An aria-label is a promise about what the control does. When you shorten a
  visible label that doubles as the accessible name, keep it unambiguous.

## Checklist before shipping a surface

1. Does it read in both themes? Screenshot both.
2. Does anything shift height or width while it animates?
3. Does every loop stop off screen and under reduced motion?
4. Does the finished state make sense with all motion disabled?
5. Is there exactly one accent per view?
6. Is every number and identifier in mono?
7. Can you delete a sentence without losing a fact? Delete it.
