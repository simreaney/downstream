/**
 * Record the landing page's trailer and screenshots.
 *
 * `node tools/record.mjs [--seed N] [--out public/media] [--only video|stills] [--keep-frames]`
 *
 * Plays a short, scripted session: an establishing orbit of the catchment,
 * then the risk map, a leaky dam, a few riparian trees, a pond and a design
 * storm. The video pass captures it as a Chrome screencast; the stills pass
 * replays the same script and takes a screenshot at each named moment.
 *
 * The session starts from a save with dams and ponds already built across the
 * far side of the catchment. One dam and one pond barely move the peak at the
 * outlet — which is true, and the game says so — so a trailer built only on
 * what the player adds on camera would end on "nothing built upstream to slow
 * it". Features are added until the worker's own storm model shows a real cut,
 * so the closing number is one the game computed, for a catchment partway
 * through being repaired.
 *
 * Nothing here is a hard-coded coordinate. The script asks the game's own
 * placement rules (`src/game/validity.ts`, run against a second copy of the
 * simulation worker inside the page) where a dam, a pond and trees would be
 * accepted, then walks the player there. When terrain generation changes and
 * every seed's valleys move, the trailer follows them rather than walking the
 * player into a hillside and pressing F at grass. That is also why it runs on
 * the Vite dev server rather than `vite preview`: the dev server can serve
 * those source modules to the page by URL.
 *
 * The player and camera are read back through three's devtools hook, which
 * reports every Scene and WebGLRenderer as it is constructed. It is read-only
 * and needs no hooks in the game code.
 *
 * Headless Chrome on a Mac renders WebGL on the real GPU through ANGLE's Metal
 * backend, and the screencast delivers a steady 60 fps. On a machine without a
 * GPU it falls back to SwiftShader, and the video will stutter.
 *
 * Needs `ffmpeg` on the PATH for encoding.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const root = fileURLToPath(new URL("..", import.meta.url));
// Picked for its opening view: the village between two streams, with grassland
// and a ploughed field in the same frame. Most seeds open on the valley floor
// by the outlet, which since the erosion fix is mostly arable.
const seed = Number(flag("seed", "132"));
const out = resolve(root, flag("out", "public/media"));
const only = flag("only", "");
const keepFrames = args.includes("--keep-frames");
const port = 5178;

/** CSS viewport, and the device scale that takes it to 1920 × 1080 pixels. */
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = 1.5;

/** Radians of camera orbit per pixel of drag. Mirrors LOOK_SENSITIVITY in input.ts. */
const LOOK_PER_PIXEL = 0.0042;
/** Log-distance per wheel pixel. Mirrors WHEEL_ZOOM_PER_PIXEL in input.ts. */
const ZOOM_PER_PIXEL = 0.0015;
/** How far ahead of the player the build target sits. Mirrors REACH_M in targeting.ts. */
const REACH = 3.2;
/**
 * A key tap long enough to turn the player most of the way to a new facing,
 * and how far it carries them. The controller only turns while there is input,
 * so the tap cannot be shorter; the drift is WALK_SPEED integrated over the
 * tap's acceleration from standing.
 */
const TAP_MS = 140;
const TAP_DRIFT = 0.6;

/** The design storm the R key runs. Mirrors TEST_STORM_RETURN_PERIOD_DAYS in main.ts. */
const STORM_RETURN_PERIOD_DAYS = 30;
/** Peak cut the pre-built features should reach before the take starts. */
const TARGET_PEAK_CUT = 0.08;

const framesDir = join(root, "tools/out/record-frames");
mkdirSync(out, { recursive: true });

const server = await createServer({
  root,
  logLevel: "warn",
  // Its own dependency cache, so a recording never races a `npm run dev`
  // that is optimising the same packages.
  cacheDir: "node_modules/.vite-record",
  // No hot reload: an edit saved mid-take would otherwise reload the page and
  // leave the script driving a loading screen.
  server: { port, strictPort: true, hmr: false, watch: null },
});
await server.listen();
const basePath = server.config.base;
const base = `http://localhost:${port}${basePath}`;

const browser = await chromium.launch({
  channel: "chrome",
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    `--force-device-scale-factor=${SCALE}`,
    "--enable-unsafe-swiftshader",
  ],
});

try {
  const plan = await planSession();
  if (only !== "stills") await take("video", plan);
  if (only !== "video") await take("stills", plan);
} finally {
  await browser.close();
  await server.close();
}

/**
 * A share code for this seed with the given features already built, enough
 * wood and stone for the whole script, and the spade already found.
 *
 * Built in the page by the game's own `serialise`, so it tracks the save
 * format. A restored save also skips the tutorial, whose prompts would sit
 * over the top of every shot.
 */
async function saveCode(interventions) {
  const page = await browser.newPage();
  await page.goto(base);
  const code = await page.evaluate(
    async ({ seed, basePath, interventions }) => {
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
        interventions: interventions.map((feature, i) => ({ ...feature, id: i + 1, at: 0 })),
      });
    },
    { seed, basePath, interventions },
  );
  await page.close();
  return code;
}

