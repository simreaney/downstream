/**
 * The HUD, redrawn for a headset.
 *
 * The page's HUD is HTML, and nothing in the DOM reaches the inside of an
 * immersive session: the compositor shows only what is drawn into the WebGL
 * layer. So the same information is painted onto two canvases and shown as
 * textured planes.
 *
 * - A **dashboard** standing at the near-left corner of the table like a
 *   lectern: inventory, tools, the three health bars, the risk layer and its
 *   legend, the occasional actions (storm, undo, save), and the tutorial or a
 *   reminder of the controls. The player points the right controller at it and
 *   pulls the trigger.
 * - A **label** floating over the character, carrying the placement readout
 *   and toasts. Those two answer "what will that do?" and "what did that do?",
 *   so they belong where the player is looking when they act, not on a panel
 *   off to one side.
 *
 * It implements `Hud`, so `main.ts` drives it with the same calls as the
 * page's (see `mirrorHud`). Off the headset it costs next to nothing: a
 * setter records state and marks a canvas dirty, and the canvases are only
 * repainted from `update`, which runs only while presenting.
 *
 * Both planes draw over everything, with no depth test. A hill or a tree crown
 * between the eyes and a readout would otherwise hide the one thing the player
 * needs to read.
 *
 * The layout is fixed, and translations run longer than the English it was
 * drawn around, so text that would not fit is set a little smaller before
 * anything is cut off (`fitFont`, `fitLines`).
 */

import * as THREE from "three";
import type { Hud } from "../ui/hud";
import { costOf, type InterventionKind } from "../game/interventions";
import type { InventoryState } from "../game/inventory";
import type { Scores } from "../game/scoring";
import { onLocaleChange, t, type MessageKey } from "../i18n";
import { layerText } from "../ui/overlayLegend";
import { LAYER_STYLE, type LayerKey } from "../worker/overlayPack";
import { LUTS } from "../worker/ramps";

/** Things on the dashboard that can be pressed. */
export type DashboardButton =
  | "toolTree"
  | "toolDam"
  | "toolPond"
  | "overlayNext"
  | "overlayOff"
  | "storm"
  | "undo"
  | "save"
  | "skipTutorial"
  | "exit";

export interface DashboardHit {
  /** The button under the ray, or null over the panel's background. */
  readonly button: DashboardButton | null;
  /** Along the ray, in rig-space (real) metres. */
  readonly distance: number;
}

export interface XrHud extends Hud {
  readonly dashboard: THREE.Mesh;
  readonly label: THREE.Mesh;
  setScores(scores: Scores): void;
  setLayer(layer: LayerKey): void;
  /** Tutorial prompt, or null once it is finished — the controls reminder shows instead. */
  setTutorial(text: string | null): void;
  /** Ask the player to pick up their controllers, when the headset has switched to hands. */
  setControllersMissing(missing: boolean): void;
  /**
   * Stand the dashboard at the table's near-left corner, facing the eyes.
   * Both in rig space; the dashboard is a child of the rig.
   */
  placeDashboard(table: THREE.Vector3, eye: THREE.Vector3): void;
  /**
   * Hit-test a ray in rig space against the dashboard, and highlight what it
   * is over. Null when it misses; pass a null origin to clear the highlight.
   */
  point(origin: THREE.Vector3 | null, direction?: THREE.Vector3): DashboardHit | null;
  /** Float the label over the character's head, facing the eyes, at a constant real size. */
  placeLabel(feet: THREE.Vector3, eye: THREE.Vector3, scale: number): void;
  /**
   * Start or stop presenting. Showing repaints both canvases from current
   * state, since nothing was painted while the player was on the page; hiding
   * takes both planes out of the scene's draw list.
   */
  show(on: boolean): void;
  /** Repaint whatever changed. Call once a frame while presenting. */
  update(): void;
}

