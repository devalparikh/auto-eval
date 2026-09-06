# Design references

The research record behind [design-system.md](design-system.md). That file says
what to do; this one says where it came from and what the source actually
measured, so a future change can go back to the original rather than guessing
at a remembered impression.

Two public pages were inspected with a headless browser: computed styles were
read off live elements, and keyframes were dumped from `document.styleSheets`.
Everything below is an observation of a rendered page, not source code. Our
implementation re-expresses these ideas in our own tokens and component
structure; the numbers are here as calibration, not as something to paste.

- **workers.io** — page architecture, editorial layout, section rhythm.
- **x.ai/bot** — card composition, status vocabulary, and nearly all motion.

Where the two disagree, layout follows workers.io and components follow
x.ai/bot.

---

## workers.io — page architecture

### Measured

| Thing | Observed |
|---|---|
| Column width | `--lp-max: 1080px` |
| Column gutter | `--lp-pad: 20px`, `48px` at ≥640px |
| Column edges | `border-inline: 1px solid var(--border)`, `margin-inline: auto` |
| Body font | `ui-monospace, SFMono-Regular, Menlo, …` |
| Heading font | `Host Grotesk`, weight 500 |
| Heading color | `oklch(0.16 0.012 255)` |
| Body copy | 17px, line-height 27.2px, foreground at 75% alpha |
| Eyebrow | 11px mono, `letter-spacing: 1.54px` (0.14em), uppercase, weight 500 |
| Eyebrow bar | `::before`, 3px × 13px, `gap: 10px` |
| Step eyebrow | 12px, `letter-spacing: 1.68px` |
| Button | `radius: 3px`, `padding: 0 14px`, 14px, weight 500 |

### The techniques worth keeping

**Full-bleed rule inside a fixed column.** A section separator wider than the
column it divides:

```css
.lp-rule {
  position: absolute;
  left: 50%;
  width: 100vw;
  height: 1px;
  background: var(--border);
  transform: translate(-50%);
  z-index: 5;
}
/* dashed variant drops the fill and uses a border instead */
.lp-rule-dashed { border-top: 1px dashed var(--border); background: 0 0; height: 0 }
```

**Corner ticks from eight gradients.** Registration marks at the corners of a
band, drawn with no extra elements — four short bars per axis, plus four
background-colored patches that notch the inner corner:

```css
.lp-ticks::before {
  content: "";
  position: absolute;
  inset: -4.5px;
  z-index: 6;
  background-image: /* 4 fill patches, then 4 tick marks */ ;
  background-size: 7px 7px ×4, 9px 9px ×4;
  background-position: 1px 1px, right 1px top 1px, …, 0 0, 100% 0, 0 100%, 100% 100%;
  background-repeat: no-repeat;
}
```

**Marker highlight that survives line wrapping.** The key detail is
`box-decoration-break: clone`, which repaints the background on every wrapped
line instead of stretching one box:

```css
.lp-highlight {
  --lp-highlight-base: color-mix(in oklch, var(--primary) 30%, transparent);
  background-image: linear-gradient(var(--base), var(--base));
  background-position: 0 68%;
  background-size: 100% 1em;
  background-repeat: no-repeat;
  box-decoration-break: clone;
}
```

**Grain as an inline SVG filter**, blended over a tinted photo:

```css
.lp-grain::after {
  background-image: url("data:image/svg+xml,…feTurbulence
    type='fractalNoise' baseFrequency='0.85' numOctaves='2'…feColorMatrix
    type='saturate' values='0'…");
  mix-blend-mode: overlay;
  opacity: var(--lp-grain-opacity, 0.5);
}
```

**Photo panels blended, not just overlaid.** `background-blend-mode: luminosity`
over a flat tint, so one photo serves several sections in different colors:

```css
.lp-cta-panel {
  background-color: var(--visual-cta-bg);
  background-image: image-set(url("/backgrounds/clouds.webp") 1x, …);
  background-blend-mode: luminosity;
  background-size: cover;
}
```

**Per-section palette via cascading variables.** Each section sets
`--section-highlight`, `--section-cta`, `--section-rule`, and every child —
eyebrow bar, highlight, link color — reads from them. One class changes a whole
section's identity:

```css
.lp-section-maze     { --section-highlight: var(--visual-maze-bg);     --section-cta: var(--accent-orange) }
.lp-section-workload { --section-highlight: var(--visual-workload-bg); --section-cta: var(--accent-blue) }
.lp-section-security { --section-highlight: var(--visual-security-bg); --section-cta: var(--accent-orange) }
```

### Content rhythm

Eyebrow → two-line headline with the second line highlighted → one short
paragraph → a `›` text link. Then a full-width visual band. Then a
`STEP 01–03` row. That alternation of argument and evidence is the page's
whole structure, and it is what we copied at the section level.

### Skipped

Marquee logo strips, the `border-beam` rotating gradient, and the shimmer
keyframes (`hero-shimmer`, `border-shimmer`). All decorative; none say anything
about a product.

---

## x.ai/bot — components and motion

### Measured