/** Boot the game from a share code, with the probe installed and the player found. */
async function openGame(code) {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await fitWindow(page, cdp);

  page.on("pageerror", (error) => console.error(`  page exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`  page error: ${message.text()}`);
  });
  await page.addInitScript(installProbe);

  await page.goto(`${base}play/?seed=${seed}#s=${code}`, { waitUntil: "load" });
  await page.waitForSelector("#boot-status", { state: "hidden", timeout: 90_000 });
  await page.evaluate(() => window.__rec.ready());

  // The pointer starts at the top-left, over the HUD, which would swallow
  // wheel events meant for the canvas.
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  const director = createDirector(page);
  await director.findPlayer();
  return { context, page, cdp, director };
}

/**
 * Choose where everything goes, once, so the video and the stills show the
 * same catchment with the same features in the same places.
 */
async function planSession() {
  console.log(`planning: seed ${seed}`);
  const { context, director } = await openGame(await saveCode([]));
  const plan = await director.plan(null);
  await context.close();
  plan.code = await saveCode(plan.preplaced);
  console.log(`  sites: ${JSON.stringify(plan.sites)}`);
  console.log(
    `  ${plan.preplaced.length} features pre-built; design-storm peak cut ${(plan.cut * 100).toFixed(1)}%`,
  );
  if (plan.cut < TARGET_PEAK_CUT) console.warn(`  short of the ${TARGET_PEAK_CUT * 100}% target`);
  return plan;
}

/** One pass through the script, as a screencast or as screenshots. */
async function take(mode, plan) {
  console.log(`${mode}: seed ${seed}`);
  const { context, page, cdp, director } = await openGame(plan.code);
  await director.plan(plan);
  // Let the "Restored" toast from the share code clear before anything is shot.
  await page.waitForTimeout(2800);

  const capture = mode === "video" ? await startScreencast(cdp) : null;
  const shots = [];
  const moment = async (name) => {
    if (capture) {
      capture.mark(name);
      return;
    }
    const path = join(framesDir, `${name}.png`);
    mkdirSync(framesDir, { recursive: true });
    await page.screenshot({ path });
    shots.push({ name, path });
  };

  await perform(director, page, moment, plan.sites);

  if (capture) {
    await capture.stop();
    encodeVideo(capture);
  } else {
    encodeStills(shots);
  }
  await context.close();
}

/**
 * The script itself.
 *
 * `moment(name)` marks a cut point in the video and a screenshot in the stills
 * pass; `encodeVideo` assembles the trailer from the marked ranges.
 */
async function perform(director, page, moment, sites) {
  const { orbit, zoomTo, pitchBy, walkTo, leave, turnToBuild, build, hud, press, toast } = director;
  const { dam, pond, grove } = sites;

  // Establishing shot, with the interface hidden: pull back over the valley and
  // turn slowly across it.
  await hud(false);
  await zoomTo(150, 0);
  await pitchBy(-0.1, 0);
  await orbit(-0.35, 0);
  await page.waitForTimeout(1500);
  await moment("heroStart");
  await Promise.all([orbit(0.7, 9000), zoomTo(115, 9000)]);
  await moment("hero");
  await moment("heroEnd");

  // The risk map, from far enough out to read the pattern, then the next layer.
  // Off again before going in close, where it is a screenful of flat colour.
  await hud(true);
  await zoomTo(85, 900);
  await moment("playStart");
  await page.waitForTimeout(400);
  await press("m");
  await page.waitForTimeout(2600);
  await moment("risk");
  await press("m");
  await page.waitForTimeout(1800);
  await press("n");

  // Down to the tributary, and a leaky dam across it. Far enough out on the
  // way to see the ground being crossed; in close for the build.
  await press("2");
  await Promise.all([zoomTo(45, 2000), walkTo(dam.x, dam.z, { stop: REACH, sprint: true })]);
  const [, damReady] = await Promise.all([zoomTo(30, 1200), turnToBuild("dam", dam)]);
  if (!damReady) throw new Error(`could not reach the dam site; try another --seed`);
  await page.waitForTimeout(500);
  // The still is taken before the build, while the ghost is green and the
  // readout says how much land drains through: afterwards the player faces the
  // dam itself, and the ghost turns red with "Something is already here".
  await moment("dam");
  await build();
  await page.waitForTimeout(1800);

  // A short riparian buffer on the brightest ground beside it.
  await press("1");
  await walkTo(grove.x, grove.z, { stop: 0.6 });
  for (let i = 0; i < 3; i++) {
    if (!(await turnToBuild("tree"))) break;
    await page.waitForTimeout(350);
    await build();
    await page.waitForTimeout(650);
  }
  // Face fresh ground for the still, for the same reason as the dam's.
  await turnToBuild("tree");
  await page.waitForTimeout(300);
  await moment("trees");
  await page.waitForTimeout(500);

  // An offline pond in a hollow the water already runs to, then out of it, so
  // the player is not standing in the middle of the shot.
  await press("3");
  const toPond = await director.distanceTo(pond.x, pond.z);
  await walkTo(pond.x, pond.z, { stop: REACH, sprint: toPond > 25 });
  if (!(await turnToBuild("pond", pond))) throw new Error(`could not reach the pond site; try another --seed`);
  await page.waitForTimeout(600);
  await build();
  await page.waitForTimeout(900);
  // Back to the planting tool first: the pond's ghost is a ring as wide as the
  // pond, and it would sit over every frame of the storm, red.
  await press("1");
  await leave(pond.x, pond.z, pond.radius + 1.5);
  await page.waitForTimeout(800);
  await moment("pond");

  // Camera back, and the design storm. Its end is the game's own toast rather
  // than a guess at how long the worker takes to route it.
  await zoomTo(60, 1500);
  await page.waitForTimeout(300);
  await press("r");
  await moment("stormStart");
  // A slow drift out and round while the water rises, so the storm is not
  // twenty seconds of a held frame.
  const drift = Promise.all([orbit(0.45, 16_000), zoomTo(85, 16_000)]);
  await page.waitForTimeout(9000);
  await moment("storm");
  await toast("Storm passed", 40_000);
  await moment("stormEnd");
  await drift;
  await page.waitForTimeout(1600);
  await moment("result");
  await page.waitForTimeout(600);

  // Pull back over the catchment to close.
  await Promise.all([zoomTo(150, 3500), orbit(0.35, 3500)]);
  await page.waitForTimeout(400);
  await moment("end");

  // The overview map, for the stills; it falls after the trailer's last frame.
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1500);
  await moment("map");
}

/**
 * Size the window so the page itself is exactly WIDTH × HEIGHT.
 *
 * Headless Chrome keeps some browser chrome inside `--window-size`, and the
 * screencast captures the real window rather than an emulated viewport, so the
 * window has to be grown by the difference.
 */
async function fitWindow(page, cdp) {
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  const [innerWidth, innerHeight] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { width: WIDTH * 2 - innerWidth, height: HEIGHT * 2 - innerHeight },
  });
  const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  if (size[0] !== WIDTH || size[1] !== HEIGHT) {
    throw new Error(`window is ${size.join(" × ")}, wanted ${WIDTH} × ${HEIGHT}`);
  }
}

