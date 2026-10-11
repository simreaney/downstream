/**
 * Record the landing page's first-person VR clip.
 *
 * `node tools/record-vr.mjs [--seed N] [--out public/media] [--frames-only] [--chrome PATH]`
 *
 * Runs the game in Meta's Immersive Web Emulation Runtime (the `iwer` package)
 * as a Quest 3, presses the page's "First person" button, and plays a short
 * scripted walk by moving the emulated headset and pushing the emulated
 * controllers' sticks and buttons. The game cannot tell it from a headset:
 * every frame goes through the same session, rig and controls a Quest's would.
 *
 * Rendered one frame at a time rather than screencast. The page's clock is
 * replaced before anything loads: once the session is running,
 * `requestAnimationFrame` only fires when the script steps it, and
 * `performance.now()` reports the stepped time. Each step renders one frame at
 * 30 fps of game time and reads it straight back off the canvas, so the clip is
 * smooth however long a frame takes to draw — which, with no GPU and Chrome
 * falling back to SwiftShader, is most of a second.
 *
 * The emulator draws one eye at a time when stereo is off, so the clip is a
 * single undistorted view rather than the side-by-side pair a headset mirror
 * shows.
 *
 * Writes `vr-first-person.mp4` and `vr-first-person-poster.jpg`. With
 * `--frames-only` it stops at the frames, and leaves them in
 * `tools/out/record-vr-frames/` to look through.
 *
 * Needs `ffmpeg` on the PATH.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const root = fileURLToPath(new URL("..", import.meta.url));
// The trailer's seed: the player starts by the village between two streams.
const seed = Number(flag("seed", "132"));
const out = resolve(root, flag("out", "public/media"));
const chrome = flag("chrome", process.env.CHROME_PATH ?? "");
const framesOnly = args.includes("--frames-only");
const port = 5177;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
/** A standing player's eyes, in metres above the floor. */
const EYE_HEIGHT = 1.6;
/** Vertical field of view, in degrees: narrower than the headset's, which looks fish-eyed on a flat screen. */
const FOV_Y = 68;

const framesDir = join(root, "tools/out/record-vr-frames");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(out, { recursive: true });

/** iwer, bundled into a script the page can run before any of its own. */
const runtime = (
  await build({
    stdin: {
      contents: 'import { XRDevice, metaQuest3 } from "iwer"; window.__iwer = { XRDevice, metaQuest3 };',
      resolveDir: root,
    },
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "warning",
  })
).outputFiles[0].text;

const server = await createServer({
  root,
  logLevel: "warn",
  cacheDir: "node_modules/.vite-record-vr",
  server: { port, strictPort: true, hmr: false, watch: null },
});
await server.listen();
const base = `http://localhost:${port}${server.config.base}`;

const browser = await chromium.launch({
  ...(chrome ? { executablePath: chrome } : { channel: "chrome" }),
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  await record();
} finally {
  await browser.close();
  await server.close();
}

/**
 * Runs in the page before anything else. Leaves the clock alone until
 * `__clock.freeze()`, then hands frames out only on `__clock.step()`.
 */
function installClock() {
  const nativeNow = performance.now.bind(performance);
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let frozen = false;
  let now = 0;
  let queue = new Map();
  let nextId = 1;

  performance.now = () => (frozen ? now : nativeNow());
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    if (frozen) {
      queue.set(id, callback);
      return id;
    }
    // A frame requested before the freeze but delivered after it waits for
    // the next step, so no callback ever sees the real clock again.
    const native = nativeRaf((time) => {
      if (frozen) queue.set(id, callback);
      else callback(time);
    });
    pending.set(id, native);
    return id;
  };
  const pending = new Map();
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
    const native = pending.get(id);
    if (native !== undefined) nativeCancel(native);
  };

  window.__clock = {
    freeze() {
      now = nativeNow();
      frozen = true;
    },
    step(ms) {
      now += ms;
      const due = queue;
      queue = new Map();
      for (const callback of due.values()) callback(now);
    },
  };
}

/** Runs in the page, after `installClock` and the bundled runtime. */
function installHeadset({ eyeHeight, fovY }) {
  const { XRDevice, metaQuest3 } = window.__iwer;
  const device = new XRDevice(metaQuest3);
  // Forced: headless Chrome has a navigator.xr of its own, with no device behind it.
  device.installRuntime({ forceInstall: true });
  device.stereoEnabled = false;
  device.fovy = (fovY * Math.PI) / 180;
  device.position.set(0, eyeHeight, 0);
  window.__device = device;
}

