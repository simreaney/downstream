/**
 * Entry point: generate a catchment in the worker, put it on screen, and wire
 * the build loop.
 *
 * The worker handshake happens before anything else is built. A worker chunk
 * that 404s under a GitHub Pages subpath is the single most likely deploy
 * failure, and it is far cheaper to surface it here than to debug a game that
 * silently never finishes loading.
 */

import * as THREE from "three";
import { DEFAULT_LANDSCAPE_SIZE, LANDSCAPE_SIZES, landscapeSpec, type LandscapeSizeId } from "./config";
import { randomSeed } from "./core/rng";
import {
  SAVE_VERSION,
  clearStoredSave,
  readShareCode,
  readStoredCode,
  deserialise,
  saveToStorage,
  shareUrl,
  type SaveData,
} from "./game/save";
import { formatArea } from "./game/format";
import { formatNumber, onLocaleChange, resolveLocale, setLocale, t, tn, type ProgressStage } from "./i18n";
import { createBuildController } from "./game/buildController";
import { createInventory } from "./game/inventory";
import type { InterventionKind } from "./game/interventions";
import { createOverlayControl } from "./game/overlayControl";
import { createResources, STONE_PER_NODE, WOOD_PER_NODE } from "./game/resources";
import { createStormPlayer } from "./game/stormPlayer";
import { createStormSchedule } from "./game/stormSchedule";
import { depthForReturnPeriod, fitGumbel } from "./sim/gumbel";
import { floodVillage, initialReceptors, updateReceptors } from "./game/receptors";
import { computeScores, type Scores, type StormSummary } from "./game/scoring";
import type { Intervention } from "./game/interventions";
import { storageOf } from "./game/interventions";
import { plantingHelps } from "./game/validity";
import { createFollowCamera, DEFAULT_CAMERA_DISTANCE } from "./render/camera";
import { setCurvatureScale } from "./render/curvature";
import { createPlayer } from "./player/controller";
import { createInput, type GameAction } from "./player/input";
import { createPlacementGhost } from "./player/placementGhost";
import { facingTarget } from "./player/targeting";
import { createAudio } from "./audio/engine";
import { createHud, mirrorHud } from "./ui/hud";
import { keyLabel, loadKeyboardLayout } from "./ui/keys";
import { createLanguagePicker } from "./ui/languagePicker";
import { createTutorial } from "./ui/tutorial";
import { createHydrographChart } from "./ui/hydrographChart";
import { createScorePanel } from "./ui/scorePanel";
import { createOverlayLegend } from "./ui/overlayLegend";
import { createOverviewMap } from "./ui/overviewMap";
import { createRenderer } from "./render/renderer";
import { buildWorldScene } from "./render/scene";
import { cellToWorld, worldToCell } from "./render/terrainMesh";
import { createSimClient } from "./worker/client";
import { createXrHud } from "./xr/hud";
import { createXrMode } from "./xr/mode";

const BOOT_MARKUP = `
  <div class="boot-status" id="boot-status">
    <div id="boot-heading"></div>
    <div class="boot-status__bar"><div class="boot-status__fill" id="boot-fill"></div></div>
    <div id="boot-message"></div>
  </div>
`;

/** The design event the R key runs. Big enough to move water, common enough to matter. */
const TEST_STORM_RETURN_PERIOD_DAYS = 30;

/** Game days a storm's playback pushes the next scheduled one back by. */
const STORM_COOLDOWN_DAYS = 2;

/** Cycle order for the gamepad's shoulder buttons — LB/RB step through this. */
const TOOL_ORDER: readonly InterventionKind[] = ["tree", "dam", "pond"];

const ACTION_TOOL: Partial<Record<GameAction, InterventionKind>> = {
  toolTree: "tree",
  toolDam: "dam",
  toolPond: "pond",
};

/**
 * Keyboard keys that map directly onto a `GameAction`, shared with the gamepad.
 *
 * By `event.code` — the physical key — like movement in `player/input.ts`.
 * Matching `event.key` instead meant the two disagreed on any non-QWERTY
 * layout: on AZERTY the key in the W position walks forward by code and types
 * "z" by key, so every step forward also undid the last build. Shifted digits
 * also stopped selecting tools, because Shift+1 is "!" by key.
 */
