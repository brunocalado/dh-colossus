/** @type {string} Single source of truth for the module id. */
export const MODULE_ID = "dh-colossus";

/** Default part types shipped with the module. */
export const DEFAULT_PART_TYPES = [
  { id: "head",        label: "Head" },
  { id: "torso",       label: "Torso" },
  { id: "arm-left",    label: "Left Arm" },
  { id: "arm-right",   label: "Right Arm" },
  { id: "arms",        label: "Arms" },
  { id: "leg-left",    label: "Left Leg" },
  { id: "leg-right",   label: "Right Leg" },
  { id: "legs",        label: "Legs" },
  { id: "wing-left",   label: "Left Wing" },
  { id: "wing-right",  label: "Right Wing" },
  { id: "wings",       label: "Wings" },
  { id: "carapace",    label: "Carapace" }
];

/** IDs that ship with the module and cannot be deleted by the user. */
export const DEFAULT_PART_IDS = DEFAULT_PART_TYPES.map(p => p.id);