// The page's design tokens (`styles.css`), so the headset looks like the same game.
const INK = "#3d3226";
const INK_SOFT = "#6b5c4a";
const PAPER = "#fdf6e3";
const PAPER_WARM = "#f7e9c8";
const ACCENT = "#4fb286";
const ACCENT_DEEP = "#2f7d5c";
const DANGER = "#d9704f";
const WARN = "#9a6f1c";
const SHADOW = "rgba(61, 50, 38, 0.18)";
const TRACK = "rgba(61, 50, 38, 0.1)";
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Dashboard canvas and physical size.
 *
 * 0.46 m wide at about 63 cm from the eyes, so a 28 px line on a 1024 px
 * canvas is a little over a degree tall: about the smallest that reads
 * comfortably on a Quest 2, and sharp on a Quest 3. Smaller looked tidier and
 * had to be squinted at.
 */
const DASH_W = 1024;
const DASH_H = 832;
const DASH_WIDTH_M = 0.46;
const DASH_HEIGHT_M = (DASH_WIDTH_M * DASH_H) / DASH_W;

/** Label canvas and physical size: 40 px text about a degree and a quarter tall at the character. */
const LABEL_W = 1024;
/**
 * Room for the readout and a toast, each on up to two lines. Painted from the
 * bottom up, so the extra height is empty canvas above them, and a one-line
 * readout sits exactly where it would on a shorter canvas.
 */
const LABEL_H = 320;
const LABEL_WIDTH_M = 0.4;
const LABEL_HEIGHT_M = (LABEL_WIDTH_M * LABEL_H) / LABEL_W;

/** World metres from the character's feet to the tip of the sprout on their head. */
const CHARACTER_HEIGHT_M = 2.8;
/** Real metres between the head and the label. */
const LABEL_GAP_M = 0.015;

/** Seconds a toast stays up; a little longer than the page's, since reading in a headset is slower. */
const TOAST_SECONDS = 3.2;
/** Seconds a score's trend arrow stays up, as on the page. */
const TREND_SECONDS = 3.2;
/** Seconds between label repaints while the readout changes every frame as the player walks. */
const LABEL_MIN_INTERVAL = 0.1;

const TOOLS: { kind: InterventionKind; button: DashboardButton; label: MessageKey }[] = [
  { kind: "tree", button: "toolTree", label: "tool.tree" },
  { kind: "dam", button: "toolDam", label: "tool.dam" },
  { kind: "pond", button: "toolPond", label: "tool.pond" },
];

const BARS: { key: keyof Scores; label: MessageKey }[] = [
  { key: "waterQuality", label: "score.waterQuality" },
  { key: "floodRisk", label: "score.floodRisk" },
  { key: "habitat", label: "score.habitat" },
];

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Fixed layout, in dashboard canvas pixels. */
const PAD = 32;
const LAYOUT = {
  header: { x: PAD, y: 28, w: DASH_W - PAD * 2, h: 64 },
  tools: TOOLS.map((_, i) => ({ x: PAD + i * 328, y: 112, w: 312, h: 96 })),
  bars: BARS.map((_, i) => ({ x: PAD, y: 236 + i * 50, w: DASH_W - PAD * 2, h: 40 })),
  layerNext: { x: PAD, y: 400, w: 640, h: 76 },
  layerOff: { x: PAD + 656, y: 400, w: DASH_W - PAD * 2 - 656, h: 76 },
  legend: { x: PAD, y: 492, w: DASH_W - PAD * 2, h: 88 },
  actions: (["storm", "undo", "save", "exit"] as const).map((id, i) => ({
    id,
    rect: { x: PAD + i * 244, y: 600, w: 228, h: 80 },
  })),
  tutorial: { x: PAD, y: 704, w: DASH_W - PAD * 2, h: 100 },
  skip: { x: DASH_W - PAD - 150, y: 722, w: 150, h: 64 },
} as const;

const ACTION_LABELS: Record<(typeof LAYOUT.actions)[number]["id"], MessageKey> = {
  storm: "vr.storm",
  undo: "vr.undo",
  save: "vr.save",
  exit: "vr.exit",
};