const KEY_ACTIONS: Record<string, GameAction> = {
  Digit1: "toolTree",
  Numpad1: "toolTree",
  Digit2: "toolDam",
  Numpad2: "toolDam",
  Digit3: "toolPond",
  Numpad3: "toolPond",
  KeyM: "overlayNext",
  KeyN: "overlayOff",
  KeyE: "gather",
  KeyF: "build",
  Space: "build",
  KeyR: "storm",
  KeyK: "save",
  KeyZ: "undo",
};

/**
 * The features a storm's result depends on, as one comparable string.
 *
 * A storm's flood score measures the ponds and dams that existed when it was
 * run; once any of them is undone, that measurement no longer describes the
 * catchment, and holding on to it would leave the score crediting storage the
 * player has already been refunded for.
 */
function storageSignature(interventions: readonly Intervention[]): string {
  return interventions
    .filter((feature) => feature.kind !== "tree")
    .map((feature) => `${feature.kind}:${feature.cell}`)
    .join(",");
}

/** The page's own title and description, which a search result or a tab shows. */
function labelDocument(): void {
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement | null;
  const uiRoot = document.getElementById("ui-root");
  if (!canvas || !uiRoot) throw new Error("play/index.html is missing #viewport or #ui-root");

  // Asked for now and awaited only once the HUD needs key names, so it costs
  // the loading screen nothing.
  const keyboardLayout = loadKeyboardLayout();

  uiRoot.insertAdjacentHTML("beforeend", BOOT_MARKUP);
  (document.getElementById("boot-heading") as HTMLElement).textContent = t("boot.surveying");
  const fill = document.getElementById("boot-fill") as HTMLElement;
  const message = document.getElementById("boot-message") as HTMLElement;

  const setProgress = (progress: number, stage?: ProgressStage): void => {
    fill.style.width = `${Math.round(progress)}%`;
    if (stage) message.textContent = t(stage);
  };

  const renderer = createRenderer(canvas);
  setProgress(2, "stage.rendererReady");

  const sim = createSimClient();
  await sim.ping();

  // A share code in the URL wins over local storage, which wins over a fresh
  // seed. Resolved before generation, because the save owns the seed — and,
  // likewise, the save owns the landscape size: an intervention's cell index
  // only means the same place decoded against the grid width it was recorded
  // with, so a restored save regenerates at the size it was built on rather
  // than whatever the URL or default currently says.
  const { save: restored, problem: saveProblem } = await resolveSave();
  const seed = restored?.seed ?? readSeed();
  const sizeId = restored?.sizeId ?? readLandscapeSize();
  const spec = landscapeSpec(sizeId);
  const world = await sim.generate(seed, "sourceRisk", spec, setProgress);
  const scene = buildWorldScene(renderer.scene, world, world.spec);

  // Start upslope of the outlet, looking into the catchment — the view that
  // shows the trunk valley and where the work is.
  const outletPosition = cellToWorld(world.spec, world.outlet, new THREE.Vector3());
  outletPosition.y = world.arrays.dem[world.outlet];
  const start = outletPosition.clone().multiplyScalar(0.72);

  // On the drawn ground, river beds and all, so the player wades into a stream
  // rather than walking across the top of it.
  const player = createPlayer(scene.groundDem, world.spec, start, scene.obstacles);
  const input = createInput(canvas);
  const camera = createFollowCamera(
    renderer.camera,
    scene.groundDem,
    world.spec,
    Math.atan2(-start.x, -start.z),
  );

  await keyboardLayout;

  // The headset's HUD is kept current alongside the page's whether or not a
  // session is running, so putting the headset on shows the game as it stands.
  const xrHud = createXrHud();
  const hud = mirrorHud(createHud(uiRoot), xrHud);
  const hudPanel = uiRoot.querySelector(".hud") as HTMLElement;
  createLanguagePicker(hudPanel, { className: "hud__lang", releaseLetters: true });
  if (saveProblem) hud.toast(t("toast.saveProblem", { problem: saveProblem }));
  const legend = createOverlayLegend(uiRoot);
  const overviewMap = createOverviewMap(
    uiRoot,
    world.spec,
    world.arrays.dem,
    world.arrays.landCover,
    world.arrays.channelMask,
    world.outlet,
    { village: world.sites.villageCell, fishery: world.sites.fisheryCell },
  );

  const overlay = createOverlayControl({
    sim,
    setMix: (value) => {
      scene.terrainMaterial.setOverlayMix(value);
      overviewMap.setMix(value);
    },
    setOverlay: (rgba) => {
      scene.setOverlay(rgba);
      overviewMap.setOverlay(rgba);
    },
    onLayerChange: (layer) => {
      legend.show(layer);
      overviewMap.setLayer(layer);
      xrHud.setLayer(layer);
    },
  });
  overlay.adopt(world.overlay);

  // A modest starting stock: enough to plant a short buffer and learn what it
  // does, not enough to avoid ever gathering.
  const inventory = createInventory(
    restored
      ? { wood: restored.wood, stone: restored.stone, hasSpade: restored.hasSpade }
      : { wood: 12, stone: 6 },
  );
  inventory.subscribe((state) => hud.setInventory(state));

  const resources = createResources(
    world.arrays,
    world.spec,
    seed,
    worldToCell(world.spec, start.x, start.z),
  );

  // Give every node a marker, remembering the handle so collecting it removes
  // exactly that instance.
  const markerHandles = new Map<number, number>();
  for (const node of resources.nodes) {
    const batch = scene.pickups[node.kind];
    markerHandles.set(
      node.id,
      batch.add(node.position, ((node.id * 2.399) % (Math.PI * 2)), node.kind === "spade" ? 1 : 0.9),
    );
  }
  overviewMap.setResources(resources.nodes);

  const audio = createAudio();
  // A restored save means a returning player; the opening lesson would be noise.
  const tutorial = createTutorial(uiRoot, restored !== null);
  const scorePanel = createScorePanel(uiRoot);

  const xr = createXrMode({
    renderer,
    scene,
    hud: xrHud,
    tutorial,
    buttonHost: hudPanel,
    heading: () => camera.yaw,
    notify: (text) => hud.toast(text),
    onExit: () => camera.reset(),
  });

  // The score's denominator: the catchment as it was found. Frozen at
  // generation, for the same reason the stretch bounds are — recomputing it
  // later would quietly reset the player's progress to zero.
  const baseline = world.baseline;
  let latestMetrics = world.metrics;
  /** The last storm, with the storage it was run against; see `storageSignature`. */
  let lastStorm: (StormSummary & { readonly signature: string }) | null = null;
  let receptors = initialReceptors();

  /** Volume a design storm drops on the catchment, for the pre-storm proxy. */
  const designStormVolumeM3 =
    (32 / 1000) * world.spec.width * world.spec.height * world.spec.cellSize * world.spec.cellSize * 0.25;

  /**
   * Declared before the build controller it reads, and called only after it
   * exists.
   *
   * An earlier version hoisted this as a function declaration so it could sit
   * further down. That compiles and it fails at runtime: hoisting makes the
   * *function* available early but leaves its captured `const`s in the temporal
   * dead zone, so the first call threw "cannot access before initialization"
   * and the game hung on the loading screen. Declaration order is the fix.
   */
  let scores: Scores = computeScores(latestMetrics, baseline, null, 0, designStormVolumeM3);
  const refreshScores = (): void => {
    const storage = build.interventions.reduce(
      (total, feature) => total + storageOf(feature.kind),
      0,
    );
    const storm =
      lastStorm && lastStorm.signature === storageSignature(build.interventions) ? lastStorm : null;
    scores = computeScores(latestMetrics, baseline, storm, storage, designStormVolumeM3);
    scorePanel.set(scores);
    xrHud.setScores(scores);
  };

  const build = createBuildController({
    sim,
    scene,
    spec: world.spec,
    inventory,
    currentLayer: () => (overlay.layer === "none" ? "sourceRisk" : overlay.layer),
    onRecomputed: (rgba, metrics) => {
      overlay.adopt(rgba);
      latestMetrics = metrics as typeof world.metrics;
      refreshScores();
    },
  });

  // Seed the river's colour from the catchment as generated, so the water is
  // already telling the truth before the player touches anything. Generation
  // returns it directly, from the same solve a recompute would run.
  scene.river.setReachRisk(world.reachRisk);

  if (restored) {
    // Remove the nodes the saved game already collected before rebuilding, or
    // the player would find them lying there a second time.
    const taken = new Set(restored.collected);
    for (const node of resources.nodes) {
      if (!taken.has(node.id)) continue;
      resources.collect(node);
      const handle = markerHandles.get(node.id);
      if (handle !== undefined) {
        scene.pickups[node.kind].remove(handle);
        markerHandles.delete(node.id);
      }
      overviewMap.clearResource(node.id);
    }
    try {
      await build.replay(restored.interventions);
      hud.toast(tn("toast.restored", restored.interventions.length));
    } catch (error: unknown) {
      console.error(error);
      hud.toast(t("toast.restoreFailed"));
    }
  }
  refreshScores();

  const chart = createHydrographChart(uiRoot);
  const storm = createStormPlayer({
    scene,
    sky: scene.sky,
    chart,
    onFinished: (playback) => {
      lastStorm = {
        peakQ: playback.peakQ,
        baselinePeakQ: playback.baselinePeakQ,
        tPeakSeconds: playback.tPeakSeconds,
        baselineTPeakSeconds: playback.baselineTPeakSeconds,
        signature: stormSignature,
      };
      // A storm that outruns the catchment's capacity reaches the village. The
      // depth is a proxy from the peak *with* the player's features, so building
      // genuinely protects the houses rather than only the number.
      receptors = floodVillage(receptors, Math.max(0, playback.peakQ - 0.25) * 0.6);
      refreshScores();
      const cut = playback.baselinePeakQ > 0
        ? (1 - playback.peakQ / playback.baselinePeakQ) * 100
        : 0;
      // Built storage does not always lower an outlet peak — slowing one branch
      // can line it up with another — so "nothing built" is only said when
      // that is literally true.
      const builtStorage = stormSignature !== "";
      hud.toast(
        cut > 0.5
          ? t("toast.stormCut", { cut: formatNumber(cut) })
          : builtStorage
            ? t("toast.stormBarely")
            : t("toast.stormNothing"),
      );
    },
  });
  let stormBusy = false;
  /** Storage signature of the storm in flight, stamped on its result. */
  let stormSignature = "";
  const weather = createStormSchedule(seed);
  const gumbel = fitGumbel();

  /**
   * Send a storm to the worker and play it back.
   *
   * Shared by the R key and the weather clock, so a scheduled storm and a
   * requested one behave identically once a depth has been decided — the only
   * difference between them is where the number came from.
   */
  const runStorm = (depthMm: number, announcement: string): void => {
    if (stormBusy || storm.running) return;
    stormBusy = true;
    hud.toast(announcement);
    stormSignature = storageSignature(build.interventions);

    const damCells = build.interventions.filter((f) => f.kind === "dam").map((f) => f.cell);
    const pondCells = build.interventions.filter((f) => f.kind === "pond").map((f) => f.cell);

    void sim
      .storm(depthMm, damCells, pondCells)
      .then((playback) => storm.start(playback))
      .catch((error: unknown) => {
        console.error(error);
        hud.toast(t("toast.stormFailed"));
      })
      .finally(() => {
        stormBusy = false;
      });
  };

  const ghost = createPlacementGhost(scene.curvature);
  renderer.scene.add(ghost.root);

  let tool: InterventionKind = "tree";
  hud.setTool(tool);

  const target = { cell: -1, x: 0, z: 0 };
  let busy = false;

  /**
   * A discrete intent — a key press or a gamepad button just pressed this
   * frame — resolved into a game action. Keyboard and gamepad both funnel
   * through this so the two devices stay in lockstep with no duplicated
   * behaviour to drift apart.
   */
  const handleAction = (action: GameAction): void => {
    const selected = ACTION_TOOL[action];
    if (selected) {
      tool = selected;
      hud.setTool(tool);
      return;
    }

    if (action === "toolCycleNext" || action === "toolCyclePrev") {
      const step = action === "toolCycleNext" ? 1 : -1;
      const index = (TOOL_ORDER.indexOf(tool) + step + TOOL_ORDER.length) % TOOL_ORDER.length;
      tool = TOOL_ORDER[index];
      hud.setTool(tool);
      return;
    }

    if (action === "overlayNext") {
      tutorial.complete("openMap");
      overlay.next();
      return;
    }
    if (action === "overlayOff") {
      overlay.off();
      return;
    }
    if (action === "mapToggle") {
      overviewMap.toggle();
      return;
    }
    if (action === "zoomCycle") {
      if (xr.presenting) xr.diorama.cycleZoom();
      else camera.cycleZoom();
      return;
    }

    if (action === "gather") {
      const node = resources.nearest(player.position.x, player.position.z);
      if (!node) return;
      resources.collect(node);
      const handle = markerHandles.get(node.id);
      if (handle !== undefined) {
        scene.pickups[node.kind].remove(handle);
        markerHandles.delete(node.id);
      }
      overviewMap.clearResource(node.id);
      audio.play("gather");
      xr.pulse(0.3, 30);
      tutorial.complete("gather");
      if (node.kind === "wood") {
        inventory.gain(WOOD_PER_NODE, 0);
        hud.toast(t("toast.gainWood", { count: WOOD_PER_NODE }));
      } else if (node.kind === "stone") {
        inventory.gain(0, STONE_PER_NODE);
        hud.toast(t("toast.gainStone", { count: STONE_PER_NODE }));
      } else {
        inventory.giveSpade();
        hud.toast(t("toast.foundSpade"));
      }
      return;
    }

    if (action === "build") {
      // One placement in flight at a time. Holding the button would otherwise
      // queue recomputes whose intermediate results the player never sees.
      if (busy) return;
      busy = true;
      const kind = tool;
      void build
        .place(kind, target.cell, performance.now() / 1000)
        .then((result) => {
          hud.toast(result.message);
          if (!result.placed) {
            audio.play("refuse");
            xr.pulse(0.15, 25);
            return;
          }
          audio.play(kind === "tree" ? "plant" : kind === "pond" ? "dig" : "build");
          xr.pulse(0.5, 50);
          if (kind === "tree") tutorial.complete("plant");
        })
        .catch((error: unknown) => {
          console.error(error);
          hud.toast(t("toast.buildFailed"));
        })
        .finally(() => {
          busy = false;
        });
      return;
    }

    if (action === "storm") {
      // Checked before deferring the weather: a press while a storm is already
      // on its way must not quietly push the next scheduled one back.
      if (stormBusy || storm.running) {
        hud.toast(t("toast.stormBusy"));
        return;
      }
      tutorial.complete("storm");
      weather.defer(STORM_COOLDOWN_DAYS);
      runStorm(
        depthForReturnPeriod(gumbel, TEST_STORM_RETURN_PERIOD_DAYS),
        t("toast.stormComing", { days: TEST_STORM_RETURN_PERIOD_DAYS }),
      );
      return;
    }

    if (action === "save") {
      const data: SaveData = {
        version: SAVE_VERSION,
        seed,
        sizeId,
        elapsedSeconds: performance.now() / 1000,
        wood: inventory.wood,
        stone: inventory.stone,
        hasSpade: inventory.hasSpade,
        collected: resources.nodes.filter((node) => node.collected).map((node) => node.id),
        interventions: [...build.interventions],
      };

      void saveToStorage(data)
        .then(async (code) => {
          const url = shareUrl(code);
          window.history.replaceState(null, "", url);
          // Best effort: clipboard access needs a permission some browsers only
          // grant on a user gesture, and a failed copy must not lose the save.
          try {
            await navigator.clipboard.writeText(url);
            hud.toast(t("toast.saved"));
          } catch {
            hud.toast(t("toast.savedAddressBar"));
          }
        })
        .catch(() => hud.toast(t("toast.saveFailed")));
      return;
    }

    if (action === "undo") {
      if (busy) return;
      busy = true;
      void build
        .undo()
        .then((result) => hud.toast(result.message))
        .catch((error: unknown) => {
          console.error(error);
          hud.toast(t("toast.undoFailed"));
        })
        .finally(() => {
          busy = false;
        });
    }
  };

  // The player's chest, which is what the camera's see-through window aims at.
  const sightTarget = new THREE.Vector3();

  renderer.onFrame((dt, elapsed) => {
    // In a headset, intent comes from the controllers and "forward" is where
    // the player is looking; on the page, from the keyboard, mouse or gamepad
    // and the follow camera. Everything after this is the same game.
    const immersive = xr.presenting;
    if (immersive) xr.poll(dt);
    else input.poll(dt);
    const intent = immersive ? xr.state : input.state;
    scene.water.update(elapsed);
    storm.update(dt);
    player.update(intent, immersive ? xr.heading : camera.yaw, dt);
    sightTarget.copy(player.position);
    sightTarget.y += 1.2;
    if (immersive) {
      xr.update(player.position, dt);
      // A tabletop is flat; see `xr/diorama.ts` for why the bend would all
      // but vanish at this scale anyway.
      setCurvatureScale(scene.curvature, 0);
      scene.lighting.setShadowReach(xr.diorama.viewDistance);
      scene.props.fade.set(xr.eye, sightTarget);
    } else {
      camera.update(player.position, intent.lookX, intent.lookY, dt, intent.zoom);
      // Flatter world and wider shadows as the camera pulls back; exactly the
      // default look at the default distance and closer.
      setCurvatureScale(scene.curvature, Math.min(1, (DEFAULT_CAMERA_DISTANCE / camera.distance) ** 2));
      scene.lighting.setShadowReach(camera.distance);
      scene.props.fade.set(renderer.camera.position, sightTarget);
    }
    input.endFrame();
    const actions = intent.actions;
    if (actions) for (const action of actions) handleAction(action);
    overlay.update(dt);
    if (overviewMap.visible) overviewMap.setPlayer(player.position.x, player.position.z, player.yaw);

    scene.character.root.position.copy(player.position);
    scene.character.root.rotation.y = player.yaw;
    scene.character.animate(elapsed, player.speed);
    if (player.speed > 3) tutorial.complete("walk");
    scene.lighting.follow(player.position);

    // Receptors lag the score deliberately: fish returning over a game day reads
    // as recovery, where an instant response reads as a slider being dragged.
    // The scores only change when the model or a storm does, so the ones
    // `refreshScores` last computed are the current ones.
    receptors = updateReceptors(receptors, scores, dt);
    // Cloudier of the two: a storm stirs a clean river up, but never makes a
    // silted one look clearer than it is.
    scene.water.setTurbidity(Math.max(storm.storminess * 0.6, 1 - receptors.fisheryClarity));
    audio.setRain(storm.storminess);

    // Weather runs on its own clock. It is paused while a storm plays out, so a
    // long playback cannot stack the next one on top of it.
    if (!storm.running && !stormBusy) {
      const due = weather.tick(dt);
      if (due) runStorm(due.depthMm, t("toast.rain", { depth: formatNumber(due.depthMm) }));
    }
    scene.fish.setVisibleCount(receptors.fishCount);

    facingTarget(world.spec, player.position.x, player.position.z, player.yaw, target);

    // Gathering takes priority in the readout: if the player is standing next to
    // something they can pick up, that is what E will do.
    const node = resources.nearest(player.position.x, player.position.z);
    if (node) {
      ghost.hide();
      const key = immersive ? "B" : keyLabel("KeyE");
      hud.setReadout(
        t(node.kind === "wood" ? "readout.takeWood" : node.kind === "stone" ? "readout.takeStone" : "readout.takeSpade", {
          key,
        }),
        true,
        false,
      );
      return;
    }

    const check = build.preview(tool, target.cell);
    const helpful = tool !== "tree" || plantingHelps(world.arrays, target.cell);
    ghost.show(world.spec, scene.renderDem, target.x, target.z, tool === "pond" ? 5 : 1.4, check, helpful);

    hud.setReadout(
      check.ok
        ? t(helpful ? "readout.drains" : "readout.drainsRaisesErosion", {
            area: formatArea(check.interceptedAreaM2),
          })
        : check.message,
      check.ok,
      check.ok && !helpful,
    );
  });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey) return;
    // Before the repeat check, so a held Tab cannot walk focus through the page.
    if (event.code === "Tab") event.preventDefault();
    if (event.repeat) return;

    // Not GameActions: Tab and Escape address the overview map's open/closed
    // state directly rather than toggling it, which a gamepad button doesn't need.
    if (event.code === "Tab") {
      overviewMap.toggle();
      return;
    }
    if (event.code === "Escape") {
      if (overviewMap.visible) overviewMap.hide();
      return;
    }

    const action = KEY_ACTIONS[event.code];
    if (action) handleAction(action);
  });

  setProgress(100, "stage.ready");
  document.getElementById("boot-status")?.setAttribute("hidden", "");

  console.info(
    `catchment ${seed}: outlet ${world.outlet}, ${world.reaches.length} reaches, ` +
      `mean source risk ${world.metrics.meanSourceRisk.toFixed(4)}, ` +
      `${resources.nodes.length} resource nodes, ` +
      `${scene.obstacles.length} solid obstacles`,
  );

  renderer.start();
}

