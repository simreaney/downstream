/**
 * Save round-tripping.
 *
 * The property that matters is that a save carries *only* a seed and an ordered
 * list of interventions — everything else is re-derived. So these check the
 * round trip is exact, that the codes stay small enough for a URL, and that a
 * corrupt or future code fails loudly rather than loading a half-world.
 */

import { describe, expect, it } from "vitest";
import {
  SAVE_VERSION,
  deserialise,
  serialise,
  type SaveData,
} from "../../src/game/save";
import type { Intervention } from "../../src/game/interventions";

function save(overrides: Partial<SaveData> = {}): SaveData {
  return {
    version: SAVE_VERSION,
    seed: 20260809,
    elapsedSeconds: 742,
    wood: 17,
    stone: 4,
    hasSpade: true,
    collected: [3, 9, 14, 88],
    interventions: [
      { kind: "tree", id: 1, cell: 1234, at: 12 },
      { kind: "pond", id: 2, cell: 5678, at: 40 },
      { kind: "dam", id: 3, cell: 9012, at: 95 },
    ],
    ...overrides,
  };
}

describe("save round trip", () => {
  it("restores every field exactly", async () => {
    const original = save();
    const restored = await deserialise(await serialise(original));

    expect(restored.seed).toBe(original.seed);
    expect(restored.wood).toBe(original.wood);
    expect(restored.stone).toBe(original.stone);
    expect(restored.hasSpade).toBe(original.hasSpade);
    expect(restored.elapsedSeconds).toBe(original.elapsedSeconds);
    expect(restored.collected).toEqual(original.collected);
  });

  it("preserves intervention kind, cell and order", async () => {
    const original = save();
    const restored = await deserialise(await serialise(original));

    expect(restored.interventions).toHaveLength(3);
    restored.interventions.forEach((feature, index) => {
      expect(feature.kind).toBe(original.interventions[index].kind);
      expect(feature.cell).toBe(original.interventions[index].cell);
      expect(feature.at).toBe(original.interventions[index].at);
    });
  });

  it("keeps a well-developed catchment inside a URL", async () => {
    // Replaying is the only way state is restored, so a long session means a
    // long list — and it still has to fit in a link.
    const interventions: Intervention[] = [];
    for (let i = 0; i < 250; i++) {
      interventions.push({
        kind: i % 7 === 0 ? "pond" : i % 5 === 0 ? "dam" : "tree",
        id: i + 1,
        cell: (i * 313) % 65536,
        at: i * 4,
      });
    }

    const code = await serialise(save({ interventions }));
    expect(code.length).toBeLessThan(4000);

    const restored = await deserialise(code);
    expect(restored.interventions).toHaveLength(250);
    expect(restored.interventions[249].cell).toBe(interventions[249].cell);
  });

  it("survives an empty catchment", async () => {
    const restored = await deserialise(
      await serialise(save({ interventions: [], collected: [] })),
    );
    expect(restored.interventions).toEqual([]);
    expect(restored.collected).toEqual([]);
  });

  it("produces URL-safe codes", async () => {
    const code = await serialise(save());
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a code from a newer version rather than loading it partly", async () => {
    const future = await serialise(save({ version: SAVE_VERSION + 1 }));
    await expect(deserialise(future)).rejects.toThrow(/newer version/);
  });

  it("rejects rubbish", async () => {
    await expect(deserialise("not-a-code")).rejects.toThrow();
  });
});
