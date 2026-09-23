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
import type { GridSpec } from "../core/grid";
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
  /**
   * The worker's D8 successor per cell (-1 at the outlet). Sent rather than
   * re-derived: the fill that tilts flat valley floors towards the outlet is
   * a millionth of a metre, far below what the Float32 `dem` copy can hold, so
   * steepest descent on the main thread picks a direction from rounding noise
   * exactly where the channels — and so the dams — are.
   */
  readonly downstream: Int32Array;
}

export interface GeneratedWorld {
  readonly seed: number;
  /** The extent this catchment was actually generated at. */
  readonly spec: GridSpec;
  readonly outlet: number;
  readonly arrays: MainThreadArrays;
  /** Explicitly ArrayBuffer-backed, so it can be transferred back for reuse. */
  readonly overlay: Uint8Array<ArrayBuffer>;
  readonly reaches: ReachDto[];
  /** In-channel risk per reach vertex, so the river is coloured from the first frame. */
  readonly reachRisk: Float32Array;
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
  generate(
    seed: number,
    layer: LayerKey,
    spec?: GridSpec,
    onProgress?: ProgressCallback,
  ): Promise<GeneratedWorld>;
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

interface RecomputeRequest {
  readonly layer: Parameters<SimClient["recompute"]>[0];
  readonly breaks: readonly BreakDto[];
  readonly coverEdits: readonly CoverEditDto[];
}

interface RecomputeWaiter {
  resolve(result: RecomputedWorld): void;
  reject(error: unknown): void;
}

export function createSimClient(): SimClient {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
    type: "module",
  });

  const pending = new Map<number, PendingJob>();
  let nextJobId = 1;
  /**
   * Set once the worker can no longer answer — it failed to load, crashed, or
   * was disposed. Every later request rejects straight away instead of posting
   * into a dead worker and waiting for a reply that will never come, which
   * would leave every "one at a time" flag on the main thread stuck on.
   */
  let failure: Error | null = null;

  /**
   * At most one recompute in flight and one waiting. Callers always send the
   * complete current set of features, so a newer request supersedes a waiting
   * one entirely: the waiting request is replaced, and everyone who asked is
   * answered with the newest state — which includes whatever they asked for.
   * Queueing every intermediate state instead would make the overlay lag
   * further behind with each request.
   */
  let inFlightRecompute = false;
  let queued: { request: RecomputeRequest; waiters: RecomputeWaiter[] } | null = null;

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

  const fail = (error: Error): void => {
    failure = error;
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };

  worker.onerror = (event: ErrorEvent): void => {
    // A worker-level error has no job id, so every outstanding job is dead —
    // and so is the worker.
    fail(new Error(event.message || "Simulation worker failed to load"));
  };

  function send(
    request: DistributiveOmit<SimRequest, "jobId">,
    onProgress?: ProgressCallback,
  ): Promise<SimResponse> {
    if (failure) return Promise.reject(failure);
    const jobId = nextJobId++;
    const promise = new Promise<SimResponse>((resolve, reject) => {
      pending.set(jobId, { resolve, reject, onProgress });
    });
    try {
      worker.postMessage({ ...request, jobId } as SimRequest);
    } catch (error: unknown) {
      // A request that cannot be cloned never reaches the worker, so nothing
      // will ever answer it: settle it here rather than leak it.
      const job = pending.get(jobId);
      pending.delete(jobId);
      job?.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  function runRecompute(request: RecomputeRequest, waiters: RecomputeWaiter[]): void {
    inFlightRecompute = true;
    send({ type: "recompute", ...request })
      .then((response) => {
        const result = toRecomputed(response);
        for (const waiter of waiters) waiter.resolve(result);
      })
      .catch((error: unknown) => {
        for (const waiter of waiters) waiter.reject(error);
      })
      .finally(() => {
        inFlightRecompute = false;
        const next = queued;
        queued = null;
        if (next) runRecompute(next.request, next.waiters);
      });
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

    async generate(seed, layer, spec, onProgress) {
      const response = await send({ type: "generate", seed, layer, spec }, onProgress);
      if (response.type !== "generated") throw new Error(`Unexpected ${response.type}`);

      return {
        seed: response.seed,
        spec: response.spec,
        outlet: response.outlet,
        arrays: {
          dem: new Float32Array(response.dem),
          slopeDeg: new Float32Array(response.slopeDeg),
          curvature: new Float32Array(response.curvature),
          accum: new Float32Array(response.accum),
          channelMask: new Uint8Array(response.channelMask),
          landCover: new Uint8Array(response.landCover),
          downstream: new Int32Array(response.downstream),
        },
        overlay: new Uint8Array(response.overlay),
        reaches: response.reaches,
        reachRisk: new Float32Array(response.reachRisk),
        sites: response.sites,
        bounds: response.bounds,
        baseline: response.baseline,
        metrics: response.metrics,
      };
    },

    recompute(layer, breaks, coverEdits) {
      return new Promise<RecomputedWorld>((resolve, reject) => {
        const request: RecomputeRequest = { layer, breaks, coverEdits };
        const waiter: RecomputeWaiter = { resolve, reject };
        if (!inFlightRecompute) {
          runRecompute(request, [waiter]);
        } else if (queued) {
          queued.request = request;
          queued.waiters.push(waiter);
        } else {
          queued = { request, waiters: [waiter] };
        }
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
      if (failure) return;
      worker.postMessage({ type: "release", buffers: [buffer] } as SimRequest, [buffer]);
    },

    dispose() {
      worker.terminate();
      fail(new Error("Simulation worker was disposed"));
      const waiting = queued;
      queued = null;
      for (const waiter of waiting?.waiters ?? []) waiter.reject(failure);
    },
  };
}