/**
 * The save to restore, if any, and why a save that was there could not be.
 *
 * A share code in the URL wins; then an explicit `?seed=`, which asks for a
 * particular catchment and must not be overridden by whatever was last saved
 * locally; then the local save. A code that fails to load is reported rather
 * than silently dropped — and a local one is cleared, or it would fail the
 * same way on every visit.
 */
async function resolveSave(): Promise<{ save: SaveData | null; problem: string | null }> {
  let problem: string | null = null;
  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : t("save.unreadable");

  const shared = readShareCode();
  if (shared) {
    try {
      return { save: await deserialise(shared), problem: null };
    } catch (error: unknown) {
      console.warn("Ignoring an unreadable share code", error);
      problem = describe(error);
    }
  }

  if (new URLSearchParams(window.location.search).has("seed")) return { save: null, problem };

  const stored = readStoredCode();
  if (stored) {
    try {
      return { save: await deserialise(stored), problem };
    } catch (error: unknown) {
      console.warn("Clearing an unreadable local save", error);
      clearStoredSave();
      problem ??= describe(error);
    }
  }
  return { save: null, problem };
}

/**
 * Seed from the URL, or a fresh one.
 *
 * `?seed=` makes a catchment shareable and a bug reproducible — the same seed
 * always rebuilds the same world.
 */
