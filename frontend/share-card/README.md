# Share card

The link preview for AutoEval: what people see when the site is pasted into
Slack, X, LinkedIn, Messages or Discord. `card.html` is the source, and
`render.mjs` turns it into three files in `public/images/`:

| File | Size | Used as |
|---|---|---|
| `autoeval-share-v2.jpg` | 1200×630 | `og:image` and the X card, the frame most platforms show |
| `autoeval-share-v2.mp4` | 1200×630, 10.4 s loop | `og:video`, played by Messages and some chat apps |
| `autoeval-github-preview-v2.jpg` | 1280×640 | the repository's social preview, uploaded by hand in **Settings → General → Social preview** |

```bash
cd frontend
node share-card/render.mjs            # stills and video, about three minutes
STILLS_ONLY=1 node share-card/render.mjs
```

Set `CHROMIUM` to a browser executable if Playwright's own is not installed, and
`FFMPEG` if `ffmpeg` is not on the path. Open `card.html?play` in a browser for a
realtime preview, or `card.html?t=4.3` for a still at that time.

## What it shows

The landing page's sample story, with the same run, case and numbers as
`features/landing/product-preview.tsx`:

1. **Trace.** `tr_01J8F2KQ` plays through normalize → retrieve → generate →
   format, the retrieve node freezes snapshot `93f2`, and the timing waterfall
   fills. Scoring runs beside the graph: `citation_format` passes and
   `grounding` fails at 0.41.
2. **Save.** The cursor saves the failed check. The row lifts out of the trace
   and lands as case 128 in `failure-modes`, the other cases make room, and
   **Finalize v4** locks the dataset.
3. **Compare.** All six candidates run on the locked cases, bars filling
   cheapest first. When the run completes the board sorts and
   `Sonnet 5 · graph v8` climbs from last to first: 96%, three points over the
   baseline at a third less cost. The dotted headline flashes once.

If the story or its numbers change on the landing page, change them here and
re-render, so the preview never disagrees with the page it links to.

## Why it is built this way

- **The still does most of the work.** X, LinkedIn and Slack show only
  `og:image`, so the poster is a complete card on its own: the headline, and the
  finished benchmark as proof. Every element is sized to survive being shown at
  a third of its size, which is how most feeds and the portfolio drawer show it.
  The dot pitch of the coral line is tighter than on the landing page so it stays
  coral, rather than going brown, when the card is shrunk.
- **The loop opens on the poster.** Messages downloads an `og:video` that points
  at an MP4 file and plays it automatically
  ([TN3156](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages)).
  It shows the still first, so the video's first frame is the same image and the
  handover is invisible.
- **MP4, not GIF.** A GIF of the scenery band would be several megabytes and
  dithered, and most platforms freeze a GIF on its first frame anyway. The MP4 is
  H.264 with fast-start metadata, silent, and well under Messages' 10 MB limit
  for preview resources.
- **Seamless, never empty.** The timeline settles on the finished benchmark and
  holds, then crossfades back to the trace, the same way the landing preview
  advances between steps. Nothing loops back to a blank screen.
- **One clock.** As in the landing scenes, every style is computed from time in
  `seek(t)`, with the product's own curves from the design system. No CSS
  transitions or timers, so each frame renders on its own and the loop can start
  anywhere.
- **Fonts are bundled.** Host Grotesk comes from `public/fonts`; Geist Mono is
  in `fonts/` so the mono text renders the same on any machine (the app's
  SF Mono stack is not available to a headless browser on Linux).