/**
 * Runs in the page before any game code. Keeps a reference to every Scene and
 * renderer three constructs, and to whichever camera was last rendered with.
 */
function installProbe() {
  const hook = new EventTarget();
  const scenes = [];
  let camera = null;
  let player = null;
  window.__THREE_DEVTOOLS__ = hook;
  hook.addEventListener("observe", (event) => {
    const object = event.detail;
    if (object.isScene) scenes.push(object);
    if (object.isWebGLRenderer) {
      const render = object.render.bind(object);
      object.render = (scene, cam) => {
        camera = cam;
        return render(scene, cam);
      };
    }
  });

  const groups = () => {
    const found = [];
    for (const scene of scenes) scene.traverse((o) => o.isGroup && found.push(o));
    return found;
  };

  window.__rec = {
    ready() {
      if (!camera || scenes.length === 0) throw new Error("three devtools hook saw no scene");
    },
    snapshot() {
      window.__rec.before = groups().map((g) => [g, g.position.x, g.position.z]);
    },
    /** The group that moved the way the player was just told to walk. */
    identify(dirX, dirZ) {
      let best = null;
      let bestScore = -Infinity;
      for (const [group, x, z] of window.__rec.before) {
        const dx = group.position.x - x;
        const dz = group.position.z - z;
        const moved = Math.hypot(dx, dz);
        if (moved < 0.5 || moved > 12) continue;
        const score = (dx * dirX + dz * dirZ) / moved;
        if (score > bestScore) {
          bestScore = score;
          best = group;
        }
      }
      if (!best || bestScore < 0.9) return false;
      player = best;
      return true;
    },
    state() {
      const p = camera.position;
      const s = { camX: p.x, camY: p.y, camZ: p.z };
      if (player) {
        s.x = player.position.x;
        s.y = player.position.y;
        s.z = player.position.z;
        s.yaw = player.rotation.y;
        s.camYaw = Math.atan2(s.x - p.x, s.z - p.z);
        s.distance = Math.hypot(s.x - p.x, s.y + 1.1 - p.y, s.z - p.z);
      } else {
        const d = camera.getWorldDirection(new camera.position.constructor());
        s.camYaw = Math.atan2(d.x, d.z);
      }
      return s;
    },
  };
}