async function record() {
  const code = await saveCode();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => console.error(`  page exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`  page error: ${message.text()}`);
  });
  await page.addInitScript(installClock);
  await page.addInitScript({ content: runtime });
  await page.addInitScript(installHeadset, { eyeHeight: EYE_HEIGHT, fovY: FOV_Y });

  console.log(`loading seed ${seed}`);
  await page.goto(`${base}play/?seed=${seed}&lang=en#s=${code}`, { waitUntil: "load" });
  await page.waitForSelector("#boot-status", { state: "hidden", timeout: 180_000 });
  await page.click('.hud__vr-button[data-view="firstPerson"]');
  await page.waitForFunction(() => window.__device.activeSession !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__clock.freeze());

  let frame = 0;
  /** Hold the current input for `seconds`, writing a frame per step. */
  const run = async (seconds, each = () => {}) => {
    const steps = Math.round(seconds * FPS);
    for (let i = 0; i < steps; i++) {
      await each(i / steps);
      // Read back in the same task as the draw, before the canvas is presented and cleared.
      const data = await page.evaluate((ms) => {
        window.__clock.step(ms);
        return window.__device.appCanvas.toDataURL("image/jpeg", 0.95);
      }, 1000 / FPS);
      writeFileSync(join(framesDir, `${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
      frame++;
      if (frame % FPS === 0) console.log(`  ${frame / FPS} s`);
    }
  };

  /** Set the headset's yaw and pitch, in degrees; yaw left is positive. */
  const look = (yaw, pitch) =>
    page.evaluate(
      ({ yaw, pitch }) => {
        const y = (yaw * Math.PI) / 360;
        const p = (pitch * Math.PI) / 360;
        // Yaw then pitch, as a head turns: q = qy · qx.
        const [cy, sy, cp, sp] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p)];
        window.__device.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      },
      { yaw, pitch },
    );
  const stick = (hand, x, y) =>
    page.evaluate(({ hand, x, y }) => window.__device.controllers[hand].updateAxes("thumbstick", x, y), { hand, x, y });
  const button = (hand, id, value) =>
    page.evaluate(({ hand, id, value }) => window.__device.controllers[hand].updateButtonValue(id, value), {
      hand,
      id,
      value,
    });
  const tap = async (hand, id) => {
    await button(hand, id, 1);
    await run(0.2);
    await button(hand, id, 0);
  };
  const ease = (t) => t * t * (3 - 2 * t);
  /** Turn the head smoothly from one pose to another. */
  const pan = (from, to, seconds) =>
    run(seconds, (t) => look(from[0] + (to[0] - from[0]) * ease(t), from[1] + (to[1] - from[1]) * ease(t)));

  // Controllers held low at the sides, out of the way of the view.
  await page.evaluate(() => {
    const { left, right } = window.__device.controllers;
    left.position.set(-0.2, 1.05, -0.3);
    right.position.set(0.2, 1.05, -0.3);
  });

  console.log("recording");
  await look(0, -8);
  await run(0.5);
  // Settle, then look round the valley at life size.
  await pan([0, -8], [40, -4], 2.5);
  await pan([40, -4], [-35, -6], 3.5);
  await pan([-35, -6], [0, -14], 2);
  // Walk ahead, looking down at the ground in front.
  await stick("left", 0, -1);
  await run(4);
  // The risk map for a few steps — it floods the view with colour, so not for
  // long — then off again.
  await tap("left", "x-button");
  await run(2.2);
  await stick("left", 0, 0);
  await pan([0, -14], [-25, -10], 1.2);
  await pan([-25, -10], [0, -14], 1);
  await tap("left", "y-button");
  await run(0.6);
  // Look down at the build spot and plant, then step back to see it.
  await pan([0, -14], [0, -24], 1);
  await tap("right", "a-button");
  await run(1.2);
  await stick("left", 0, 0.8);
  await pan([0, -24], [0, -6], 1.6);
  await stick("left", 0, 0);
  await run(1.2);
  // A glance at the panel on the left, then a snap turn and on.
  await pan([0, -6], [55, -32], 1.8);
  await run(1.5);
  await pan([55, -32], [0, -10], 1.5);
  await stick("right", 0.9, 0);
  await run(0.3);
  await stick("right", 0, 0);
  await run(0.8);
  await stick("left", 0, -1);
  await run(3);
  await stick("left", 0, 0);
  await run(1);

  if (framesOnly) {
    console.log(`  ${frame} frames in ${framesDir}`);
    return;
  }
  encode(frame);
  rmSync(framesDir, { recursive: true, force: true });
}

/** A share code for this seed with plenty of stock, so the tutorial is skipped and every build is affordable. */
async function saveCode() {
  const page = await browser.newPage();
  await page.goto(base);
  const code = await page.evaluate(
    async ({ seed, basePath }) => {
      const save = await import(`${basePath}src/game/save.ts`);
      const config = await import(`${basePath}src/config.ts`);
      return save.serialise({
        version: save.SAVE_VERSION,
        seed,
        sizeId: config.DEFAULT_LANDSCAPE_SIZE,
        elapsedSeconds: 0,
        wood: 80,
        stone: 60,
        hasSpade: true,
        collected: [],
        interventions: [],
      });
    },
    { seed, basePath: server.config.base },
  );
  await page.close();
  return code;
}

function encode(count) {
  const seconds = count / FPS;
  const fade = `,fade=t=in:st=0:d=0.4,fade=t=out:st=${(seconds - 0.6).toFixed(2)}:d=0.6`;
  const encodeOne = (name, width, crf) => {
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-framerate", String(FPS), "-i", join(framesDir, "%05d.jpg"),
        "-vf", `scale=${width}:-2:flags=lanczos${fade},format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
        "-profile:v", "high", "-movflags", "+faststart", "-an",
        join(out, `${name}.mp4`),
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
    console.log(`  wrote ${name}.mp4 (${seconds.toFixed(1)} s)`);
  };
  encodeOne("vr-first-person", WIDTH, 21);

  // The poster: walking towards the build spot, with its readout up.
  const poster = Math.min(count - 1, Math.round(11 * FPS));
  const still = join(framesDir, `${String(poster).padStart(5, "0")}.jpg`);
  for (const [name, width] of [["vr-first-person-poster", WIDTH]]) {
    const result = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", still, "-vf", `scale=${width}:-2`, "-q:v", "3", join(out, `${name}.jpg`)],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
  }
}
