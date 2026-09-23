/**
 * The worker client's queueing and failure paths, against a fake Worker.
 *
 * These are the paths that hang a game rather than break it: a request whose
 * promise never settles leaves the main thread's "one at a time" flags set
 * forever, and every build, undo and storm after it silently does nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSimClient } from "../../src/worker/client";
import type { SimRequest } from "../../src/worker/protocol";

/** The requests that carry a job id — everything except buffer releases. */
type JobRequest = Extract<SimRequest, { jobId: number }>;

/** Records what the client posts, and lets a test answer or fail it. */
class FakeWorker {
  static last: FakeWorker;
  posted: SimRequest[] = [];
  throwOnPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: SimRequest): void {
    if (this.throwOnPost) throw new Error("DataCloneError");
    this.posted.push(message);
  }

  terminate(): void {}

  /** Answer a recompute request with a small, recognisable result. */
  answerRecompute(request: JobRequest, marker: number): void {
    this.onmessage?.({
      data: {
        type: "recomputed",
        jobId: request.jobId,
        overlay: new ArrayBuffer(4),
        reachRisk: new Float32Array([marker]).buffer,
        metrics: {},
      },
    } as MessageEvent);
  }
}

const recomputes = (worker: FakeWorker): JobRequest[] =>
  worker.posted.filter((request): request is JobRequest => request.type === "recompute");

/** Let pending promise callbacks run. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe("createSimClient", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers every superseded recompute with the newest state", async () => {
    const client = createSimClient();
    const worker = FakeWorker.last;

    const first = client.recompute("sourceRisk", [], []);
    const second = client.recompute("sourceRisk", [{ cell: 1, capacityCells: 1 }], []);
    const third = client.recompute("sourceRisk", [{ cell: 2, capacityCells: 1 }], []);

    // One in flight; the other two collapse into a single queued request that
    // carries the newest state.
    expect(recomputes(worker)).toHaveLength(1);
    worker.answerRecompute(recomputes(worker)[0], 1);
    expect((await first).reachRisk[0]).toBe(1);

    await settle();
    expect(recomputes(worker)).toHaveLength(2);
    const queued = recomputes(worker)[1];
    expect(queued.type === "recompute" && queued.breaks[0].cell).toBe(2);

    worker.answerRecompute(queued, 3);
    expect((await second).reachRisk[0]).toBe(3);
    expect((await third).reachRisk[0]).toBe(3);
  });

  it("rejects everything outstanding, and everything after, once the worker dies", async () => {
    const client = createSimClient();
    const worker = FakeWorker.last;

    const inFlight = client.recompute("sourceRisk", [], []);
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    await expect(inFlight).rejects.toThrow(/boom/);

    // Later requests must not post into the dead worker and wait forever.
    await expect(client.setLayer("erosion")).rejects.toThrow(/boom/);
    await expect(client.recompute("sourceRisk", [], [])).rejects.toThrow(/boom/);
  });

  it("settles a request the worker never received", async () => {
    const client = createSimClient();
    FakeWorker.last.throwOnPost = true;
    await expect(client.setLayer("erosion")).rejects.toThrow(/DataCloneError/);
  });

  it("keeps working after a recompute fails", async () => {
    const client = createSimClient();
    const worker = FakeWorker.last;

    const failed = client.recompute("sourceRisk", [], []);
    const request = recomputes(worker)[0];
    worker.onmessage?.({ data: { type: "error", jobId: request.jobId, message: "bad" } } as MessageEvent);
    await expect(failed).rejects.toThrow(/bad/);

    const next = client.recompute("sourceRisk", [], []);
    await settle();
    worker.answerRecompute(recomputes(worker)[1], 7);
    expect((await next).reachRisk[0]).toBe(7);
  });
});