/** The camera, movement and building moves the script is written in. */
function createDirector(page) {
  const state = () => page.evaluate(() => window.__rec.state());
  const tick = () => page.waitForTimeout(16);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /**
   * Call `step(progress)` with an eased 0..1 until `ms` of wall clock has
   * passed. Timed by the clock rather than by counting steps, because each
   * step is a round trip to the browser and their cost varies.
   */
  const ease = async (ms, step) => {
    if (ms <= 0) return step(1);
    const started = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - started) / ms);
      await step(0.5 - 0.5 * Math.cos(Math.PI * t));
      if (t >= 1) return;
      await tick();
    }
  };
  // A drag in progress, so steering can keep nudging the camera while walking.
  let dragX = null;
  const dragBy = async (pixels) => {
    if (dragX === null || dragX + pixels < 40 || dragX + pixels > WIDTH - 40) {
      if (dragX !== null) await page.mouse.up();
      dragX = pixels > 0 ? 80 : WIDTH - 80;
      await page.mouse.move(dragX, HEIGHT * 0.55);
      await page.mouse.down();
    }
    dragX += pixels;
    await page.mouse.move(dragX, HEIGHT * 0.55);
  };
  const release = async () => {
    if (dragX === null) return;
    await page.mouse.up();
    dragX = null;
  };

  /** Turn the camera by `radians` over `ms`, eased at both ends. */
  const orbit = async (radians, ms) => {
    const pixels = -radians / LOOK_PER_PIXEL;
    let done = 0;
    await ease(ms, async (progress) => {
      // Whole pixels only: a fractional drag is rounded by the browser, and
      // the rounding would otherwise accumulate into a visibly short turn.
      const step = Math.round(pixels * progress - done);
      if (step !== 0) await dragBy(step);
      done += step;
    });
    await release();
  };

  /** Pitch up (positive) or down by `radians`. */
  const pitchBy = async (radians, ms) => {
    const pixels = Math.round(-radians / LOOK_PER_PIXEL);
    const top = Math.round(HEIGHT / 2 - pixels / 2);
    await page.mouse.move(WIDTH / 2, top);
    await page.mouse.down();
    await ease(ms, (progress) => page.mouse.move(WIDTH / 2, top + Math.round(pixels * progress)));
    await page.mouse.up();
  };

  /** Ease the camera to `metres` from the player over `ms`, by wheel. */
  const zoomTo = async (metres, ms) => {
    const { distance } = await state();
    const wheel = Math.log(metres / distance) / ZOOM_PER_PIXEL;
    let done = 0;
    // No pointer move here: this often runs alongside a drag, and a jump in
    // pointer position mid-drag is a jump in camera yaw.
    await ease(ms, async (progress) => {
      const step = wheel * progress - done;
      if (Math.abs(step) > 0.01) await page.mouse.wheel(0, step);
      done += step;
    });
    if (ms <= 0) await page.waitForTimeout(900);
  };

  /**
   * Walk to within `stop` metres of a point, steering the camera so the target
   * stays dead ahead — which is also how a player walks, and reads as one.
   */
  const walkTo = async (x, z, { stop = REACH, sprint = false } = {}) => {
    let s = await state();
    await orbit(wrap(Math.atan2(x - s.x, z - s.z) - s.camYaw), 700);
    if (sprint) await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    const started = Date.now();
    let best = Infinity;
    let bestAt = started;
    let sidesteps = 0;
    try {
      for (;;) {
        s = await state();
        const remaining = Math.hypot(x - s.x, z - s.z);
        if (remaining <= stop + (sprint ? 0.4 : 0.15)) break;
        // Slow to a walk for the last few metres, so the stop is not abrupt.
        if (sprint && remaining < 7) {
          await page.keyboard.up("Shift");
          sprint = false;
        }
        if (remaining < best - 0.05) {
          best = remaining;
          bestAt = Date.now();
        } else if (Date.now() - bestAt > 700) {
          // Pressed against something: a trunk, a wall. Slide along it one
          // way, then the other, before giving up.
          if (sidesteps >= 4) {
            console.warn(`  stuck ${remaining.toFixed(1)} m short of (${x.toFixed(0)}, ${z.toFixed(0)})`);
            break;
          }
          const side = sidesteps % 2 === 0 ? "d" : "a";
          await page.keyboard.down(side);
          await page.waitForTimeout(450 * (1 + sidesteps));
          await page.keyboard.up(side);
          sidesteps++;
          bestAt = Date.now();
        }
        if (Date.now() - started > 20_000) throw new Error("walk timed out");
        const error = wrap(Math.atan2(x - s.x, z - s.z) - s.camYaw);
        const turn = Math.max(-0.035, Math.min(0.035, error * 0.25));
        if (Math.abs(turn) > 0.002) await dragBy(-turn / LOOK_PER_PIXEL);
        await tick();
      }
    } finally {
      await page.keyboard.up("w");
      await page.keyboard.up("Shift");
      await release();
    }
    await page.waitForTimeout(120);
    const end = await state();
    return Math.hypot(x - end.x, z - end.z) <= stop + 1.5;
  };

  /**
   * Walk straight away from a point until `radius` metres clear of it, on
   * whichever of the eight key directions points most nearly away. The camera
   * stays put: swinging it round to walk out of a pond would be a bigger move
   * than the step itself.
   */
  const leave = async (x, z, radius) => {
    const s = await state();
    const away = Math.atan2(s.x - x, s.z - z);
    const sin = Math.sin(s.camYaw);
    const cos = Math.cos(s.camYaw);
    let pick = FACINGS[0];
    let best = -Infinity;
    for (const facing of FACINGS) {
      const m = Math.hypot(facing.inputX, facing.inputZ);
      const dx = -(facing.inputX * cos + facing.inputZ * sin) / m;
      const dz = (facing.inputX * sin - facing.inputZ * cos) / m;
      const along = dx * Math.sin(away) + dz * Math.cos(away);
      if (along > best) {
        best = along;
        pick = facing;
      }
    }
    for (const key of pick.keys) await page.keyboard.down(key);
    const started = Date.now();
    try {
      for (;;) {
        const now = await state();
        if (Math.hypot(now.x - x, now.z - z) >= radius || Date.now() - started > 3000) break;
        await tick();
      }
    } finally {
      for (const key of pick.keys) await page.keyboard.up(key);
    }
  };

  /** Keys, in camera space, for the eight directions a player can face. */
  const FACINGS = [
    ["w"], ["w", "d"], ["d"], ["s", "d"], ["s"], ["s", "a"], ["a"], ["w", "a"],
  ].map((keys) => {
    const inputX = (keys.includes("d") ? 1 : 0) - (keys.includes("a") ? 1 : 0);
    const inputZ = (keys.includes("s") ? 1 : 0) - (keys.includes("w") ? 1 : 0);
    return { keys, inputX, inputZ };
  });

  /**
   * Face a cell the game will accept for `kind`: the planned one if it is in
   * reach, else the best-scoring of the eight directions a tap can turn to.
   * Returns false when nothing in reach is buildable.
   */
  const turnToBuild = async (kind, preferred) => {
    const s = await state();
    const options = FACINGS.map((facing) => {
      // The controller's camera-to-world mapping (see controller.ts). The tap
      // that turns the player also carries them a little way that direction.
      const m = Math.hypot(facing.inputX, facing.inputZ);
      const sin = Math.sin(s.camYaw);
      const cos = Math.cos(s.camYaw);
      const dx = -(facing.inputX * cos + facing.inputZ * sin) / m;
      const dz = (facing.inputX * sin - facing.inputZ * cos) / m;
      return { ...facing, x: s.x + dx * (REACH + TAP_DRIFT), z: s.z + dz * (REACH + TAP_DRIFT) };
    });
    const scored = await page.evaluate(
      ({ kind, options }) => window.__plan.score(kind, options),
      { kind, options },
    );
    const ranked = options
      .map((option, i) => {
        if (scored[i] === null) return null;
        const away = preferred ? Math.hypot(option.x - preferred.x, option.z - preferred.z) : 0;
        return { ...option, score: scored[i] - away };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // The plan's arrays are a copy; the readout is the game's own verdict, so
    // a facing only counts once the readout agrees.
    for (const pick of ranked.slice(0, 4)) {
      for (const key of pick.keys) await page.keyboard.down(key);
      await page.waitForTimeout(TAP_MS);
      for (const key of pick.keys) await page.keyboard.up(key);
      await page.waitForTimeout(220);
      const ok = await page.evaluate(
        () => !document.getElementById("hud-readout").classList.contains("hud__readout--bad"),
      );
      if (ok) return true;
    }
    console.warn(`  ${kind}: nothing buildable in reach`);
    return false;
  };

  const build = async () => {
    const before = await page.evaluate(() => document.getElementById("hud-readout").textContent);
    await page.keyboard.press("f");
    await page.evaluate(() => window.__plan.occupyFacing());
    console.log(`  built: ${before}`);
  };

  const press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  };

  /** Wait for a toast whose text starts with `text`. */
  const toast = async (text, timeout) => {
    await page.waitForFunction(
      (text) => {
        const element = document.getElementById("toast");
        return element && !element.hidden && element.textContent.startsWith(text);
      },
      text,
      { timeout, polling: 100 },
    );
    console.log(`  toast: ${await page.evaluate(() => document.getElementById("toast").textContent)}`);
  };

  const hud = async (visible) => {
    await page.evaluate((visible) => {
      document.getElementById("ui-root").style.visibility = visible ? "" : "hidden";
    }, visible);
  };

  return {
    async distanceTo(x, z) {
      const s = await state();
      return Math.hypot(x - s.x, z - s.z);
    },
    orbit,
    pitchBy,
    zoomTo,
    walkTo,
    leave,
    turnToBuild,
    build,
    press,
    toast,
    hud,

    /** Walk a step and see which group followed: that is the player. */
    async findPlayer() {
      const s = await state();
      await page.evaluate(() => window.__rec.snapshot());
      await page.keyboard.down("s");
      await page.waitForTimeout(260);
      await page.keyboard.up("s");
      await page.waitForTimeout(80);
      const found = await page.evaluate(
        ([x, z]) => window.__rec.identify(x, z),
        [-Math.sin(s.camYaw), -Math.cos(s.camYaw)],
      );
      if (!found) throw new Error("could not find the player in the scene");
    },

    /**
     * Load the game's validity rules and a second copy of the generated world
     * into the page, for `turnToBuild` to consult.
     *
     * With no plan, also choose one: the dam, grove and pond near where the
     * player starts, and the features to pre-build elsewhere.
     */
    async plan(existing) {
      const start = await state();
      return page.evaluate(planInPage, {
        seed,
        basePath,
        reach: REACH,
        start: { x: start.x, z: start.z },
        existing: existing && { sites: existing.sites, preplaced: existing.preplaced },
        stormDays: STORM_RETURN_PERIOD_DAYS,
        targetCut: TARGET_PEAK_CUT,
      });
    },
  };
}

