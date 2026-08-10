/**
 * Main-thread facade over the simulation worker.
 *
 * Turns the postMessage protocol into promises, and is the only module allowed
 * to construct the worker. Callers never see message plumbing.
 *
 * The worker URL is built with `new URL(..., import.meta.url)` so Vite rewrites
 * it through `base` at build time. Writing the path as a bare string here is the
 * classic way to ship a game that works locally and 404s on GitHub Pages.
 */

import type { StretchBounds } from "../core/normalise";
import type { LayerKey } from "./overlayPack";
import type {
  BreakDto,
  SitesDto,
  DistributiveOmit,
  CatchmentMetricsDto,
  CoverEditDto,
  ProgressCallback,
  ReachDto,
  SimRequest,
  SimResponse,
} from "./protocol";

/** Layers the main thread keeps for per-frame placement validation. */
export interface MainThreadArrays {
  readonly dem: Float32Array;
  readonly slopeDeg: Float32Array;
  readonly curvature: Float32Array;
  readonly accum: Float32Array;
  readonly channelMask: Uint8Array;
  readonly landCover: Uint8Array;
}

export interface GeneratedWorld {
  readonly seed: number;
  readonly outlet: number;
  readonly arrays: MainThreadArrays;
  /** Explicitly ArrayBuffer-backed, so it can be transferred back for reuse. */
  readonly overlay: Uint8Array<ArrayBuffer>;
  readonly reaches: ReachDto[];
  readonly sites: SitesDto;
  readonly bounds: StretchBounds;
  readonly baseline: CatchmentMetricsDto;
  readonly metrics: CatchmentMetricsDto;
}

export interface RecomputedWorld {
  readonly overlay: Uint8Array<ArrayBuffer>;
  readonly reachRisk: Float32Array;
  readonly metrics: CatchmentMetricsDto;
}

export interface StormPlayback {
  readonly depthMm: number;
  readonly returnPeriodDays: number;
  readonly q: Float32Array;
  readonly baselineQ: Float32Array;
  readonly depthFrames: Uint8Array;
  readonly frameCount: number;
  readonly depthScaleM: number;
  readonly stepSeconds: number;
  readonly peakQ: number;
  readonly baselinePeakQ: number;
  readonly tPeakSeconds: number;
  readonly baselineTPeakSeconds: number;
}

export interface SimClient {
  ping(): Promise<number>;
  generate(seed: number, layer: LayerKey, onProgress?: ProgressCallback): Promise<GeneratedWorld>;
  recompute(
    layer: LayerKey,
    breaks: readonly BreakDto[],
    coverEdits: readonly CoverEditDto[],
  ): Promise<RecomputedWorld>;
  setLayer(layer: LayerKey): Promise<RecomputedWorld>;
  storm(
    depthMm: number,
    damCells: readonly number[],
    pondCells: readonly number[],
  ): Promise<StormPlayback>;
  /** Hand an uploaded overlay buffer back for reuse. */
  release(buffer: ArrayBuffer): void;
  dispose(): void;
}

interface PendingJob {
  resolve(response: SimResponse): void;
  reject(error: Error): void;
  onProgress?: ProgressCallback;
}

export function createSimClient(): SimClient {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
    type: "module",
  });

  const pending = new Map<number, PendingJob>();
  let nextJobId = 1;

  /**
   * At most one recompute in flight and one waiting. A player dragging a
   * placement ghost can outrun the worker, and queueing every intermediate state
   * would make the overlay lag further behind with each frame. Replacing the
   * pending job instead means the worker always computes the newest state and
   * the display converges immediately once the player settles.
   */
  let inFlightRecompute = false;
  let queuedRecompute: (() => void) | null = null;

  worker.onmessage = (event: MessageEvent<SimResponse>): void => {
    const response = event.data;
    const job = pending.get(response.jobId);
    if (!job) return;

    if (response.type === "progress") {
      job.onProgress?.(response.progress, response.message);
      return;
    }

    pending.delete(response.jobId);
    if (response.type === "error") job.reject(new Error(response.message));
    else job.resolve(response);
  };

  worker.onerror = (event: ErrorEvent): void => {
    // A worker-level error has no job id, so every outstanding job is dead.
    const error = new Error(event.message || "Simulation worker failed to load");
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };

  function send(
    request: DistributiveOmit<SimRequest, "jobId">,
    onProgress?: ProgressCallback,
  ): Promise<SimResponse> {
    const jobId = nextJobId++;
    const promise = new Promise<SimResponse>((resolve, reject) => {
      pending.set(jobId, { resolve, reject, onProgress });
    });
    worker.postMessage({ ...request, jobId } as SimRequest);
    return promise;
  }

  function toRecomputed(response: SimResponse): RecomputedWorld {
    if (response.type !== "recomputed") throw new Error(`Unexpected ${response.type}`);
    return {
      overlay: new Uint8Array(response.overlay),
      reachRisk: new Float32Array(response.reachRisk),
      metrics: response.metrics,
    };
  }

  return {
    async ping() {
      const started = performance.now();
      await send({ type: "ping" });
      return performance.now() - started;
    },

    async generate(seed, layer, onProgress) {
      const response = await send({ type: "generate", seed, layer }, onProgress);
      if (response.type !== "generated") throw new Error(`Unexpected ${response.type}`);

      return {
        seed: response.seed,
        outlet: response.outlet,
        arrays: {
          dem: new Float32Array(response.dem),
          slopeDeg: new Float32Array(response.slopeDeg),
          curvature: new Float32Array(response.curvature),
          accum: new Float32Array(response.accum),
          channelMask: new Uint8Array(response.channelMask),
          landCover: new Uint8Array(response.landCover),
        },
        overlay: new Uint8Array(response.overlay),
        reaches: response.reaches,
        sites: response.sites,
        bounds: response.bounds,
        baseline: response.baseline,
        metrics: response.metrics,
      };
    },

    recompute(layer, breaks, coverEdits) {
      return new Promise<RecomputedWorld>((resolve, reject) => {
        const run = (): void => {
          inFlightRecompute = true;
          send({ type: "recompute", layer, breaks, coverEdits })
            .then((response) => resolve(toRecomputed(response)))
            .catch(reject)
            .finally(() => {
              inFlightRecompute = false;
              const next = queuedRecompute;
              queuedRecompute = null;
              next?.();
            });
        };

        if (inFlightRecompute) queuedRecompute = run;
        else run();
      });
    },

    async setLayer(layer) {
      return toRecomputed(await send({ type: "setLayer", layer }));
    },

    async storm(depthMm, damCells, pondCells) {
      const response = await send({
        type: "storm",
        depthMm,
        breaks: [],
        damCells,
        pondCells,
      });
      if (response.type !== "storm") throw new Error(`Unexpected ${response.type}`);

      return {
        depthMm: response.depthMm,
        returnPeriodDays: response.returnPeriodDays,
        q: new Float32Array(response.q),
        baselineQ: new Float32Array(response.baselineQ),
        depthFrames: new Uint8Array(response.depthFrames),
        frameCount: response.frameCount,
        depthScaleM: response.depthScaleM,
        stepSeconds: response.stepSeconds,
        peakQ: response.peakQ,
        baselinePeakQ: response.baselinePeakQ,
        tPeakSeconds: response.tPeakSeconds,
        baselineTPeakSeconds: response.baselineTPeakSeconds,
      };
    },

    release(buffer) {
      worker.postMessage({ type: "release", buffers: [buffer] } as SimRequest, [buffer]);
    },

    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
