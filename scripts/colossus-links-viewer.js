/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES } from "./constants.js";
import { buildHpPips, buildStressPips } from "./colossus-utils.js";

/**
 * Returns the SVG absolute coordinates of a named anchor on a node.
 * Node dimensions are fixed at 80×80. Anchor positions:
 *   top:    centre-top    (40,  0)
 *   right:  centre-right  (80, 40)
 *   bottom: centre-bottom (40, 80)
 *   left:   centre-left   (0,  40)
 *
 * @param {{ x: number, y: number }} nodePos - Top-left corner of the node in SVG coords.
 * @param {"top"|"right"|"bottom"|"left"} side
 * @returns {{ x: number, y: number }}
 */
function anchorPoint(nodePos, side) {
  const offsets = {
    top:    { x: 40, y: 0  },
    right:  { x: 80, y: 40 },
    bottom: { x: 40, y: 80 },
    left:   { x: 0,  y: 40 },
  };
  const off = offsets[side] ?? offsets.right;
  return { x: nodePos.x + off.x, y: nodePos.y + off.y };
}

/**
 * Read-only SVG viewer for Colossus part links.
 * Opened on all player clients via socket broadcast from the GM.
 * Players cannot move nodes, create or delete links.
 */
export class ColossusLinksViewer extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  /**
   * @param {string} colossusId - The ID key inside the colossi world setting.
   * @param {object} [options={}]
   */
  constructor(colossusId, options = {}) {
    super({ ...options, colossusId });
    this.colossusId = colossusId;
  }

  /**
   * Gives each viewer a stable per-colossus application ID (see ColossusSheet's
   * `_initializeApplicationOptions` for why this can't be a plain `id` getter override).
   * @param {object} options
   * @returns {ApplicationConfiguration}
   */
  _initializeApplicationOptions(options) {
    const applicationOptions = super._initializeApplicationOptions(options);
    applicationOptions.uniqueId = applicationOptions.colossusId;
    return applicationOptions;
  }

  static DEFAULT_OPTIONS = {
    id: "colossus-links-viewer-{id}",
    colossusId: null,
    classes: [MODULE_ID, "colossus-links", "colossus-links-viewer"],
    window: { title: "Colossus Structure", icon: "fas fa-project-diagram", resizable: true },
    position: { width: 900, height: 650 },
    actions: {}
  };

  static PARTS = {
    sheet: { template: TEMPLATES.colossusLinksViewer }
  };

  /**
   * Resolves part actors and builds node data for the read-only SVG viewer.
   * Called during AppV2 render lifecycle.
   * @returns {Promise<{ nodes: Array, backgroundImage: string, links: Array }>}
   */
  async _prepareContext() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const data = colossi[this.colossusId];
    if (!data) return { nodes: [], backgroundImage: "", links: [] };

    const nodePositions = data.nodePositions ?? {};

    const nodes = (data.parts ?? [])
      .map(part => {
        const actor = fromUuidSync(part.actorUuid);
        if (!actor) return null;
        const pos = nodePositions[part.partId] ?? { x: 0, y: 0 };
        return {
          partId: part.partId,
          actorImg: actor.img ?? "icons/svg/mystery-man.svg",
          actorName: actor.name,
          x: pos.x,
          y: pos.y,
          status: part.status ?? "healthy",
          hpPips: buildHpPips(actor)
        };
      })
      .filter(Boolean);

    // --- Main Actor node ---
    // The principal actor is tracked in colossus data but not part of the parts array.
    // Its position is read from nodePositions using the reserved __main__ key.
    let mainActorNode = null;
    if (data.principalActorUuid) {
      const mainActor = fromUuidSync(data.principalActorUuid);
      if (mainActor) {
        const MAIN_ACTOR_KEY = "__main__";
        const pos = (data.nodePositions ?? {})[MAIN_ACTOR_KEY] ?? { x: 780, y: 20 };
        mainActorNode = {
          partId: MAIN_ACTOR_KEY,
          actorImg: mainActor.img ?? "icons/svg/mystery-man.svg",
          actorName: mainActor.name,
          x: pos.x,
          y: pos.y,
          stressPips: buildStressPips(mainActor)
        };
      }
    }

    const showStats = game.user.isGM || game.settings.get(MODULE_ID, "showStatsToPlayers");

    return {
      nodes,
      mainActorNode,
      backgroundImage: data.linksBackgroundImage ?? "",
      links: data.links ?? [],
      showStats,
      // showHpBar alias keeps existing {{#if ../showHpBar}} blocks in the nodes loop working
      showHpBar: showStats
    };
  }

  /**
   * Sets up SVG sizing and draws connection lines after each render.
   * Triggered by the AppV2 _onRender lifecycle stage.
   * @param {object} context - The prepared render context.
   * @param {object} options - Render options.
   */
  _onRender(context, options) {
    const svg = this.element.querySelector(".links-svg");
    if (!svg) return;

    // Defer sizing until after browser paint
    requestAnimationFrame(() => {
      const wrapper = svg.closest(".links-viewer-wrapper");
      const rect = wrapper?.getBoundingClientRect() ?? { width: 880, height: 620 };
      svg.setAttribute("width", rect.width);
      svg.setAttribute("height", rect.height);
      svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);

      // Fit background image
      const bgImg = svg.querySelector(".links-bg-image");
      if (bgImg) {
        bgImg.setAttribute("width", rect.width);
        bgImg.setAttribute("height", rect.height);
      }

      // Draw links by reading node positions from SVG transforms
      const layer = svg.querySelector(".links-layer");
      if (!layer) return;
      const nodePositions = {};
      svg.querySelectorAll(".node").forEach(n => {
        const partId = n.dataset.partId;
        const transform = n.getAttribute("transform") ?? "translate(0,0)";
        const match = transform.match(/translate\(([\d.-]+),([\d.-]+)\)/);
        if (match) nodePositions[partId] = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
      });

      for (const link of (context.links ?? [])) {
        const fromPos = nodePositions[link.from];
        const toPos   = nodePositions[link.to];
        if (!fromPos || !toPos) continue;

        const p1 = anchorPoint(fromPos, link.fromSide ?? "right");
        const p2 = anchorPoint(toPos,   link.toSide   ?? "left");

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", p1.x);
        line.setAttribute("y1", p1.y);
        line.setAttribute("x2", p2.x);
        line.setAttribute("y2", p2.y);
        line.classList.add("part-link");
        layer.appendChild(line);
      }
    });
  }

  /**
   * Opens the viewer for a given colossus, or brings it to front if already open.
   * Used by the socket listener and the GM's "Show Players" button.
   * @param {string} colossusId
   */
  static open(colossusId) {
    const existing = foundry.applications.instances.get(`colossus-links-viewer-${colossusId}`);
    if (existing) return existing.bringToFront();
    new ColossusLinksViewer(colossusId).render(true);
  }
}
