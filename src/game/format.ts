/**
 * Formatting shared by the placement readout and the build messages, so the
 * two never describe the same area in different units.
 */

/** An area in square metres, as m² below a hectare and hectares above. */
export function formatArea(m2: number): string {
  const hectares = m2 / 10_000;
  return hectares >= 1 ? `${hectares.toFixed(1)} ha` : `${Math.round(m2)} m²`;
}