/** Where a bar's track starts, relative to the row, unless a label needs more room. */
const BAR_TRACK_X = 230;
/** Where every bar's track ends, relative to the row; the value sits to its right. */
const BAR_TRACK_END = 790;

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function roundedRect(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  const { x, y, w, h } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A paper card with the page's flat drop shadow (`--shadow`). */
function card(ctx: CanvasRenderingContext2D, rect: Rect, radius: number, fill: string): void {
  ctx.fillStyle = SHADOW;
  roundedRect(ctx, { ...rect, y: rect.y + 4 }, radius);
  ctx.fill();
  ctx.fillStyle = fill;
  roundedRect(ctx, rect, radius);
  ctx.fill();
}

/** Greedy word wrap, as many lines as it takes. */
function breakLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  // Breaking at ordinary spaces only, so a non-breaking one keeps "12 %" together.
  const words = text.split(/[ \t\n]+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= width || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Greedy word wrap. Returns at most `maxLines`, the last one ellipsised if it had to be cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines = breakLines(ctx, text, width);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/**
 * Set the largest font from `size` down to `min` px at which `text` fits
 * `width` on one line, and return the text, ellipsised if even `min` is too big.
 */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  weight: number,
  size: number,
  min: number,
): string {
  for (let px = size; px >= min; px--) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(text).width <= width) return text;
  }
  return wrap(ctx, text, width, 1)[0];
}

/**
 * Wrap `text` into at most `maxLines`, setting it smaller, down to `min` px,
 * before cutting any of it. Leaves the font set, and returns the lines with
 * the line height for the size chosen.
 */
function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
  weight: number,
  size: number,
  min: number,
): { lines: string[]; lineHeight: number } {
  for (let px = size; px >= min; px--) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    const lines = breakLines(ctx, text, width);
    if (lines.length <= maxLines || px === min) {
      return { lines: lines.length <= maxLines ? lines : wrap(ctx, text, width, maxLines), lineHeight: Math.round(px * 1.2) };
    }
  }
  return { lines: [], lineHeight: 0 };
}

function canvasPlane(
  width: number,
  height: number,
  widthM: number,
  heightM: number,
  renderOrder: number,
): {
  ctx: CanvasRenderingContext2D | null;
  texture: THREE.Texture;
  mesh: THREE.Mesh;
  /** Give the canvas its full size; until then it is 1 × 1. */
  allocate(): void;
} {
  // No document in the unit tests, which never draw; the mesh still exists so
  // the rest of the rig can be built around it.
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  // A pixel until the first session. Every page builds this HUD, and most
  // never enter VR, so its four megabytes of canvas wait until one does.
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
  const ctx = canvas?.getContext("2d") ?? null;
  const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mipmapped and anisotropic, so text stays crisp on a panel seen at an
  // angle, which the dashboard always is.
  texture.anisotropy = 8;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), material);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    ctx,
    texture,
    mesh,
    allocate() {
      if (!canvas || canvas.width === width) return;
      canvas.width = width;
      canvas.height = height;
      // A resized canvas needs a new GPU texture, not an upload into the old one.
      texture.dispose();
    },
  };
}

