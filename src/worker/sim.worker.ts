/**
 * The simulation worker: terrain generation, the whole SCIMAP pipeline, and
 * (later) storm routing.
 *
 * One worker, not several. These workloads never run concurrently — the player
 * is either generating a catchment, placing a feature, or watching a storm — so
 * a second worker would buy no parallelism while doubling the problem of who
 * owns the canonical arrays.
 *
 * This module is a dispatcher and nothing else; the work lives in `handlers.ts`
 * so it can be tested without a worker environment.
 */

import {
  handleGenerate,
  handleRecompute,
  handleRelease,
  handleSetLayer,
  handleStorm,
} from "./handlers";
import type { CatchmentMetricsDto, SimRequest, SimResponse } from "./protocol";

const EMPTY_METRICS: CatchmentMetricsDto = {
  meanSourceRisk: NaN,
  meanConnectivity: NaN,
  inChannelAtOutlet: NaN,
  inChannelAtFishery: NaN,
  woodlandFraction: NaN,
  channelCells: 0,
  bufferedChannelCells: 0,
  longestBufferRun: 0,
  pondCount: 0,
};

function post(response: SimResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(response, transfer);
}

self.onmessage = (event: MessageEvent<SimRequest>): void => {
  const request = event.data;

  try {
    switch (request.type) {
      case "ping":
        post({ type: "pong", jobId: request.jobId });
        break;

      case "generate": {
        const { jobId, seed, layer, spec } = request;
        const result = handleGenerate(seed, layer, spec, (progress, message) => {
          post({ type: "progress", jobId, progress, message });
        });

        const { arrays } = result.world;

        // The main thread gets its own copies of the layers that placement
        // validation reads every frame. Copies, not the originals: the worker
        // keeps mutating these, and a transferred buffer would be detached here.
        const dem = Float32Array.from(arrays.dem);
        const slopeDeg = Float32Array.from(arrays.slopeDeg);
        const curvature = Float32Array.from(arrays.curvature);
        const accum = Float32Array.from(arrays.accum);
        const channelMask = Uint8Array.from(arrays.channelMask);
        const landCover = Uint8Array.from(arrays.landCover);

        post(
          {
            type: "generated",
            jobId,
            seed,
            spec: arrays.spec,
            outlet: arrays.outlet,
            dem: dem.buffer,
            slopeDeg: slopeDeg.buffer,
            curvature: curvature.buffer,
            accum: accum.buffer,
            channelMask: channelMask.buffer,
            landCover: landCover.buffer,
            overlay: result.overlay,
            reaches: result.reaches,
            sites: result.sites,
            bounds: result.world.bounds,
            baseline: result.baseline,
            metrics: result.metrics,
          },
          [
            dem.buffer,
            slopeDeg.buffer,
            curvature.buffer,
            accum.buffer,
            channelMask.buffer,
            landCover.buffer,
            result.overlay,
          ],
        );
        break;
      }

      case "recompute": {
        const { jobId, layer, breaks, coverEdits } = request;
        const result = handleRecompute(layer, breaks, coverEdits);
        post(
          {
            type: "recomputed",
            jobId,
            overlay: result.overlay,
            reachRisk: result.reachRisk.buffer,
            metrics: result.metrics,
          },
          [result.overlay, result.reachRisk.buffer],
        );
        break;
      }

      case "setLayer": {
        const overlay = handleSetLayer(request.layer);
        post(
          {
            type: "recomputed",
            jobId: request.jobId,
            overlay,
            reachRisk: new Float32Array(0).buffer,
            // A layer change touches no model state, so the metrics are stale
            // by construction; the client ignores them for this response type.
            metrics: EMPTY_METRICS,
          },
          [overlay],
        );
        break;
      }

      case "storm": {
        const { jobId, depthMm, damCells, pondCells } = request;
        const outcome = handleStorm(depthMm, damCells, pondCells);
        const { result } = outcome;

        // Copies, because the worker keeps its own arrays alive across storms
        // and a transferred buffer would be detached here.
        const q = Float32Array.from(result.withFeatures.q);
        const baselineQ = Float32Array.from(result.counterfactual.q);
        const frames = Uint8Array.from(result.depthFrames);

        post(
          {
            type: "storm",
            jobId,
            depthMm: outcome.depthMm,
            returnPeriodDays: outcome.returnPeriodDays,
            q: q.buffer,
            baselineQ: baselineQ.buffer,
            depthFrames: frames.buffer,
            frameCount: result.frameCount,
            depthScaleM: result.depthScaleM,
            stepSeconds: result.stepSeconds,
            peakQ: result.withFeatures.peakQ,
            baselinePeakQ: result.counterfactual.peakQ,
            tPeakSeconds: result.withFeatures.tPeakSeconds,
            baselineTPeakSeconds: result.counterfactual.tPeakSeconds,
          },
          [q.buffer, baselineQ.buffer, frames.buffer],
        );
        break;
      }

      case "release":
        handleRelease(request.buffers);
        break;

      default: {
        // Exhaustiveness guard: adding a request type without a handler is a
        // compile error rather than a message that silently does nothing.
        const unhandled: never = request;
        throw new Error(`Unhandled request: ${JSON.stringify(unhandled)}`);
      }
    }
  } catch (error: unknown) {
    if (request.type === "release") throw error;
    post({
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
