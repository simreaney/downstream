/**
 * Overlay cycling and buffer recycling.
 *
 * The recycling half is the part worth testing. Releasing a buffer transfers it
 * to the worker and detaches it here, so releasing one the texture still points
 * at would leave the risk map rendering from zero-length memory — a failure that
 * shows up as a blank overlay with no error anywhere.
 */

import { describe, expect, it, vi } from "vitest";
import { createOverlayControl, LAYER_CYCLE } from "../../src/game/overlayControl";
import type { SimClient } from "../../src/worker/client";

function fakeSim() {
  const released: ArrayBuffer[] = [];
  let packed = 0;

  const sim = {
    setLayer: vi.fn(async () => ({
      overlay: new Uint8Array(new ArrayBuffer(16)).fill(++packed),
      reachRisk: new Float32Array(0),
      metrics: {
        meanSourceRisk: 0,
        inChannelAtOutlet: 0,
        meanConnectivity: 0,
        woodlandFraction: 0,
      },
    })),
    release: vi.fn((buffer: ArrayBuffer) => released.push(buffer)),
  } as unknown as SimClient;

  return { sim, released };
}

function harness() {
  const { sim, released } = fakeSim();
  const layers: string[] = [];
  let mix = -1;
  let uploaded: Uint8Array | null = null;

  const control = createOverlayControl({
    sim,
    setMix: (value) => {
      mix = value;
    },
    setOverlay: (rgba) => {
      uploaded = rgba;
    },
    onLayerChange: (layer) => layers.push(layer),
  });

  return {
    control,
    layers,
    released,
    sim,
    get mix() {
      return mix;
    },
    get uploaded() {
      return uploaded;
    },
  };
}

describe("createOverlayControl", () => {
  it("starts hidden with the mix at zero", () => {
    const { control, mix } = harness();
    expect(control.layer).toBe("none");
    expect(mix).toBe(0);
  });

  it("cycles the layers in order and wraps", async () => {
    const h = harness();

    // The control deliberately swallows presses while a change is resolving, so
    // each one has to be allowed to settle — a macrotask, which drains the
    // promise chain including its `finally`.
    const settle = () => new Promise((done) => setTimeout(done, 0));

    for (let i = 0; i < LAYER_CYCLE.length + 1; i++) {
      h.control.next();
      await settle();
      expect(h.control.layer).toBe(LAYER_CYCLE[i % LAYER_CYCLE.length]);
    }
    expect(h.layers).toEqual([...LAYER_CYCLE, LAYER_CYCLE[0]]);
  });

  it("ignores presses while a layer change is still resolving", () => {
    const h = harness();
    h.control.next();
    h.control.next();
    h.control.next();
    // Only the first press reaches the worker; the rest would repack layers the
    // player never sees.
    expect(h.sim.setLayer).toHaveBeenCalledTimes(1);
  });

  it("releases the previous buffer only after the new one is uploaded", async () => {
    const h = harness();
    const first = new Uint8Array(new ArrayBuffer(16));
    h.control.adopt(first);

    // Nothing to recycle on the first adopt.
    expect(h.released).toHaveLength(0);
    expect(h.uploaded).toBe(first);

    const second = new Uint8Array(new ArrayBuffer(16));
    h.control.adopt(second);

    expect(h.uploaded).toBe(second);
    expect(h.released).toEqual([first.buffer]);
  });

  it("never releases a buffer it is still displaying", () => {
    const h = harness();
    const only = new Uint8Array(new ArrayBuffer(16));
    h.control.adopt(only);
    h.control.adopt(only);
    expect(h.released).toHaveLength(0);
  });

  it("fades in rather than snapping, and settles exactly on target", async () => {
    const h = harness();
    h.control.next();
    await vi.waitFor(() => expect(h.control.layer).toBe(LAYER_CYCLE[0]));

    h.control.update(0.016);
    const partway = h.mix;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(0.88);

    for (let i = 0; i < 120; i++) h.control.update(0.016);
    expect(h.mix).toBe(0.88);
  });

  it("fades back out on N without a worker round trip", () => {
    const h = harness();
    h.control.off();
    expect(h.sim.setLayer).not.toHaveBeenCalled();

    h.control.adopt(new Uint8Array(new ArrayBuffer(16)));
    h.control.off();
    for (let i = 0; i < 200; i++) h.control.update(0.016);
    expect(h.mix).toBe(0);
    expect(h.control.layer).toBe("none");
  });
});