function readSeed(): number {
  const fromUrl = new URLSearchParams(window.location.search).get("seed");
  if (fromUrl !== null) {
    const parsed = Number.parseInt(fromUrl, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  return randomSeed();
}

/**
 * Landscape size from the URL, or the shipped default.
 *
 * `?size=small|medium|large` picks how big a catchment to generate — see
 * `LANDSCAPE_SIZES` in config.ts for what each one means and why the range is
 * as narrow as it is. An unrecognised or missing value falls back to the
 * default rather than rejecting the URL, the same tolerance `readSeed` gives
 * a malformed `?seed=`.
 */
function readLandscapeSize(): LandscapeSizeId {
  const fromUrl = new URLSearchParams(window.location.search).get("size");
  return LANDSCAPE_SIZES.find((option) => option.id === fromUrl)?.id ?? DEFAULT_LANDSCAPE_SIZE;
}

// Before anything is drawn, so even the loading screen is in the player's language.
setLocale(resolveLocale());
labelDocument();
onLocaleChange(labelDocument);

boot().catch((error: unknown) => {
  // Built as text, not HTML: the message can carry whatever a failed request
  // or a hand-edited share code put in it.
  const panel = document.createElement("div");
  panel.className = "boot-status";
  const heading = document.createElement("div");
  heading.textContent = t("boot.failed");
  const detail = document.createElement("div");
  detail.textContent = error instanceof Error ? error.message : String(error);
  panel.append(heading, detail);
  document.body.append(panel);
  console.error(error);
});
