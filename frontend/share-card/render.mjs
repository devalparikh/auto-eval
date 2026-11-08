// Renders card.html into the link-preview assets in public/images:
//
//   autoeval-share-v2.jpg            1200x630 poster, the og:image
//   autoeval-share-v2.mp4            1200x630 seamless loop, the og:video
//   autoeval-github-preview-v2.jpg   1280x640 still for the repository's social preview
//
// Frames are captured at 2x and downscaled, and each video frame blends four
// subframes (a 180° shutter) so fast moves carry a little motion blur. The video
// starts on the poster frame, so a player that shows the og:image first cuts
// into the loop without a jump.
//
//   cd frontend && node share-card/render.mjs
//
// Env: FFMPEG (default "ffmpeg"), CHROMIUM (browser executable), WORKERS
// (default 4), FPS (default 30), STILLS_ONLY=1 to skip the video.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const images = join(here, "..", "public", "images");
const build = join(here, "build");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FPS = Number(process.env.FPS || 30);
const WORKERS = Number(process.env.WORKERS || 4);
const SUB = [-0.1875, -0.0625, 0.0625, 0.1875];
const card = (query = "") => pathToFileURL(join(here, "card.html")).href + query;
const launch = { executablePath: process.env.CHROMIUM || undefined };

function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-y", "-loglevel", "error", ...args], {
      stdio: [input ? "pipe" : "ignore", "inherit", "inherit"],
    });
    child.on("close", (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve()));
    if (input) input(child.stdin);
  });
}

async function open(browser, width, height, query = "") {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error));
  await page.goto(card(query));
  await page.evaluate(() => window.ready);
  return page;
}

async function still(browser, { width, height, query, out, scale }) {
  const page = await open(browser, width, height, query);
  await page.evaluate(() => window.seek(window.POSTER));
  const png = await page.screenshot({ type: "png" });
  await page.close();
  await run(["-f", "png_pipe", "-i", "-", "-vf", `scale=${scale}:flags=lanczos`, "-pix_fmt", "yuvj444p", "-q:v", "2", out], (stdin) => stdin.end(png));
}

async function chunk(browser, index, from, to, dur, poster) {
  const page = await open(browser, 1200, 630);
  const file = join(build, `chunk_${String(index).padStart(2, "0")}.mkv`);
  const blend = `tmix=frames=${SUB.length},select='eq(mod(n\\,${SUB.length})\\,${SUB.length - 1})',setpts=N/${FPS}/TB,scale=1200:630:flags=lanczos`;
  const done = run(["-f", "image2pipe", "-c:v", "png", "-framerate", String(FPS * SUB.length), "-i", "-", "-vf", blend, "-fps_mode", "passthrough", "-c:v", "ffv1", "-pix_fmt", "rgb24", file], async (stdin) => {
    for (let f = from; f < to; f++) {
      for (const offset of SUB) {
        // the loop is seamless, so time simply wraps past the end
        await page.evaluate((t) => window.seek(t), poster + (f + offset) / FPS);
        const png = await page.screenshot({ type: "png" });
        if (!stdin.write(png)) await new Promise((resolve) => stdin.once("drain", resolve));
      }
    }
    stdin.end();
  });
  await done;
  await page.close();
  return file;
}

mkdirSync(build, { recursive: true });
const browser = await chromium.launch(launch);

await still(browser, { width: 1200, height: 630, query: "", out: join(images, "autoeval-share-v2.jpg"), scale: "1200:630" });
await still(browser, { width: 1280, height: 640, query: "?w=1280&h=640", out: join(images, "autoeval-github-preview-v2.jpg"), scale: "1280:640" });

if (!process.env.STILLS_ONLY) {
  const probe = await open(browser, 1200, 630);
  const { dur, poster } = await probe.evaluate(() => ({ dur: window.DUR, poster: window.POSTER }));
  await probe.close();
  const total = Math.round(dur * FPS);
  const per = Math.ceil(total / WORKERS);
  const jobs = [];
  for (let i = 0; i < WORKERS; i++) {
    const from = i * per, to = Math.min(total, from + per);
    if (from < to) jobs.push(chunk(browser, i, from, to, dur, poster));
  }
  const files = await Promise.all(jobs);
  writeFileSync(join(build, "chunks.txt"), files.map((file) => `file '${file}'`).join("\n"));
  // Re-time after the join: the chunks' millisecond timestamps round differently,
  // and resampling to a frame rate would drop or repeat a frame at a seam.
  // One keyframe for the whole loop: a keyframe mid-loop re-quantizes the
  // grained band and reads as a faint flicker every couple of seconds.
  await run(["-f", "concat", "-safe", "0", "-i", join(build, "chunks.txt"), "-vf", `setpts=N/${FPS}/TB`, "-fps_mode", "passthrough",
    "-c:v", "libx264", "-preset", "veryslow", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-g", String(total), "-keyint_min", String(total), "-sc_threshold", "0",
    "-video_track_timescale", String(FPS * 1000), "-movflags", "+faststart", "-an", join(images, "autoeval-share-v2.mp4")]);
  console.log(`rendered ${total} frames (${dur}s at ${FPS} fps)`);
}

await browser.close();
rmSync(build, { recursive: true, force: true });
for (const name of ["autoeval-share-v2.jpg", "autoeval-share-v2.mp4", "autoeval-github-preview-v2.jpg"]) {
  try {
    console.log(`${name}  ${(statSync(join(images, name)).size / 1024).toFixed(0)} KB`);
  } catch {
    // stills-only runs skip the video
  }
}
