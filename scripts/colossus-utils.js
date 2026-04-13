/**
 * Builds an array of pip render data for a node's HP bar.
 * The bar occupies x=[2..78] at y=2, height=5, inside an 80px-wide node.
 *
 * @param {Actor} actor - The Daggerheart actor document.
 * @returns {{ filled: boolean, x: number, width: number }[]}
 */
export function buildHpPips(actor) {
  const hp = actor?.system?.resources?.hitPoints;
  if (!hp || typeof hp.max !== "number" || hp.max <= 0) return [];
  const max   = hp.max;
  const value = Math.max(0, Math.min(hp.value ?? 0, max));
  const total = 76;          // usable px width (2px margin each side)
  const gap   = 1;
  const pipW  = Math.max(2, Math.floor((total - gap * (max - 1)) / max));
  const pips  = [];
  for (let i = 0; i < max; i++) {
    pips.push({
      filled: i < value,
      x: 2 + i * (pipW + gap),
      width: pipW
    });
  }
  return pips;
}

/**
 * Builds an array of pip render data for a node's Stress bar.
 * Same geometry as HP pips: bar occupies x=[2..78] at y=75, height=5,
 * inside an 80px-wide node (placed at the bottom of the node).
 *
 * @param {Actor} actor - The Daggerheart actor document.
 * @returns {{ filled: boolean, x: number, width: number }[]}
 */
export function buildStressPips(actor) {
  const stress = actor?.system?.resources?.stress;
  if (!stress || typeof stress.max !== "number" || stress.max <= 0) return [];
  const max   = stress.max;
  const value = Math.max(0, Math.min(stress.value ?? 0, max));
  const total = 76;
  const gap   = 1;
  const pipW  = Math.max(2, Math.floor((total - gap * (max - 1)) / max));
  const pips  = [];
  for (let i = 0; i < max; i++) {
    pips.push({
      filled: i < value,
      x: 2 + i * (pipW + gap),
      width: pipW
    });
  }
  return pips;
}
