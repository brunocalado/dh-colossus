/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, DEFAULT_PART_TYPES, TEMPLATES } from "./constants.js";
import { PartTypeConfig } from "./part-type-config.js";
import { ColossusManager } from "./colossus-manager.js";
import { ColossusSheet } from "./colossus-sheet.js";
import { ColossusLinksEditor } from "./colossus-links-editor.js";
import { ColossusLinksViewer } from "./colossus-links-viewer.js";
import { ColossusHud } from "./colossus-hud.js";

// Prevents re-entrant stress sync loops when propagating stress.value changes.
let syncingStress = false;

/* ---------------------------------------- */
/*  Colossus Group Placement                */
/* ---------------------------------------- */

/**
 * Creates tokens for the principal actor and all colossus parts on the active scene.
 * Tokens are arranged in a grid starting from the drop position, left-to-right,
 * with one empty-cell gap between each token to avoid overlap.
 *
 * Layout strategy: actors are packed into rows of COLS slots, each slot spaced
 * `step` cells apart. The drop cell becomes the top-left of the first token.
 *
 * @param {string} colossusId - The colossus world-setting ID.
 * @param {number} dropX - Canvas X coordinate where the user dropped.
 * @param {number} dropY - Canvas Y coordinate where the user dropped.
 * @returns {Promise<void>}
 */
async function placeColossusGroup(colossusId, dropX, dropY) {
  const colossi = game.settings.get(MODULE_ID, "colossi");
  const colossus = colossi[colossusId];
  if (!colossus) return;

  const scene = canvas.scene;
  if (!scene) return;

  const COLS = 4; // max tokens per row
  const GAP  = 1; // empty cells between each token slot

  // Snap the drop point to the nearest grid cell origin
  const dropOffset = canvas.grid.getOffset({ x: dropX, y: dropY });

  /**
   * Converts a (col, row) slot index to pixel top-left coordinates using v13 API.
   * canvas.grid.getTopLeftPoint replaces the removed getPixelsFromGridPosition.
   * @param {number} col - Column slot index (0-based).
   * @param {number} row - Row slot index (0-based).
   * @returns {{ x: number, y: number }}
   */
  const gridToPixel = (col, row) => {
    const step = 1 + GAP;
    return canvas.grid.getTopLeftPoint({ i: dropOffset.i + row * step, j: dropOffset.j + col * step });
  };

  // Collect all actor UUIDs: principal first, then parts in order
  const allEntries = [];
  if (colossus.principalActorUuid) {
    allEntries.push(colossus.principalActorUuid);
  }
  for (const part of (colossus.parts ?? [])) {
    allEntries.push(part.actorUuid);
  }

  const tokenDataArray = [];

  // Actors not found (deleted) are skipped; their slot index still advances,
  // leaving a visible gap in the grid rather than shifting tokens unpredictably.
  for (let idx = 0; idx < allEntries.length; idx++) {
    const uuid = allEntries[idx];
    const actor = fromUuidSync(uuid);
    if (!actor) continue;

    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const { x, y } = gridToPixel(col, row);

    // getTokenDocument merges prototype token defaults (texture, size, etc.) with overrides
    const tokenDoc = await actor.getTokenDocument({ x, y });
    const tokenData = tokenDoc.toObject();

    // Stamp the colossus flag so the token HUD button appears on all placed tokens
    tokenData.flags = foundry.utils.mergeObject(tokenData.flags ?? {}, {
      [MODULE_ID]: { colossusId }
    });

    tokenDataArray.push(tokenData);
  }

  if (!tokenDataArray.length) return;

  await scene.createEmbeddedDocuments("Token", tokenDataArray);
  ui.notifications.info(`Placed ${tokenDataArray.length} tokens for "${colossus.name ?? "Colossus"}".`);
}

/* ---------------------------------------- */
/*  Stress Sync Helper                      */
/* ---------------------------------------- */

/**
 * Returns the colossus data entry that contains the given actor UUID,
 * searching both principalActorUuid and parts[].actorUuid.
 * Returns null if the actor does not belong to any colossus.
 *
 * @param {string} actorUuid
 * @returns {{ colossusId: string, colossus: object } | null}
 */
