/**
 * What the player is carrying.
 *
 * Wood and stone are the pacing mechanism: they stop the catchment being
 * carpeted in the first minute and force the player to choose which places are
 * worth the material — which is the whole point of having a risk map.
 *
 * The spade is a hard gate rather than a cost. Ponds are the most effective
 * single intervention, so finding the spade is the moment the game opens up, and
 * that reads better as a discovery than as a price.
 */

export interface InventoryState {
  readonly wood: number;
  readonly stone: number;
  readonly hasSpade: boolean;
}

export interface Inventory extends InventoryState {
  /** Deduct if affordable. Returns false and changes nothing otherwise. */
  spend(wood: number, stone: number): boolean;
  refund(wood: number, stone: number): void;
  gain(wood: number, stone: number): void;
  giveSpade(): void;
  subscribe(listener: (state: InventoryState) => void): () => void;
}

export function createInventory(initial: Partial<InventoryState> = {}): Inventory {
  let wood = initial.wood ?? 0;
  let stone = initial.stone ?? 0;
  let hasSpade = initial.hasSpade ?? false;

  const listeners = new Set<(state: InventoryState) => void>();
  const notify = (): void => {
    const snapshot: InventoryState = { wood, stone, hasSpade };
    for (const listener of listeners) listener(snapshot);
  };

  return {
    get wood() {
      return wood;
    },
    get stone() {
      return stone;
    },
    get hasSpade() {
      return hasSpade;
    },

    spend(costWood, costStone) {
      // All-or-nothing, so a partial deduction can never leave the player short
      // after a placement that was then refused for a different reason.
      if (wood < costWood || stone < costStone) return false;
      wood -= costWood;
      stone -= costStone;
      notify();
      return true;
    },

    refund(gainWood, gainStone) {
      wood += gainWood;
      stone += gainStone;
      notify();
    },

    gain(gainWood, gainStone) {
      wood += gainWood;
      stone += gainStone;
      notify();
    },

    giveSpade() {
      if (hasSpade) return;
      hasSpade = true;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener({ wood, stone, hasSpade });
      return () => listeners.delete(listener);
    },
  };
}