| Thing | Observed |
|---|---|
| Page background | `rgb(10, 10, 10)` |
| Card background | `rgb(26, 26, 26)` |
| Card | `radius: 24px`, `padding: 32px`, `border: 0`, `shadow: none` |
| Card grid | 2 columns at `606px`, `gap: 20px` |
| Card title | 16px, weight 500, line-height 26px |
| Card body | 16px, weight 400, line-height 26px, `rgb(125, 129, 135)` |
| Card figure | `margin-top: auto`, `padding-top: 32px` |
| Hero h1 | 60px / 60px, weight 500, `letter-spacing: -1.2px` |
| Section h2 | 36px / 40px, `letter-spacing: -0.72px` |
| Section p | 18px / 29.25px, `rgb(125, 129, 135)` |
| Hero button | `radius: 9999px`, white on `rgb(10,10,10)`, `padding: 0 24px` |
| Inner panel | `rgba(255,255,255,0.06)`, `radius: 16px`, `padding: 10px 12px` |
| Panel text | 14px / 20px, `letter-spacing: -0.15px` |
| Panel title | 14px, weight 600 |
| Chat bubble | same 6% fill, `radius: 16px`, `padding: 8px 12px` |
| Floating window | `radius: 5px`, `shadow: 0 3px 12px rgb(0 0 0 / .14), 0 0 0 .5px rgb(0 0 0 / .1)` |

**Status badge** — the component we reproduced most closely:

| Property | Observed |
|---|---|
| Height | `19px`, `line-height: 19px` |
| Radius | `999px` |
| Padding | `0 7px` |
| Font | 12px, weight 400, `letter-spacing: -0.1px` |
| Background | tone at **14%** alpha |
| Color | the tone at full strength |
| Dot | `5px`, `radius: 999px`, `gap: 4px` |
| Spinner | `2.4s linear infinite` |
| Transition | `background-color .26s, color .26s, opacity .26s` |

> Note: their fixed `height: 19px` with `line-height: 19px` is exactly the
> pattern that centers text high in a pill. We adopted the proportions and
> rejected the box model — see the correction log in design-system.md.

**Pill morph** (`.avatar-row__pill`) — a chip that opens to show a label:

| Property | Observed |
|---|---|
| Size var | `--avatar-row-size: 2rem` |
| Morph duration | `--avatar-row-morph: 400ms` |
| Padding | `5.12px`, growing to `16px` on the leading edge when open |
| Ring | `box-shadow: inset 0 0 0 1px <tone>` |
| Transition | `background .4s, box-shadow .4s, color .4s, padding .4s` |
| Chip | 22px circle |
| Label closed | `opacity: 0`, `transform: translateX(-6px)` |
| Label | 14px, weight 500 |

**Recording bar**: 28px tall, 11px text; timer at `radius: 4px`,
`padding: 3px 6px`, `gap: 4px`, with a 5px **square-ish** record dot
(`radius: 1px`); capture pill 20px tall, `radius: 999px`, `padding: 0 9px`,
`transition: transform .12s, background .12s`, pressed via `data-pressed`.

**Scene crossfade** (`.feature-take`):
`transition: opacity 0.52s cubic-bezier(0.22, 1, 0.36, 1)`.

**Bar chart growth**:
`transition: height 0.5s cubic-bezier(0, 0, 0.2, 1)`.

### Keyframe catalog

Dumped verbatim. These are the source of our motion vocabulary.

```css
/* Enter with overshoot — the single most reused curve on the page.
   Applied as: 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.15) both */
@keyframes feature-entry-pop-in {
  0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0)   scale(1);    }
}

@keyframes baby-grok-bot-row-enter {
  0%   { opacity: 0; transform: translate(-10px); }
  100% { opacity: 1; transform: translate(0);     }
}

@keyframes baby-grok-bot-receipt-check {
  0%   { opacity: 0; transform: scale(0.4); }
  100% { opacity: 1; transform: scale(1);   }
}

@keyframes tilePopIn {
  0%   { opacity: 0; transform: scale(0.7) translateY(3px); }
  100% { opacity: 1; transform: scale(1)   translateY(0);   }
}

@keyframes barGrow      { 0% { transform: scaleY(0); } 100% { transform: scaleY(1); } }
@keyframes fadeSlideUp    { 0% { opacity: 0; transform: translateY(2px);  } 100% { opacity: 1; transform: translateY(0); } }
@keyframes fadeSlideRight { 0% { opacity: 0; transform: translateX(-2px); } 100% { opacity: 1; transform: translateX(0); } }

@keyframes baby-grok-bot-pending-label-in {
  0% { opacity: 0; transform: translateY(5px); } 100% { opacity: 1; transform: translateY(0); }
}

/* Three-dot typing indicator, offset per dot */
@keyframes baby-grok-bot-typing-dot {
  0%, 55%, 100% { opacity: 0.25; }
  25%           { opacity: 0.7;  }
}

/* An agent cursor wandering a screenshot */
@keyframes baby-grok-bot-portal-agent-cursor {
  0%   { opacity: 0; top: 12%; left: 34%; }
  8%   { opacity: 1; }
  20%  { top: 24%; left: 52%; }
  36%  { top: 36%; left: 38%; }
  52%  { top: 48%; left: 58%; }
  68%  { top: 60%; left: 42%; }
  84%  { top: 72%; left: 54%; }
  100% { opacity: 1; top: 78%; left: 38%; }
}

@keyframes pulse    { 50%  { opacity: 0.5; } }
@keyframes spin     { 100% { transform: rotate(360deg); } }
@keyframes waveform { 0%, 100% { height: calc(var(--bar-h, 100%) * .4); } 50% { height: var(--bar-h, 100%); } }

@keyframes tooltip-in      { 0% { opacity: 0; transform: scale(0.96) translateY(2px);  } 100% { opacity: 1; transform: scale(1) translateY(0); } }
@keyframes context-menu-in { 0% { opacity: 0; transform: scale(0.95) translateY(-4px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
@keyframes sonner-fade-in  { 0% { opacity: 0; transform: scale(0.8); } 100% { opacity: 1; transform: scale(1); } }
```

