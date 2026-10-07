/**
 * Formatting shared by the placement readout and the build messages, so the
 * two never describe the same area in different units.
 */

import { formatNumber } from "../i18n";

/**
 * An area in square metres, as m² below a hectare and hectares above.
 *
 * The decimal mark follows the language ("2,5 ha" in German), and the space
 * before the unit does not break, so a wrapped readout never strands "ha".
 */
export function formatArea(m2: number): string {
  const hectares = m2 / 10_000;
  return hectares >= 1 ? `${formatNumber(hectares, 1)}\u00a0ha` : `${formatNumber(Math.round(m2))}\u00a0m²`;
}
