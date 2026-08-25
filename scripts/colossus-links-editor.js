/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES } from "./constants.js";
import { ColossusLinksViewer } from "./colossus-links-viewer.js";
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
 * GM-only interactive SVG editor for Colossus part links.
 * Allows dragging part nodes and drawing connection lines between them.
 * Persists layout (nodePositions, links) and background image to the colossi world setting.
 */
export class ColossusLinksEditor extends foundry.applications.api.HandlebarsApplicationMixin(
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

  /** @type {string|null} partId being dragged, or null */
  #draggingPartId = null;

  /** @type {{ x: number, y: number }} offset from node origin to mouse-down point */
  #draggingOffset = { x: 0, y: 0 };

  /** @type {string|null} partId from which a new link is being drawn */
  #connectingFrom = null;

  /** @type {string|null} side ("top"|"right"|"bottom"|"left") from which the connection starts */
  #connectingFromSide = null;

  /** @type {Object<string, { x: number, y: number }>} live copy of node positions */
  #nodePositions = {};

  /** @type {Array<{ from: string, to: string }>} live copy of links */
  #links = [];

  /** @type {(() => void)|null} document-level mouseup handler that cancels an in-progress connection */
  #cancelConnect = null;

  /**
   * Gives each editor a stable per-colossus application ID (see ColossusSheet's
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
    id: "colossus-links-editor-{id}",
    colossusId: null,
    classes: [MODULE_ID, "colossus-links", "colossus-links-editor"],
    window: { title: "Part Links", icon: "fas fa-project-diagram", resizable: true },
    position: { width: 900, height: 650 },
    actions: {}
  };

  static PARTS = {
    sheet: { template: TEMPLATES.colossusLinksEditor }
  };

  /* ------------------------------------------------------------------ */
  /*  Data                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Resolves part actors and builds node data for the SVG editor.
   * Called during AppV2 render lifecycle.
   * @returns {Promise<{ nodes: Array, backgroundImage: string }>}
   */
  async _prepareContext() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const data = colossi[this.colossusId];
    if (!data) return { nodes: [], backgroundImage: "" };

    this.#nodePositions = foundry.utils.deepClone(data.nodePositions ?? {});
    this.#links = foundry.utils.deepClone(data.links ?? []);

    const nodes = (data.parts ?? [])
      .map(part => {
        const actor = fromUuidSync(part.actorUuid);
        if (!actor) return null;
        const pos = this.#nodePositions[part.partId];
        return {
          partId: part.partId,
          actorImg: actor.img ?? "icons/svg/mystery-man.svg",
          actorName: actor.name,
          x: pos?.x ?? 0,
          y: pos?.y ?? 0,
          status: part.status ?? "healthy",
          hpPips: buildHpPips(actor)
        };
      })
      .filter(Boolean);

    // --- Main Actor node ---
    // The principal actor is tracked in colossus data but not part of the parts array.
    // It gets a reserved __main__ key in #nodePositions so it can be dragged and persisted.
    let mainActorNode = null;
    if (data.principalActorUuid) {
      const mainActor = fromUuidSync(data.principalActorUuid);
      if (mainActor) {
        const MAIN_ACTOR_KEY = "__main__";
        if (!this.#nodePositions[MAIN_ACTOR_KEY]) {
          // Default position: top-right corner; JS will snap after SVG dimensions are known
          this.#nodePositions[MAIN_ACTOR_KEY] = { x: 780, y: 20 };
        }
        const pos = this.#nodePositions[MAIN_ACTOR_KEY];
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

    return {
      nodes,
      mainActorNode,
      backgroundImage: data.linksBackgroundImage ?? "",
      showStats: true
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Render Lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Binds all interactive event listeners after each render.
   * Triggered by the AppV2 _onRender lifecycle stage.
   * @param {object} context - The prepared render context.
   * @param {object} options - Render options.
   */
  _onRender(context, options) {
    if (!game.user.isGM) return;

    const svg = this.element.querySelector(".links-svg");
    if (!svg) return;

    // Defer SVG sizing until after browser paint to avoid 0-dimension reads
    requestAnimationFrame(() => {
      this.#fitSvg(svg);
      this.#redrawLinks(svg);
      this.#fitBackgroundImage(svg);
    });

    // Node drag
    svg.querySelectorAll(".node").forEach(node => {
      node.addEventListener("mousedown", (e) => this.#onNodeMouseDown(e, svg));
    });

    // Anchor click (start connection)
    svg.querySelectorAll(".link-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this.#onAnchorMouseDown(e, svg);
      });
    });

    // SVG-level mousemove / mouseup
    svg.addEventListener("mousemove", (e) => this.#onSvgMouseMove(e, svg));
    svg.addEventListener("mouseup", (e) => this.#onSvgMouseUp(e, svg));

    // Document-level mouseup to cancel connections started but released outside SVG
    if (this.#cancelConnect) document.removeEventListener("mouseup", this.#cancelConnect);
    this.#cancelConnect = () => {
      if (!this.#connectingFrom) return;
      const tempLine = svg.querySelector("#temp-link-line");
      if (tempLine) tempLine.style.display = "none";
      svg.classList.remove("is-connecting");
      this.#connectingFrom     = null;
      this.#connectingFromSide = null;
    };
    document.addEventListener("mouseup", this.#cancelConnect);

    // Toolbar buttons
    this.element.querySelector(".links-btn-config")
      ?.addEventListener("click", () => this.#onConfigBackground());

    this.element.querySelector(".links-btn-auto-layout")
      ?.addEventListener("click", () => this.#onAutoLayout(svg));

    this.element.querySelector(".links-btn-show-players")
      ?.addEventListener("click", () => this.#onShowPlayers());
  }

  /* ------------------------------------------------------------------ */
  /*  SVG Helpers                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Converts viewport (clientX/Y) coordinates to SVG local coordinates.
   * Uses SVG coordinate matrix transform — required for accurate positioning.
   * @param {SVGSVGElement} svg
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  #toSvgCoords(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: svgP.x, y: svgP.y };
  }

  /**
   * Stretches the SVG to fill its wrapper div, accounting for toolbar height.
   * @param {SVGSVGElement} svg
   */
  #fitSvg(svg) {
    const wrapper = svg.closest(".links-editor-wrapper");
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const toolbarH = this.element.querySelector(".links-toolbar")?.offsetHeight ?? 0;
    const h = Math.max(200, rect.height - toolbarH - 8);
    svg.setAttribute("width", rect.width);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${h}`);
  }

  /**
   * Stretches the background <image> to fill the SVG viewBox.
   * @param {SVGSVGElement} svg
   */
  #fitBackgroundImage(svg) {
    const img = svg.querySelector(".links-bg-image");
    if (!img) return;
    img.setAttribute("width", svg.getAttribute("width") ?? "100%");
    img.setAttribute("height", svg.getAttribute("height") ?? "100%");
  }

  /**
   * Clears and redraws all persisted connection lines.
   * Called after any change to this.#links or this.#nodePositions.
   * @param {SVGSVGElement} svg
   */
  #redrawLinks(svg) {
    const layer = svg.querySelector(".links-layer");
    if (!layer) return;
    layer.innerHTML = "";

    for (const link of this.#links) {
      const fromPos = this.#nodePositions[link.from];
      const toPos   = this.#nodePositions[link.to];
      if (!fromPos || !toPos) continue;

      const p1 = anchorPoint(fromPos, link.fromSide ?? "right");
      const p2 = anchorPoint(toPos,   link.toSide   ?? "left");

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", p1.x);
      line.setAttribute("y1", p1.y);
      line.setAttribute("x2", p2.x);
      line.setAttribute("y2", p2.y);
      line.classList.add("part-link");
      line.dataset.from     = link.from;
      line.dataset.fromSide = link.fromSide ?? "right";
      line.dataset.to       = link.to;
      line.dataset.toSide   = link.toSide   ?? "left";
      line.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.#removeLink(link.from, link.fromSide, link.to, link.toSide, svg);
      });
      layer.appendChild(line);
    }
  }

  /**
   * Updates line endpoints for a specific node during drag, avoiding full redraw.
   * @param {SVGSVGElement} svg
   * @param {string} partId
   */
  #updateLinesForNode(svg, partId) {
    const pos = this.#nodePositions[partId];
    if (!pos) return;

    svg.querySelectorAll(`.part-link[data-from="${partId}"]`).forEach(line => {
      const side = line.dataset.fromSide ?? "right";
      const p = anchorPoint(pos, side);
      line.setAttribute("x1", p.x);
      line.setAttribute("y1", p.y);
    });

    svg.querySelectorAll(`.part-link[data-to="${partId}"]`).forEach(line => {
      const side = line.dataset.toSide ?? "left";
      const p = anchorPoint(pos, side);
      line.setAttribute("x2", p.x);
      line.setAttribute("y2", p.y);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Node Drag                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Initiates node dragging on left-click.
   * @param {MouseEvent} e
   * @param {SVGSVGElement} svg
   */
  #onNodeMouseDown(e, svg) {
    if (e.button !== 0) return;
    if (this.#connectingFrom) return;
    const node = e.currentTarget;
    const partId = node.dataset.partId;
    const svgPos = this.#toSvgCoords(svg, e.clientX, e.clientY);
    const nodePos = this.#nodePositions[partId] ?? { x: 0, y: 0 };
    this.#draggingPartId = partId;
    this.#draggingOffset = { x: svgPos.x - nodePos.x, y: svgPos.y - nodePos.y };
    e.preventDefault();
  }

  /* ------------------------------------------------------------------ */
  /*  Anchor / Connection Drawing                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Starts drawing a temporary connection line from a node anchor.
   * @param {MouseEvent} e
   * @param {SVGSVGElement} svg
   */
  #onAnchorMouseDown(e, svg) {
    if (e.button !== 0) return;
    const anchor = e.currentTarget;
    this.#connectingFrom     = anchor.dataset.partId;
    this.#connectingFromSide = anchor.dataset.side ?? "right";

    const fromPos  = this.#nodePositions[this.#connectingFrom];
    const tempLine = svg.querySelector("#temp-link-line");
    if (!fromPos || !tempLine) return;

    const origin = anchorPoint(fromPos, this.#connectingFromSide);
    tempLine.setAttribute("x1", origin.x);
    tempLine.setAttribute("y1", origin.y);
    tempLine.setAttribute("x2", origin.x);
    tempLine.setAttribute("y2", origin.y);
    tempLine.style.display = "";

    // Visual feedback: keep anchors visible during drag
    svg.classList.add("is-connecting");
    e.preventDefault();
  }

  /* ------------------------------------------------------------------ */
  /*  SVG Mouse Move / Up                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Handles mousemove on the SVG for both node dragging and connection drawing.
   * @param {MouseEvent} e
   * @param {SVGSVGElement} svg
   */
  #onSvgMouseMove(e, svg) {
    const svgPos = this.#toSvgCoords(svg, e.clientX, e.clientY);

    // Node dragging
    if (this.#draggingPartId) {
      const newX = svgPos.x - this.#draggingOffset.x;
      const newY = svgPos.y - this.#draggingOffset.y;
      this.#nodePositions[this.#draggingPartId] = { x: newX, y: newY };
      const node = svg.querySelector(`.node[data-part-id="${this.#draggingPartId}"]`);
      if (node) node.setAttribute("transform", `translate(${newX},${newY})`);
      this.#updateLinesForNode(svg, this.#draggingPartId);
    }

    // Connection drawing
    if (this.#connectingFrom) {
      const tempLine = svg.querySelector("#temp-link-line");
      if (tempLine) {
        tempLine.setAttribute("x2", svgPos.x);
        tempLine.setAttribute("y2", svgPos.y);
      }
    }
  }

  /**
   * Handles mouseup on the SVG — finalises node drag or connection drawing.
   * @param {MouseEvent} e
   * @param {SVGSVGElement} svg
   */
  #onSvgMouseUp(e, svg) {
    // Finish node drag — persist positions
    if (this.#draggingPartId) {
      this.#draggingPartId = null;
      this.#persistLayout();
    }

    // Finish connection drawing
    if (this.#connectingFrom) {
      const target   = document.elementFromPoint(e.clientX, e.clientY);
      const anchor   = target?.closest(".link-anchor");
      const toPartId = anchor?.dataset.partId;
      const toSide   = anchor?.dataset.side ?? "left";

      if (toPartId && toPartId !== this.#connectingFrom) {
        // Prevent any link involving the main actor node — it has no anchors by design
        if (toPartId === "__main__" || this.#connectingFrom === "__main__") return;

        // Allow multiple links between the same pair IF they use different side combinations
        const exists = this.#links.some(
          l => (l.from === this.#connectingFrom && l.fromSide === this.#connectingFromSide &&
                l.to   === toPartId            && l.toSide   === toSide) ||
               (l.from === toPartId            && l.fromSide === toSide &&
                l.to   === this.#connectingFrom && l.toSide  === this.#connectingFromSide)
        );
        if (!exists) {
          this.#links.push({
            from:     this.#connectingFrom,
            fromSide: this.#connectingFromSide,
            to:       toPartId,
            toSide:   toSide
          });
          this.#redrawLinks(svg);
          this.#persistLayout();
        }
      }

      const tempLine = svg.querySelector("#temp-link-line");
      if (tempLine) tempLine.style.display = "none";
      svg.classList.remove("is-connecting");
      this.#connectingFrom     = null;
      this.#connectingFromSide = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Link Removal                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Removes a specific directional link (matched by all 4 fields) and redraws.
   * @param {string} fromId
   * @param {string} fromSide
   * @param {string} toId
   * @param {string} toSide
   * @param {SVGSVGElement} svg
   */
  #removeLink(fromId, fromSide, toId, toSide, svg) {
    this.#links = this.#links.filter(l =>
      !(l.from === fromId && l.fromSide === fromSide &&
        l.to   === toId   && l.toSide   === toSide) &&
      !(l.from === toId   && l.fromSide === toSide &&
        l.to   === fromId && l.toSide   === fromSide)
    );
    this.#redrawLinks(svg);
    this.#persistLayout();
  }

  /* ------------------------------------------------------------------ */
  /*  Auto Layout                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Arranges all nodes in a grid starting at (40, 40), spaced 130px apart.
   * Capped at 6 columns. Overwrites existing positions.
   * @param {SVGSVGElement} svg
   */
  #onAutoLayout(svg) {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const parts = colossi[this.colossusId]?.parts ?? [];
    const cols = Math.min(6, Math.ceil(Math.sqrt(parts.length)));
    parts.forEach((part, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.#nodePositions[part.partId] = { x: 40 + col * 130, y: 40 + row * 130 };
    });
    this.#persistLayout().then(() => this.render());
  }

  /* ------------------------------------------------------------------ */
  /*  Background Image Config                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Opens a FilePicker for the GM to select a background image for the SVG canvas.
   * Uses the v13 namespaced API: foundry.applications.apps.FilePicker.
   */
  #onConfigBackground() {
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
    new FilePickerClass({
      type: "image",
      current: (() => {
        const c = game.settings.get(MODULE_ID, "colossi");
        return c[this.colossusId]?.linksBackgroundImage ?? "";
      })(),
      callback: async (path) => {
        const colossi = game.settings.get(MODULE_ID, "colossi");
        colossi[this.colossusId].linksBackgroundImage = path;
        await game.settings.set(MODULE_ID, "colossi", colossi);
        this.render();
      }
    }).render(true);
  }

  /* ------------------------------------------------------------------ */
  /*  Show to Players (Socket)                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Broadcasts the links diagram to all connected player clients via socket.
   * The GM's own client does NOT open the viewer — the editor remains the GM's view.
   * The socket listener in main.js already filters out GM clients with `if (game.user.isGM) return`.
   */
  #onShowPlayers() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const data = colossi[this.colossusId];
    if (!data) return;
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "showLinks",
      colossusId: this.colossusId
    });
    ui.notifications.info("Colossus links diagram sent to all players.");
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Removes the document-level mouseup listener to prevent memory leaks.
   * Triggered by the AppV2 close lifecycle.
   * @param {object} options
   */
  _onClose(options) {
    if (this.#cancelConnect) {
      document.removeEventListener("mouseup", this.#cancelConnect);
      this.#cancelConnect = null;
    }
    super._onClose(options);
  }

  /* ------------------------------------------------------------------ */
  /*  Persistence                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Writes the current nodePositions and links to the colossi world setting.
   * @returns {Promise<void>}
   */
  async #persistLayout() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const c = colossi[this.colossusId];
    if (!c) return;
    c.nodePositions = foundry.utils.deepClone(this.#nodePositions);
    c.links = foundry.utils.deepClone(this.#links);
    await game.settings.set(MODULE_ID, "colossi", colossi);
  }

  /* ------------------------------------------------------------------ */
  /*  Static opener (used from ColossusSheet)                            */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the links editor for a given colossus, or brings it to front if already open.
   * Restricted to GM users.
   * @param {string} colossusId
   */
  static open(colossusId) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can edit part links.");
      return;
    }
    const existing = foundry.applications.instances.get(`colossus-links-editor-${colossusId}`);
    if (existing) return existing.bringToFront();
    new ColossusLinksEditor(colossusId).render(true);
  }
}
