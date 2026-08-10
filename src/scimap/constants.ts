/**
 * SCIMAP parameters and land-cover weight tables.
 *
 * Values are taken from the author's own scimap-app `config.yaml` rather than
 * from the published erodibility figures in the SCIMAP FAQ. The two differ, and
 * the difference is worth recording because it changes how the game plays.
 *
 * The published `pe_i` are Woodland 0.00, Heath 0.05, Grassland 0.10, Improved
 * Grassland 0.20, Arable 1.00, Urban 0.00 — relative erodibilities with arable
 * as the reference. The shipping application uses the softer table below, in
 * which woodland is 0.2 rather than zero.
 *
 * Consequence, by design: planting a field takes it from 1.0 to 0.2, a fivefold
 * reduction but not an erasure. Trees alone cannot drive the catchment to a
 * perfect score. The remaining risk has to be addressed on the pathway side —
 * continuous riparian buffers and attenuation ponds breaking hydrological
 * connectivity — which is precisely the lesson the three tools exist to teach.
 *
 * The two tables below hold identical values today. They are kept separate
 * because they answer different questions: erodibility is how much material a
 * surface yields, runoff generation is how much water it sheds. Urban land is
 * the case that proves they are not the same concept, and if either table is
 * ever retuned it must be retuned alone.
 */

/** SCIMAP land-cover classes, matching the class IDs used in `config.yaml`. */
export enum LandCover {
  Woodland = 1,
  Arable = 2,
  ImprovedGrassland = 3,
  ExtensiveGrassland = 4,
  Moorland = 5,
  Urban = 6,
  Water = 7,
}

/**
 * Relative erodibility, driving the source term of the risk map.
 *
 * NOTE, and it matters for the game: **Woodland (0.2) is more erodible than
 * Extensive Grassland (0.15) in this table.** Planting trees on rough grazing
 * therefore makes modelled erosion risk slightly *worse*, not better. That is
 * what the shipping application's numbers say, and it is not obviously wrong —
 * establishing woodland disturbs ground that permanent rough pasture holds
 * together — but it runs against the premise a player brings to a tree-planting
 * game.
 *
 * The game does not hide this. Planting is allowed everywhere it is physically
 * sensible and the risk overlay reports the consequence honestly, which is the
 * whole reason the overlay is always available. See `isWorthPlanting` in
 * `landcover.ts` for how the build UI warns without forbidding.
 */
export const EROSION_WEIGHTS: Readonly<Record<LandCover, number>> = {
  [LandCover.Woodland]: 0.2,
  [LandCover.Arable]: 1.0,
  [LandCover.ImprovedGrassland]: 0.3,
  [LandCover.ExtensiveGrassland]: 0.15,
  [LandCover.Moorland]: 0.3,
  [LandCover.Urban]: 0.5,
  [LandCover.Water]: 0.5,
};

/** Relative runoff generation, driving the storm model. Not erodibility. */
export const RUNOFF_WEIGHTS: Readonly<Record<LandCover, number>> = {
  [LandCover.Woodland]: 0.2,
  [LandCover.Arable]: 1.0,
  [LandCover.ImprovedGrassland]: 0.3,
  [LandCover.ExtensiveGrassland]: 0.15,
  [LandCover.Moorland]: 0.3,
  [LandCover.Urban]: 0.5,
  [LandCover.Water]: 0.5,
};

/**
 * Holmgren FD8 flow-partition exponent.
 *
 * Held at exactly 2.0 because the reference implementation specifies it. The
 * contour lengths it multiplies are a documented approximation (see
 * `N8_CONTOUR` in core/grid.ts), so the pipeline claims behavioural parity with
 * the QGIS plugin, never bit-parity.
 */
export const FD8_EXPONENT = 2.0;

/**
 * Contributing area, in square metres, at which a channel begins.
 *
 * Expressed as an area rather than a cell count on purpose. The reference
 * sediment tool hardcodes 250 *cells*, which only means a fixed catchment size
 * for one particular resolution — at our 4 m cells it would put channel heads at
 * 0.4 ha, roughly four times denser than real channel initiation, and produce a
 * catchment that is a tenth river by area.
 *
 * 1.6 ha sits in the usual observed range for channel initiation on soft
 * lowland terrain and yields about 2.5% channel cells here, which reads as a
 * river network rather than a marsh.
 */
export const CHANNEL_THRESHOLD_M2 = 16_000;

/** Channel threshold in cells for a given cell size. */
export function channelThresholdCells(cellSize: number): number {
  return Math.max(1, CHANNEL_THRESHOLD_M2 / (cellSize * cellSize));
}

/** Percentile endpoints for the stretch applied to erosion and connectivity. */
export const STRETCH_LOW = 5;
export const STRETCH_HIGH = 95;