/**
 * Runs in the page. Everything a site is judged by comes from the game's own
 * modules, served by the dev server: the placement rules, the land cover
 * codes, and the storm model the peak cut is measured with.
 */
async function planInPage({ seed, basePath, reach, start, existing, stormDays, targetCut }) {
  const { createSimClient } = await import(`${basePath}src/worker/client.ts`);
  const config = await import(`${basePath}src/config.ts`);
  const validity = await import(`${basePath}src/game/validity.ts`);
  const gumbel = await import(`${basePath}src/sim/gumbel.ts`);
  const { LandCover } = await import(`${basePath}src/scimap/constants.ts`);
  const sim = createSimClient();
  const world = await sim.generate(seed, "sourceRisk", config.landscapeSpec(config.DEFAULT_LANDSCAPE_SIZE));
  const { spec, arrays } = world;
  const cellCount = spec.width * spec.height;
  const half = [(spec.width * spec.cellSize) / 2, (spec.height * spec.cellSize) / 2];
  const toCell = (x, z) => {
    const col = Math.floor((x + half[0]) / spec.cellSize);
    const row = Math.floor((z + half[1]) / spec.cellSize);
    return row < 0 || row >= spec.height || col < 0 || col >= spec.width ? -1 : row * spec.width + col;
  };
  const toWorld = (cell) => ({
    x: ((cell % spec.width) + 0.5) * spec.cellSize - half[0],
    z: (((cell / spec.width) | 0) + 0.5) * spec.cellSize - half[1],
  });
  // The overlay is the stretched source-risk layer; its brightness is a fair
  // stand-in for the value, and it is what the viewer sees.
  const risk = (cell) => {
    const o = cell * 4;
    return (0.3 * world.overlay[o] + 0.59 * world.overlay[o + 1] + 0.11 * world.overlay[o + 2]) / 255;
  };

  const built = [];
  // Rebuilt only when something is placed: the pre-build search checks every
  // cell in the grid, several times over.
  let cached = null;
  const context = () =>
    (cached ??= {
      arrays,
      spec,
      wood: 999,
      stone: 999,
      hasSpade: true,
      occupied: new Set(built.flatMap((b) => b.footprint)),
      interventions: built.map((b, i) => ({ kind: b.kind, id: i + 1, cell: b.cell, at: 0 })),
    });
  const check = (kind, cell) =>
    kind === "dam"
      ? validity.checkLeakyDam(context(), cell)
      : kind === "pond"
        ? validity.checkPond(context(), cell)
        : validity.checkTree(context(), cell);
  const place = (kind, cell) => {
    const { footprint } = check(kind, cell);
    built.push({ kind, cell, footprint: footprint.length ? footprint : [cell] });
    cached = null;
  };

  window.__plan = {
    /** A score per option, or null where the game would refuse it. */
    score(kind, options) {
      window.__plan.kind = kind;
      return options.map(({ x, z }) => {
        const cell = toCell(x, z);
        if (cell < 0) return null;
        const result = check(kind, cell);
        if (!result.ok) return null;
        if (kind === "tree" && !validity.plantingHelps(arrays, cell)) return null;
        return kind === "tree" ? risk(cell) * 10 : result.interceptedAreaM2 / 1e4;
      });
    },
    /** Record the feature just built, so later choices avoid it. */
    occupyFacing() {
      const s = window.__rec.state();
      place(window.__plan.kind ?? "tree", toCell(s.x + Math.sin(s.yaw) * reach, s.z + Math.cos(s.yaw) * reach));
    },
  };

  if (existing) {
    for (const { kind, cell } of existing.preplaced) place(kind, cell);
    sim.dispose();
    return existing;
  }

  const all = [];
  for (let cell = 0; cell < cellCount; cell++) {
    const p = toWorld(cell);
    all.push({ cell, d: Math.hypot(p.x - start.x, p.z - start.z), ...p });
  }
  const near = all.filter((p) => p.d < 140);

  // A dam a short sprint away, on a stream with bright ground beside it,
  // approached across open ground where possible. Woods can be walked through,
  // but a trailer that spends its middle bumping off tree trunks is not selling
  // anything; ground too steep to walk (MAX_WALK_SLOPE_DEG in controller.ts)
  // cannot be crossed at all.
  // The village's houses are solid, and it often sits right beside the start,
  // so a straight line through it is not an approach at all. Nor is one
  // through an outlying cottage.
  const village = toWorld(world.sites.villageCell);
  // The player can start at the village's edge, beside its houses, so the bar
  // is not a fixed radius: a path may not get closer to the centre, or to any
  // house, than the start already is.
  const villageClearance = Math.min(28, Math.hypot(start.x - village.x, start.z - village.z) - 3);
  const cottages = (world.sites.cottageCells ?? []).map((cell) => {
    const c = toWorld(cell);
    return { ...c, clearance: Math.min(10, Math.hypot(start.x - c.x, start.z - c.z) - 1) };
  });
  const blocked = {};
  const approach = (p) => {
    const steps = Math.ceil(p.d / 2);
    let wooded = 0;
    const refuse = (reason) => {
      blocked[reason] = (blocked[reason] ?? 0) + 1;
      return null;
    };
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = start.x + (p.x - start.x) * t;
      const z = start.z + (p.z - start.z) * t;
      if (Math.hypot(x - village.x, z - village.z) < villageClearance) return refuse("village");
      if (cottages.some((c) => Math.hypot(x - c.x, z - c.z) < c.clearance)) return refuse("cottage");
      const cell = toCell(x, z);
      if (cell < 0 || arrays.slopeDeg[cell] > 28) return refuse("steep");
      const cover = arrays.landCover[cell];
      if (cover === LandCover.Urban) return refuse("urban");
      if (cover === LandCover.Woodland) wooded++;
    }
    return wooded;
  };
  const plantableAround = (p, radius) => {
    let total = 0;
    for (const q of near) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > radius || d < 2) continue;
      if (check("tree", q.cell).ok && validity.plantingHelps(arrays, q.cell)) total += risk(q.cell);
    }
    return total;
  };
  const dams = near
    .filter((p) => p.d > 35 && p.d < 110 && check("dam", p.cell).ok && approach(p) !== null)
    .map((p) => ({ ...p, score: plantableAround(p, 14) - p.d * 0.05 - approach(p) * 0.6 }))
    .sort((a, b) => b.score - a.score);
  if (dams.length === 0) {
    const valid = near.filter((p) => check("dam", p.cell).ok);
    throw new Error(
      `no leaky dam site near the start (${start.x.toFixed(0)}, ${start.z.toFixed(0)}): ` +
        `${valid.length} valid within 140 m, ` +
        `${valid.filter((p) => p.d > 35 && p.d < 110).length} at 35–110 m, ` +
        `${valid.filter((p) => p.d > 35 && p.d < 110 && approach(p) !== null).length} with a walkable approach ` +
        `(blocked: ${JSON.stringify(blocked)})`,
    );
  }
  const dam = dams[0];

  // Somewhere to stand for planting: the point near the dam with the most
  // bright, plantable ground within reach of it.
  const stands = near
    .filter((p) => {
      const d = Math.hypot(p.x - dam.x, p.z - dam.z);
      return (
        d > 6 &&
        d < 22 &&
        !arrays.channelMask[p.cell] &&
        arrays.slopeDeg[p.cell] < 18 &&
        Math.hypot(p.x - village.x, p.z - village.z) > 28
      );
    })
    .map((p) => ({ ...p, score: plantableAround(p, reach + 1.5) }))
    .sort((a, b) => b.score - a.score);
  const grove = stands[0] ?? dam;

  // The rules only keep a pond's centre out of the channel. A footprint that
  // spills across the stream still reads on screen as an online pond, which is
  // the one thing the game is teaching the player not to build. So the search
  // asks for a margin of clear ground first, and relaxes only if it must.
  const clearOfChannel = (footprint, margin) =>
    footprint.every((cell) => {
      for (let dr = -margin; dr <= margin; dr++) {
        for (let dc = -margin; dc <= margin; dc++) {
          const n = cell + dr * spec.width + dc;
          if (n >= 0 && n < cellCount && arrays.channelMask[n]) return false;
        }
      }
      return true;
    });
  const pondsWithin = (maxDistance, margin) =>
    all
      .filter((p) => {
        const d = Math.hypot(p.x - grove.x, p.z - grove.z);
        if (d < 9 || d > maxDistance || Math.hypot(p.x - village.x, p.z - village.z) < 28) return false;
        const result = check("pond", p.cell);
        return result.ok && (margin < 0 || clearOfChannel(result.footprint, margin));
      })
      .map((p) => ({ ...p, score: arrays.accum[p.cell] - Math.hypot(p.x - grove.x, p.z - grove.z) * 20 }))
      .sort((a, b) => b.score - a.score);
  // Distance is the cheaper thing to give up: a longer walk is a sprint, but a
  // pond across the stream is the wrong lesson.
  let ponds = [];
  for (const [distance, margin] of [[50, 1], [90, 1], [140, 1], [140, 0], [140, -1]]) {
    ponds = pondsWithin(distance, margin);
    if (ponds.length > 0) break;
  }
  if (ponds.length === 0) throw new Error("no pond site near the dam");
  const pond = ponds[0];
  const { footprint: pondCells } = check("pond", pond.cell);
  pond.radius =
    Math.max(...pondCells.map((cell) => {
      const p = toWorld(cell);
      return Math.hypot(p.x - pond.x, p.z - pond.z);
    })) + spec.cellSize / 2;

  // Pre-built features, on the biggest flow paths well away from where the
  // camera works, added in batches until the storm model shows a real cut.
  // The player's own dam and pond count, since they will be there by the time
  // the storm runs.
  place("dam", dam.cell);
  place("pond", pond.cell);
  const depth = gumbel.depthForReturnPeriod(gumbel.fitGumbel(), stormDays);
  const measure = async () => {
    const playback = await sim.storm(
      depth,
      built.filter((b) => b.kind === "dam").map((b) => b.cell),
      built.filter((b) => b.kind === "pond").map((b) => b.cell),
    );
    return playback.baselinePeakQ > 0 ? 1 - playback.peakQ / playback.baselinePeakQ : 0;
  };
  const far = all.filter((p) => p.d > 170).sort((a, b) => arrays.accum[b.cell] - arrays.accum[a.cell]);
  let cut = await measure();
  for (let batch = 0; batch < 14 && cut < targetCut; batch++) {
    let addedDams = 0;
    let addedPonds = 0;
    for (const p of far) {
      if (addedDams < 4 && check("dam", p.cell).ok) {
        place("dam", p.cell);
        addedDams++;
      } else if (addedPonds < 3 && check("pond", p.cell).ok) {
        place("pond", p.cell);
        addedPonds++;
      }
      if (addedDams === 4 && addedPonds === 3) break;
    }
    if (addedDams + addedPonds === 0) break;
    cut = await measure();
  }
  sim.dispose();

  const preplaced = built.slice(2).map(({ kind, cell }) => ({ kind, cell }));
  const pick = ({ x, z, d }) => ({ x, z, d: Math.round(d) });
  return {
    sites: { dam: pick(dam), grove: pick(grove), pond: { ...pick(pond), radius: pond.radius } },
    preplaced,
    cut,
  };
}

