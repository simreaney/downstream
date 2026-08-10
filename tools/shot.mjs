/**
 * Screenshot the running game.
 *
 * `node tools/shot.mjs [--seed N] [--out path] [--keys m] [--wait ms]`
 *
 * The compute core can be checked headlessly against arrays, but the render
 * layer cannot — a curved-world shader that inverts, a toon ramp with the bands
 * the wrong way round or an overlay that replaces the terrain instead of tinting
 * it all typecheck perfectly and are obvious in a picture. So there is a picture.
 *
 * Uses the locally installed Google Chrome via playwright-core's `channel`
 * rather than downloading a browser. Chrome's own `--screenshot` flag is not
 * enough here: it relies on `--virtual-time-budget`, which fast-forwards timers
 * but not the worker's real CPU work, so it always fires mid-generation. This
 * waits on the boot overlay actually going away.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const seed = flag("seed", "20260809");
const out = resolve(flag("out", "tools/out/game.png"));
const keys = flag("keys", "");
const settle = Number(flag("wait", "1200"));
const port = 4173;

mkdirSync(dirname(out), { recursive: true });

const preview = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
  stdio: "ignore",
  detached: false,
});

// Give Vite a moment to bind before the first navigation attempt.
await new Promise((done) => setTimeout(done, 2500));

let browser;
try {
  browser = await chromium.launch({
    channel: "chrome",
    args: [
      // Headless Chrome has no GPU, so WebGL falls back to SwiftShader. Without
      // this flag the context creation fails and the canvas stays blank.
      "--enable-unsafe-swiftshader",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const problems = [];
  // Logged as they arrive, not collected for the end: a page that never
  // finishes booting throws on the wait and never reaches the summary, which is
  // exactly the case where the error matters most.
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(message.text());
      console.error(`  page error: ${message.text()}`);
    }
    if (message.type() === "info") console.log(`  page: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    problems.push(error.message);
    console.error(`  page exception: ${error.stack ?? error.message}`);
  });

  await page.goto(`http://localhost:${port}/diffusePollutionGame/?seed=${seed}`, {
    waitUntil: "load",
  });

  // Generation runs in the worker and takes about a second; the boot overlay
  // hides itself when the catchment is on screen.
  // `state: "hidden"` waits for the element to become invisible. The default is
  // "visible", which for an element that is hidden by design never resolves.
  await page.waitForSelector("#boot-status", { state: "hidden", timeout: 60_000 });
  await page.waitForTimeout(settle);

  // A script of key presses, with "-" as a pause and lowercase letters held
  // briefly so movement keys actually move the player.
  for (const key of keys) {
    if (key === "-") {
      await page.waitForTimeout(600);
      continue;
    }
    if ("wasd".includes(key)) {
      await page.keyboard.down(key);
      await page.waitForTimeout(700);
      await page.keyboard.up(key);
      continue;
    }
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
  }

  // `--reload` re-navigates to whatever URL the page has ended up with, which
  // is how the save round trip is checked end to end: press K, then come back
  // through the share link and confirm the world rebuilds.
  if (args.includes("--reload")) {
    const url = page.url();
    console.log(`  reloading ${url.length} chars of URL`);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#boot-status", { state: "hidden", timeout: 60_000 });
    await page.waitForTimeout(settle);
  }

  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} console error(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}