### Composition patterns

- **Card anatomy** is fixed: `<h3>` → `<p>` → `<figure class="mt-auto pt-8">`.
  The figure holds a stage that holds a live miniature. Because every figure
  uses `margin-top: auto`, visuals align along the bottom of a card row
  regardless of how long the copy is.
- **Badge swap**: two badges occupy one grid cell; the inactive one carries
  `data-hidden="true"` and fades to `opacity: 0` over 260ms. Nothing reflows.
- **The miniature is real DOM**, not an image: a scaled window chrome with a
  fake sidebar, skeleton bars, and a form, all at 3–11px sizes. That is why it
  can animate.
- **`inert`** is set on the whole decorative subtree, so none of it is
  focusable.

### Skipped

Their `--rd-content-scale` approach (render at full size, then scale the whole
subtree with a transform) — we size our miniatures directly in an SVG viewBox
instead, which stays crisp and lets us hit-test nodes. Also skipped: the
waveform bars and the sonner toast animations, neither of which we need.

---

## Mapping: reference → ours

| Reference detail | Ours | Lives in |
|---|---|---|
| `--lp-max: 1080px`, bordered column | `min(1120px, 100% - 4rem)`, `border-inline` | `.frame` |
| `.lp-rule` 100vw separator | same technique, `::before` per section | `.section::before` et al. |
| `.lp-ticks` 8-gradient corners | same, `inset: -5px`, 9px arms | `.ticks` |
| `.lp-eyebrow` + 3px bar | same, 0.14em, `--eyebrow-bar` per section | `.eyebrow` |
| `.lp-highlight` + `box-decoration-break` | same, animated `background-size` on scroll | `.highlight` |
| `.lp-grain` feTurbulence | same filter, `opacity: var(--grain)` | `.bandInner::before` |
| Per-section palette vars | `--eyebrow-bar` on `#trace`, `#compare`, … | `.sectionTrace` et al. |
| Card 24px / 32px / no border | identical | `.card` |
| Figure `mt-auto pt-8` | `margin-top: auto`, 32px | `.cardVisual` |
| Inner panel 6% / 16px | identical | `.panel` |
| Badge 14% tint, 999px, dot, 2.4s spinner | proportions kept, box model fixed | `.badge` |
| Badge swap `data-hidden`, 260ms | identical | `.badgeSwap` |
| `feature-entry-pop-in` | `entryPopIn`, same values and curve | `landing.module.css` |
| `baby-grok-bot-row-enter` | `rowEnter` | ” |
| `baby-grok-bot-receipt-check` | `checkPop` | ” |
| `tilePopIn` | `tilePop` | ” |
| `barGrow` | `markGrow`, `qualityCell` fill | ” |
| Pill morph 400ms | `grid-template-columns: 0fr → 1fr` | `.pillSpread` |
| Agent cursor over a screen | `Cursor` with `left`/`top` transitions | `feature-cards.tsx` |
| Recording bar + timer + record dot | identical proportions | `.recordingBar` |
| `.feature-take` 0.52s crossfade | 0.32s via `AnimatePresence` | `.previewTake` |
| Chat bubble 16px / 6% | identical | `.bubble` |
| Floating window shadow | identical two-layer shadow | `.window`, `.editor` |

## Deviations, and why

- **Pill box model.** Their fixed height equal to line-height sits text high.
  Ours uses padding and `line-height: 1`.
- **Loop policy.** Several of their scenes loop back to their empty state.
  Ours build once and settle, because a viewer arriving mid-cycle otherwise
  sees a blank panel. Only one accent element per view breathes.
- **Crossfade length.** 0.52s felt slow when the panel is also auto-advancing
  on a ~7s cycle, so scene changes are 0.32s.
- **Miniatures are SVG**, not transform-scaled DOM, so nodes stay crisp and can
  be clicked and focused.
- **Everything is interactive where it claims to be.** Their miniatures are
  `inert` decoration. Our trace graph is genuinely clickable, takes keyboard
  focus, and pauses playback when used — decorative-only visuals still get
  `aria-hidden`.
- **Reduced motion is a real branch**, not just suppressed animation.
