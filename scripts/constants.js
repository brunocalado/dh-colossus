/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/** @type {string} Single source of truth for the module id. */
export const MODULE_ID = "dh-colossus";

/** @type {string} Base path for this module's Handlebars templates. */
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;

/** Full template paths, keyed by the application that owns each one. */
export const TEMPLATES = {
  colossusHudDialog:   `${TEMPLATE_PATH}/colossus-hud-dialog.hbs`,
  colossusLinksEditor: `${TEMPLATE_PATH}/colossus-links-editor.hbs`,
  colossusLinksViewer: `${TEMPLATE_PATH}/colossus-links-viewer.hbs`,
  colossusManager:     `${TEMPLATE_PATH}/colossus-manager.hbs`,
  colossusSheet:       `${TEMPLATE_PATH}/colossus-sheet.hbs`,
  partTypeConfig:      `${TEMPLATE_PATH}/part-type-config.hbs`,
};

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