/** Screencast frames written to disk as they arrive, with named cut points. */
async function startScreencast(cdp) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const marks = {};
  let stopped = false;
  // Frames already in flight keep arriving after stopScreencast; they are
  // dropped, not written into a directory the encoder may have removed.
  const onFrame = (frame) => {
    if (stopped) return;
    const file = join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    frames.push({ file, t: frame.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: WIDTH * SCALE,
    maxHeight: HEIGHT * SCALE,
    everyNthFrame: 1,
  });
  return {
    frames,
    marks,
    mark(name) {
      marks[name] = frames.length;
    },
    async stop() {
      stopped = true;
      cdp.off("Page.screencastFrame", onFrame);
      await cdp.send("Page.stopScreencast");
      const seconds = frames.at(-1).t - frames[0].t;
      console.log(`  ${frames.length} frames over ${seconds.toFixed(1)} s`);
      const at = (i) => (frames[Math.min(i, frames.length - 1)].t - frames[0].t).toFixed(1);
      console.log(`  marks: ${Object.entries(marks).map(([name, i]) => `${name} ${at(i)}`).join(", ")}`);
    },
  };
}

/**
 * Cut and encode.
 *
 * `trailer.mp4` is the whole take with the establishing orbit trimmed and the
 * storm's middle run at two and a half times speed; `hero.mp4` is the orbit alone, small
 * enough to autoplay behind the landing page's title. Frame timing comes from
 * the screencast's own timestamps through ffmpeg's concat demuxer, so a
 * dropped frame holds the previous one rather than shortening the video.
 */