function findColossusForActor(actorUuid) {
  const colossi = game.settings.get(MODULE_ID, "colossi");
  for (const [colossusId, colossus] of Object.entries(colossi)) {
    if (colossus.principalActorUuid === actorUuid) return { colossusId, colossus };
    if ((colossus.parts ?? []).some(p => p.actorUuid === actorUuid)) return { colossusId, colossus };
  }
  return null;
}

/**
 * Propagates a stress.value change from one colossus actor to all sibling actors
 * (principal + all parts) in the same colossus group.
 *
 * Uses syncingStress to break the re-entrant updateActor loop that would otherwise
 * fire again when we call actor.update() on each sibling.
 *
 * Actors are linked, so actorDoc.token is null — we identify the group by UUID
 * directly from the world settings instead.
 *
 * @param {Actor} actorDoc - The actor whose stress.value just changed.
 * @param {number} newStressValue - The new stress.value to propagate.
 * @returns {Promise<void>}
 */
async function syncStressToColossus(actorDoc, newStressValue) {
  const match = findColossusForActor(actorDoc.uuid);
  if (!match) return;

  const { colossus } = match;

  // Collect all actor UUIDs in this colossus except the one that just changed
  const siblingUuids = [];
  if (colossus.principalActorUuid && colossus.principalActorUuid !== actorDoc.uuid) {
    siblingUuids.push(colossus.principalActorUuid);
  }
  for (const part of (colossus.parts ?? [])) {
    if (part.actorUuid !== actorDoc.uuid) siblingUuids.push(part.actorUuid);
  }

  if (!siblingUuids.length) return;

  syncingStress = true;
  try {
    const updates = siblingUuids.map(uuid => {
      const sibling = fromUuidSync(uuid);
      if (!sibling) return null;
      return sibling.update({ "system.resources.stress.value": newStressValue });
    }).filter(Boolean);
    await Promise.all(updates);
  } finally {
    syncingStress = false;
  }
}

/* ---------------------------------------- */
/*  Init Hook — Settings & Menus            */
/* ---------------------------------------- */

/**
 * Registers world-scoped settings for part types and colossi data,
 * plus a settings menu entry for the PartTypeConfig UI.
 * Triggered once during Foundry's init phase.
 */
Hooks.once("init", () => {
  // Handlebars helpers for template conditionals
  Handlebars.registerHelper("includes", (array, value) => Array.isArray(array) && array.includes(value));
  Handlebars.registerHelper("eq", (a, b) => a === b);

  game.settings.register(MODULE_ID, "partTypes", {
    scope: "world",
    config: false,
    type: Array,
    default: DEFAULT_PART_TYPES
  });

  game.settings.register(MODULE_ID, "colossi", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "showStatsToPlayers", {
    name: "Show HP and Stress to Players",
    hint: "When enabled, non-GM players can see the HP pip bar on each part node and the Stress pip bar on the main actor node in the Colossus Links Viewer.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "partTypesMenu", {
    name: "Part Types",
    label: "Configure Part Types",
    hint: "Add, edit, or remove the available part types for Colossi.",
    icon: "fas fa-puzzle-piece",
    type: PartTypeConfig,
    restricted: true
  });
});

/* ---------------------------------------- */
/*  Ready Hook — API & Live-Update          */
/* ---------------------------------------- */

/**
 * Exposes the public API at globalThis.Colossus and registers the
 * updateActor hook for live-updating open ColossusSheet windows.
 * Triggered once when Foundry is fully ready.
 */