export function createXrHud(): XrHud {
  const dash = canvasPlane(DASH_W, DASH_H, DASH_WIDTH_M, DASH_HEIGHT_M, 2000);
  const tag = canvasPlane(LABEL_W, LABEL_H, LABEL_WIDTH_M, LABEL_HEIGHT_M, 2001);

  let inventory: InventoryState = { wood: 0, stone: 0, hasSpade: false };
  let tool: InterventionKind = "tree";
  let scores: Scores | null = null;
  const previous = new Map<keyof Scores, number>();
  const trends = new Map<keyof Scores, { up: boolean; until: number }>();
  let layer: LayerKey = "none";
  let tutorial: string | null = null;
  let hovered: DashboardButton | null = null;
  let dashDirty = true;
  /** When the next trend arrow expires, so the dashboard repaints without it. */
  let dashExpiry = Infinity;

  let readout = { message: "", ok: true, warn: false };
  let toastText = "";
  let toastUntil = 0;
  let controllersMissing = false;
  let labelDirty = true;
  let labelPaintedAt = -Infinity;

  const now = (): number => performance.now() / 1000;

  // ------------------------------------------------------------ dashboard --

  const button = (
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    id: DashboardButton,
    text: string,
    options: { active?: boolean; sub?: string; size?: number } = {},
  ): void => {
    const active = options.active ?? false;
    const hot = hovered === id;
    card(ctx, rect, 22, active ? ACCENT : hot ? "#ffffff" : PAPER_WARM);
    if (hot) {
      ctx.strokeStyle = active ? ACCENT_DEEP : ACCENT;
      ctx.lineWidth = 5;
      roundedRect(ctx, rect, 22);
      ctx.stroke();
    }
    ctx.fillStyle = active ? "#ffffff" : INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = options.size ?? 32;
    const room = rect.w - 32;
    const title = fitFont(ctx, text, room, 700, size, Math.round(size * 0.7));
    const cx = rect.x + rect.w / 2;
    if (options.sub) {
      ctx.fillText(title, cx, rect.y + rect.h / 2 - 15);
      const sub = fitFont(ctx, options.sub, room, 500, 24, 18);
      ctx.fillStyle = active ? "rgba(255,255,255,0.85)" : INK_SOFT;
      ctx.fillText(sub, cx, rect.y + rect.h / 2 + 22);
    } else {
      ctx.fillText(title, cx, rect.y + rect.h / 2 + 1);
    }
  };

  const paintDashboard = (): void => {
    const ctx = dash.ctx;
    if (!ctx) return;
    const time = now();
    ctx.clearRect(0, 0, DASH_W, DASH_H);
    card(ctx, { x: 4, y: 4, w: DASH_W - 8, h: DASH_H - 12 }, 36, PAPER);

    // Inventory, and the headline score.
    const { header } = LAYOUT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let x = header.x;
    const chips: [string, string, boolean][] = [
      ["#8a6236", t("vr.wood", { count: inventory.wood }), true],
      ["#9aa3a8", t("vr.stone", { count: inventory.stone }), true],
      ["#e5a12f", t(inventory.hasSpade ? "vr.spade" : "vr.noSpade"), inventory.hasSpade],
    ];
    ctx.font = `700 30px ${FONT}`;
    for (const [colour, text, on] of chips) {
      const width = ctx.measureText(text).width + 70;
      ctx.globalAlpha = on ? 1 : 0.5;
      card(ctx, { x, y: header.y + 6, w: width, h: 52 }, 26, PAPER_WARM);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x + 28, header.y + 32, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(text, x + 48, header.y + 33);
      ctx.globalAlpha = 1;
      x += width + 14;
    }
    ctx.textAlign = "right";
    const overall = scores ? String(Math.round(scores.overall)) : "–";
    ctx.font = `800 46px ${FONT}`;
    const overallWidth = ctx.measureText(overall).width;
    ctx.fillStyle = INK;
    ctx.fillText(overall, header.x + header.w, header.y + 34);
    // In whatever room the inventory chips have left.
    const healthRight = header.x + header.w - overallWidth - 16;
    const health = fitFont(ctx, t("score.title"), healthRight - x - 4, 600, 26, 18);
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(health, healthRight, header.y + 34);

    // Tools, with their price.
    TOOLS.forEach((entry, i) => {
      const cost = costOf(entry.kind);
      const price =
        cost.wood > 0 ? t("vr.priceWood", { count: cost.wood }) : t("vr.priceStone", { count: cost.stone });
      button(ctx, LAYOUT.tools[i], entry.button, t(entry.label), { active: tool === entry.kind, sub: price });
    });

    // Health bars. The tracks start together, after the longest label, so a
    // long translation shortens all three bars rather than overprinting one.
    ctx.font = `600 27px ${FONT}`;
    let labelWidth = 0;
    for (const bar of BARS) labelWidth = Math.max(labelWidth, ctx.measureText(t(bar.label)).width);
    const trackX = Math.min(Math.max(BAR_TRACK_X, labelWidth + 24), BAR_TRACK_END - 360);
    BARS.forEach((bar, i) => {
      const rect = LAYOUT.bars[i];
      const value = scores ? scores[bar.key] : 0;
      const mid = rect.y + rect.h / 2;
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.fillText(fitFont(ctx, t(bar.label), trackX - 24, 600, 27, 19), rect.x, mid);
      const track = { x: rect.x + trackX, y: mid - 9, w: BAR_TRACK_END - trackX, h: 18 };
      ctx.fillStyle = TRACK;
      roundedRect(ctx, track, 9);
      ctx.fill();
      ctx.fillStyle = ACCENT;
      roundedRect(ctx, { ...track, w: Math.max(18, (track.w * Math.max(0, Math.min(100, value))) / 100) }, 9);
      ctx.fill();
      ctx.textAlign = "right";
      ctx.font = `700 27px ${FONT}`;
      ctx.fillText(String(Math.round(value)), rect.x + 870, mid);
      const trend = trends.get(bar.key);
      if (trend && trend.until > time) {
        ctx.textAlign = "left";
        ctx.fillStyle = trend.up ? ACCENT_DEEP : DANGER;
        ctx.fillText(trend.up ? "▲" : "▼", rect.x + 890, mid);
      }
    });

    // Risk map: which layer, and its legend.
    const style = layer === "none" ? null : LAYER_STYLE[layer];
    const text = layer === "none" ? null : layerText(layer);
    button(
      ctx,
      LAYOUT.layerNext,
      "overlayNext",
      text ? `${t("vr.riskMap", { layer: text.label })}  ›` : t("vr.showRiskMap"),
      { active: text !== null },
    );
    button(ctx, LAYOUT.layerOff, "overlayOff", t("vr.hideMap"));
    if (style && text) {
      const { legend } = LAYOUT;
      ctx.textAlign = "left";
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(fitFont(ctx, text.description, legend.w, 500, 25, 20), legend.x, legend.y + 18);
      const ramp = { x: legend.x, y: legend.y + 42, w: legend.w - 250, h: 22 };
      const lut = LUTS[style.ramp];
      const gradient = ctx.createLinearGradient(ramp.x, 0, ramp.x + ramp.w, 0);
      for (let i = 0; i <= 12; i++) {
        const index = Math.round((i / 12) * 255) * 3;
        gradient.addColorStop(i / 12, `rgb(${lut[index]},${lut[index + 1]},${lut[index + 2]})`);
      }
      ctx.fillStyle = gradient;
      roundedRect(ctx, ramp, 11);
      ctx.fill();
      // Both ends share the room after the ramp, at one size.
      const ends = `${t("legend.lower")}    ${t("legend.higher")}`;
      fitFont(ctx, ends, legend.x + legend.w - (ramp.x + ramp.w + 18), 600, 23, 16);
      ctx.fillStyle = INK_SOFT;
      ctx.textAlign = "left";
      ctx.fillText(t("legend.lower"), ramp.x + ramp.w + 18, ramp.y + 12);
      ctx.textAlign = "right";
      ctx.fillText(t("legend.higher"), legend.x + legend.w, ramp.y + 12);
    }

    for (const { id, rect } of LAYOUT.actions) button(ctx, rect, id, t(ACTION_LABELS[id]));

    // Tutorial step, or a reminder of the controls once it is done.
    const { tutorial: box } = LAYOUT;
    card(ctx, box, 24, PAPER_WARM);
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    if (tutorial) {
      const { lines, lineHeight } = fitLines(ctx, tutorial, box.w - LAYOUT.skip.w - 56, 3, 500, 25, 21);
      lines.forEach((line, i) =>
        ctx.fillText(line, box.x + 22, box.y + 50 + (i - (lines.length - 1) / 2) * lineHeight),
      );
      button(ctx, LAYOUT.skip, "skipTutorial", t("tutorial.skip"), { size: 26 });
    } else {
      ctx.fillStyle = INK_SOFT;
      const { lines, lineHeight } = fitLines(ctx, t("vr.controls"), box.w - 44, 3, 500, 23, 19);
      lines.forEach((line, i) =>
        ctx.fillText(line, box.x + 22, box.y + 50 + (i - (lines.length - 1) / 2) * lineHeight),
      );
    }

    dash.texture.needsUpdate = true;
  };

  /** The button at a point on the dashboard canvas, if any. */
  const buttonAt = (x: number, y: number): DashboardButton | null => {
    for (let i = 0; i < TOOLS.length; i++) if (inside(LAYOUT.tools[i], x, y)) return TOOLS[i].button;
    if (inside(LAYOUT.layerNext, x, y)) return "overlayNext";
    if (inside(LAYOUT.layerOff, x, y)) return "overlayOff";
    for (const { id, rect } of LAYOUT.actions) if (inside(rect, x, y)) return id;
    if (tutorial && inside(LAYOUT.skip, x, y)) return "skipTutorial";
    return null;
  };

  // ---------------------------------------------------------------- label --

  const paintLabel = (): void => {
    const ctx = tag.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    /**
     * A message on one line, or two rather than losing its end: a refusal's
     * reason comes last ("…would wash out"), and translations run longer
     * than the English. Returns the pill's top, for stacking the next above.
     */
    const pill = (text: string, bottom: number, fill: string, colour: string): number => {
      const { lines, lineHeight } = fitLines(ctx, text, LABEL_W - 120, 2, 700, 40, 32);
      let widest = 0;
      for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
      const width = Math.min(LABEL_W - 16, widest + 64);
      const height = 88 + (lines.length - 1) * lineHeight;
      const top = bottom - height;
      card(ctx, { x: (LABEL_W - width) / 2, y: top, w: width, h: height }, 44, fill);
      ctx.fillStyle = colour;
      lines.forEach((line, i) =>
        ctx.fillText(line, LABEL_W / 2, top + height / 2 + 1 + (i - (lines.length - 1) / 2) * lineHeight),
      );
      return top;
    };

    const toastLive = toastText !== "" && toastUntil > now();
    // Bottom row first, so a lone line sits just over the character's head.
    const bottom = LABEL_H - 12;
    if (controllersMissing) {
      pill(t("vr.pickUpControllers"), bottom, INK, PAPER);
    } else {
      let next = bottom;
      if (readout.message) {
        const colour = !readout.ok ? DANGER : readout.warn ? WARN : ACCENT_DEEP;
        next = pill(readout.message, bottom, PAPER, colour) - 32;
      }
      if (toastLive) pill(toastText, next, INK, PAPER);
    }

    tag.mesh.visible = controllersMissing || toastLive || readout.message !== "";
    tag.texture.needsUpdate = true;
  };

  // -------------------------------------------------------------- placing --

  const local = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const headTop = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const screenUp = new THREE.Vector3();

  const hover = (next: DashboardButton | null): void => {
    if (next === hovered) return;
    hovered = next;
    dashDirty = true;
  };

  // Both planes are mostly words. The readout is re-sent every frame anyway;
  // this repaints the rest in the new language.
  const stopLabelling = onLocaleChange(() => {
    dashDirty = true;
    labelDirty = true;
    labelPaintedAt = -Infinity;
  });

  return {
    dashboard: dash.mesh,
    label: tag.mesh,

    setInventory(state) {
      inventory = state;
      dashDirty = true;
    },

    setTool(kind) {
      tool = kind;
      dashDirty = true;
    },

    setReadout(message, ok, warn) {
      if (message === readout.message && ok === readout.ok && warn === readout.warn) return;
      readout = { message, ok, warn };
      labelDirty = true;
    },

    toast(message) {
      toastText = message;
      toastUntil = now() + TOAST_SECONDS;
      labelDirty = true;
      // A toast is news; show it now rather than at the next throttle slot.
      labelPaintedAt = -Infinity;
    },

    setScores(next) {
      const time = now();
      for (const bar of BARS) {
        const value = next[bar.key];
        const was = previous.get(bar.key);
        // Same threshold as the page: below a tenth of a point the rounded
        // number cannot show the change the arrow would point at.
        if (was !== undefined && Math.abs(value - was) > 0.1) {
          trends.set(bar.key, { up: value > was, until: time + TREND_SECONDS });
          dashExpiry = Math.min(dashExpiry, time + TREND_SECONDS);
        }
        previous.set(bar.key, value);
      }
      scores = next;
      dashDirty = true;
    },

    setLayer(next) {
      layer = next;
      dashDirty = true;
    },

    setTutorial(text) {
      if (text === tutorial) return;
      tutorial = text;
      dashDirty = true;
    },

    setControllersMissing(missing) {
      if (missing === controllersMissing) return;
      controllersMissing = missing;
      labelDirty = true;
      labelPaintedAt = -Infinity;
    },

    placeDashboard(table, eye) {
      // Off the near-left corner of the table, raised a little and turned to
      // face the eyes like a lectern, so it reads without stooping and stays
      // clear of where the character usually is.
      dash.mesh.position.set(table.x - 0.48, table.y + 0.22, table.z + 0.26);
      local.lookAt(eye, dash.mesh.position, up);
      dash.mesh.quaternion.setFromRotationMatrix(local);
      dash.mesh.updateMatrix();
      dash.mesh.visible = true;
    },

    point(origin, direction) {
      if (!origin || !direction || !dash.mesh.visible) {
        hover(null);
        return null;
      }
      // Into the panel's own frame, where it is the z = 0 plane.
      inverse.copy(dash.mesh.matrix).invert();
      rayOrigin.copy(origin).applyMatrix4(inverse);
      rayDirection.copy(direction).transformDirection(inverse);
      if (rayDirection.z >= 0 || rayOrigin.z <= 0) {
        hover(null);
        return null;
      }
      const distance = -rayOrigin.z / rayDirection.z;
      at.copy(rayOrigin).addScaledVector(rayDirection, distance);
      if (Math.abs(at.x) > DASH_WIDTH_M / 2 || Math.abs(at.y) > DASH_HEIGHT_M / 2) {
        hover(null);
        return null;
      }
      const x = (at.x / DASH_WIDTH_M + 0.5) * DASH_W;
      const y = (0.5 - at.y / DASH_HEIGHT_M) * DASH_H;
      const hit = buttonAt(x, y);
      hover(hit);
      return { button: hit, distance };
    },

    placeLabel(feet, eye, scale) {
      const mesh = tag.mesh;
      mesh.scale.setScalar(scale);
      // Lifted along whichever way is up *on screen*, not straight up: the
      // player mostly looks down on the character, and from above, a label
      // raised vertically slides down over the head it is meant to clear.
      headTop.set(feet.x, feet.y + CHARACTER_HEIGHT_M, feet.z);
      toEye.subVectors(eye, headTop).normalize();
      screenUp.set(0, 1, 0).addScaledVector(toEye, -toEye.y);
      // Looking straight down, screen-up is the way the player faces.
      if (screenUp.lengthSq() < 1e-6) screenUp.set(-toEye.x, 0, -toEye.z);
      screenUp.normalize();
      mesh.position.copy(headTop).addScaledVector(screenUp, (LABEL_GAP_M + LABEL_HEIGHT_M / 2) * scale);
      mesh.lookAt(eye);
    },

    show(on) {
      if (on) {
        dash.allocate();
        tag.allocate();
        dashDirty = true;
        labelDirty = true;
        labelPaintedAt = -Infinity;
        return;
      }
      dash.mesh.visible = false;
      tag.mesh.visible = false;
      hover(null);
    },

    update() {
      const time = now();
      if (time >= dashExpiry) {
        dashExpiry = Infinity;
        for (const trend of trends.values()) if (trend.until > time) dashExpiry = Math.min(dashExpiry, trend.until);
        dashDirty = true;
      }
      if (dashDirty) {
        dashDirty = false;
        paintDashboard();
      }

      if (toastText && toastUntil <= time) {
        toastText = "";
        labelDirty = true;
        labelPaintedAt = -Infinity;
      }
      if (labelDirty && time - labelPaintedAt >= LABEL_MIN_INTERVAL) {
        labelDirty = false;
        labelPaintedAt = time;
        paintLabel();
      }
    },

    dispose() {
      stopLabelling();
      for (const plane of [dash, tag]) {
        plane.texture.dispose();
        plane.mesh.geometry.dispose();
        (plane.mesh.material as THREE.Material).dispose();
        plane.mesh.removeFromParent();
      }
    },
  };
}