function encodeVideo({ frames, marks }) {
  const range = (from, to, speed = 1) => ({ from: marks[from], to: marks[to], speed });
  /** Index of the first frame `seconds` after a mark. */
  const after = (name, seconds) => {
    const t = frames[marks[name]].t + seconds;
    const index = frames.findIndex((frame, i) => i >= marks[name] && frame.t >= t);
    return index < 0 ? frames.length - 1 : index;
  };
  const list = (segments) => {
    let text = "";
    let seconds = 0;
    for (const { from, to, speed } of segments) {
      for (let i = from; i < to; i++) {
        const next = frames[i + 1]?.t ?? frames[i].t + 1 / 60;
        const duration = Math.min(0.1, next - frames[i].t) / speed;
        text += `file '${frames[i].file}'\nduration ${duration.toFixed(5)}\n`;
        seconds += duration;
      }
    }
    // The concat demuxer ignores the last entry's duration unless the file is repeated.
    const last = segments.at(-1);
    text += `file '${frames[Math.min(last.to, frames.length) - 1].file}'\n`;
    return { text, seconds };
  };

  const encode = (name, segments, { width, crf, fade }) => {
    const { text, seconds } = list(segments);
    const listFile = join(framesDir, `${name}.txt`);
    writeFileSync(listFile, text);
    const fadeOut = Math.max(0, seconds - 0.8).toFixed(2);
    const fades = fade ? `,fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.8` : "";
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf", `fps=30,scale=${width}:-2:flags=lanczos${fades},format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
        "-profile:v", "high", "-movflags", "+faststart", "-an",
        join(out, `${name}.mp4`),
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
    console.log(`  wrote ${name}.mp4 (${seconds.toFixed(1)} s)`);
  };

  // The hero loops, so no fades: a dip to black on every pass reads as a glitch.
  encode("hero", [range("heroStart", "heroEnd")], { width: 1280, crf: 27, fade: false });
  encode(
    "trailer",
    [
      { from: marks.heroStart, to: after("heroStart", 5), speed: 1 },
      range("playStart", "stormStart"),
      { from: marks.stormStart, to: after("stormStart", 2.5), speed: 1 },
      { from: after("stormStart", 2.5), to: marks.stormEnd, speed: 2.5 },
      range("stormEnd", "end"),
    ],
    { width: 1920, crf: 24, fade: true },
  );

  // Posters: the first frame of each cut, so nothing jumps when playback starts.
  poster(frames[marks.heroStart].file, "hero-poster.jpg", 1280);
  poster(frames[marks.heroStart].file, "trailer-poster.jpg", 1920);

  if (!keepFrames) rmSync(framesDir, { recursive: true, force: true });
}

/** Full-size JPEGs for the gallery, plus half-size ones for the grid. */
function encodeStills(shots) {
  for (const { name, path } of shots) {
    if (!["hero", "risk", "dam", "trees", "pond", "storm", "result", "map"].includes(name)) continue;
    poster(path, `${name}.jpg`, 1920);
    poster(path, `${name}-960.jpg`, 960);
  }
  if (!keepFrames) rmSync(framesDir, { recursive: true, force: true });
}

function poster(source, name, width) {
  if (!existsSync(source)) throw new Error(`missing ${source}`);
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", `scale=${width}:-2:flags=lanczos`, "-q:v", "3", join(out, name)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
  console.log(`  wrote ${name}`);
}