Hooks.once("ready", async () => {
  // Preload HUD dialog template (mirrors dh-horde pattern)
  await foundry.applications.handlebars.loadTemplates([
    TEMPLATES.colossusHudDialog
  ]);

  // Inject Colossus button into Token HUD (GM only) and player inspect icon
  ColossusHud.init();
  ColossusHud.initPlayerIcon();

  globalThis.Colossus = {
    /** Opens the ColossusManager window. */
    Manager: () => new ColossusManager().render(true),

    /**
     * Opens a ColossusSheet by its stored ID, or brings it to front if already open.
     * @param {string} id - The colossus ID stored in world settings.
     */
    Open: (id) => {
      const colossi = game.settings.get(MODULE_ID, "colossi");
      if (!colossi[id]) {
        ui.notifications.warn(`No Colossus found with ID: ${id}`);
        return;
      }
      const existing = foundry.applications.instances.get(`colossus-sheet-${id}`);
      if (existing) return existing.bringToFront();
      new ColossusSheet(id).render(true);
    }
  };

  /**
   * Re-renders any open ColossusSheet whose parts include the updated actor.
   * Also propagates stress.value changes to all sibling actors in the same colossus.
   * Keeps HP/Stress/Features in sync without manual refresh.
   */
  Hooks.on("updateActor", (actor, diff) => {
    // Propagate stress.value to all siblings in the same colossus (GM only, no re-entrancy)
    if (game.user.isGM && !syncingStress) {
      const newStress = diff?.system?.resources?.stress?.value;
      if (newStress !== undefined) {
        syncStressToColossus(actor, newStress);
      }
    }

    // Refresh pip UI on any open ColossusSheet that tracks this actor
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof ColossusSheet && app.getPartUuids().includes(actor.uuid)) {
        app.refreshPips(actor.uuid);
      }
      // Re-render links windows so the HP pip bar stays in sync
      if (
        (app instanceof ColossusLinksViewer || app instanceof ColossusLinksEditor)
        && typeof app.render === "function"
      ) {
        app.render();
      }
    }
  });

  /**
   * Intercepts canvas drops that carry the _isColossusGroup marker.
   * Cancels Foundry's default single-token creation and places the full colossus
   * group via placeColossusGroup. Returning false stops all further hook processing.
   * Only the GM can place tokens, matching Foundry's native drag-drop restriction.
   * Triggered by the dropCanvasData hook on every canvas drop event.
   */
  Hooks.on("dropCanvasData", (_canvasObj, data) => {
    if (!game.user.isGM) return true;
    if (data.type !== "Actor") return true;
    if (!data._isColossusGroup || !data._colossusId) return true;

    // data.x / data.y are the canvas pixel coordinates of the drop point in v13
    placeColossusGroup(data._colossusId, data.x, data.y);

    // Return false to cancel Foundry's default single-token creation
    return false;
  });

  /**
   * Stamps a dh-colossus.colossusId flag on any token being created via the
   * ColossusSheet drag-to-scene button. pendingColossusId is set on dragstart
   * and cleared immediately here to avoid contaminating subsequent drops.
   * Triggered by the preCreateToken hook before token persistence.
   */
  Hooks.on("preCreateToken", (tokenDoc, _data, _options, _userId) => {
    const colossusId = ColossusSheet.pendingColossusId;
    if (!colossusId) return;
    tokenDoc.updateSource({ [`flags.${MODULE_ID}.colossusId`]: colossusId });
    ColossusSheet.pendingColossusId = null;
  });

  // Socket: receive showLinks broadcast from GM → open viewer on player clients
  game.socket.on(`module.${MODULE_ID}`, (payload) => {
    if (payload?.action !== "showLinks") return;
    if (game.user.isGM) return;
    ColossusLinksViewer.open(payload.colossusId);
  });
});

/* ---------------------------------------- */
/*  Daggerheart Menu Integration            */
/* ---------------------------------------- */

/**
 * Injects a "Colossus Manager" button into the Daggerheart sidebar menu.
 * Uses a dedicated fieldset to group the button alongside native menu sections.
 * Triggered by the renderDaggerheartMenu hook provided by the Daggerheart system.
 * @param {ApplicationV2} _app - The DaggerheartMenu application instance (unused).
 * @param {HTMLElement} element - The rendered root HTML element.
 */
Hooks.on("renderDaggerheartMenu", (_app, element) => {
  const html = element instanceof HTMLElement ? element : element[0];

  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `<i class="fas fa-dragon"></i> Colossus Manager`;
  button.classList.add("dh-custom-btn");
  button.style.marginTop = "5px";
  button.style.width = "100%";

  // Opens the manager or warns if the module API is not yet available.
  button.onclick = () => {
    if (globalThis.Colossus) {
      globalThis.Colossus.Manager();
    } else {
      ui.notifications.error("Colossus module not fully initialized.");
    }
  };

  const fieldset = html.querySelector("fieldset");
  if (fieldset) {
    const newFieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.innerText = "Colossus";
    newFieldset.appendChild(legend);
    newFieldset.appendChild(button);
    fieldset.after(newFieldset);
  } else {
    html.appendChild(button);
  }
});
