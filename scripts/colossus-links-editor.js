import { MODULE_ID } from "./constants.js";
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
    super(options);
    this.colossusId = colossusId;
    /** @type {string|null} partId being dragged, or null */
    this._draggingPartId = null;
    /** @type {{ x: number, y: number }} offset from node origin to mouse-down point */
    this._draggingOffset = { x: 0, y: 0 };
    /** @type {string|null} partId from which a new link is being drawn */
    this._connectingFrom = null;
    /** @type {string|null} side ("top"|"right"|"bottom"|"left") from which the connection starts */
    this._connectingFromSide = null;
    /** @type {Object<string, { x: number, y: number }>} live copy of node positions */
    this._nodePositions = {};
    /** @type {Array<{ from: string, to: string }>} live copy of links */
    this._links = [];
  }

  /** @returns {string} Unique application ID per colossus. */
  get id() { return `colossus-links-editor-${this.colossusId}`; }

  static DEFAULT_OPTIONS = {
    classes: ["dh-colossus", "colossus-links", "colossus-links-editor"],
    window: { title: "Part Links", icon: "fas fa-project-diagram", resizable: true },
    position: { width: 900, height: 650 },
    actions: {}
  };

  static PARTS = {
    sheet: { template: "modules/dh-colossus/templates/colossus-links-editor.hbs" }
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

    this._nodePositions = foundry.utils.deepClone(data.nodePositions ?? {});
    this._links = foundry.utils.deepClone(data.links ?? []);

    const nodes = (data.parts ?? [])
      .map(part => {
        const actor = fromUuidSync(part.actorUuid);
        if (!actor) return null;
        const pos = this._nodePositions[part.partId];
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
    // It gets a reserved __main__ key in _nodePositions so it can be dragged and persisted.
    let mainActorNode = null;
    if (data.principalActorUuid) {
      const mainActor = fromUuidSync(data.principalActorUuid);
      if (mainActor) {
        const MAIN_ACTOR_KEY = "__main__";
        if (!this._nodePositions[MAIN_ACTOR_KEY]) {
          // Default position: top-right corner; JS will snap after SVG dimensions are known
          this._nodePositions[MAIN_ACTOR_KEY] = { x: 780, y: 20 };
        }
        const pos = this._nodePositions[MAIN_ACTOR_KEY];
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
      this._fitSvg(svg);
      this._redrawLinks(svg);
      this._fitBackgroundImage(svg);
    });

    // Node drag
    svg.querySelectorAll(".node").forEach(node => {
      node.addEventListener("mousedown", (e) => this._onNodeMouseDown(e, svg));
    });

    // Anchor click (start connection)
    svg.querySelectorAll(".link-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this._onAnchorMouseDown(e, svg);
      });
    });

    // SVG-level mousemove / mouseup
    svg.addEventListener("mousemove", (e) => this._onSvgMouseMove(e, svg));
    svg.addEventListener("mouseup", (e) => this._onSvgMouseUp(e, svg));

    // Document-level mouseup to cancel connections started but released outside SVG
    if (this._cancelConnect) document.removeEventListener("mouseup", this._cancelConnect);
    this._cancelConnect = () => {
      if (!this._connectingFrom) return;
      const tempLine = svg.querySelector("#temp-link-line");
      if (tempLine) tempLine.style.display = "none";
      svg.classList.remove("is-connecting");
      this._connectingFrom     = null;
      this._connectingFromSide = null;
    };
    document.addEventListener("mouseup", this._cancelConnect);

    // Toolbar buttons
    this.element.querySelector(".links-btn-config")
      ?.addEventListener("click", () => this._onConfigBackground());

    this.element.querySelector(".links-btn-auto-layout")
      ?.addEventListener("click", () => this._onAutoLayout(svg));

    this.element.querySelector(".links-btn-show-players")
      ?.addEventListener("click", () => this._onShowPlayers());
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
  _toSvgCoords(svg, clientX, clientY) {
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
  _fitSvg(svg) {
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
  _fitBackgroundImage(svg) {
    const img = svg.querySelector(".links-bg-image");
    if (!img) return;
    img.setAttribute("width", svg.getAttribute("width") ?? "100%");
    img.setAttribute("height", svg.getAttribute("height") ?? "100%");
  }

  /**
   * Clears and redraws all persisted connection lines.
   * Called after any change to this._links or this._nodePositions.
   * @param {SVGSVGElement} svg
   */
  _redrawLinks(svg) {
    const layer = svg.querySelector(".links-layer");
    if (!layer) return;
    layer.innerHTML = "";

    for (const link of this._links) {
      const fromPos = this._nodePositions[link.from];
      const toPos   = this._nodePositions[link.to];
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
        this._removeLink(link.from, link.fromSide, link.to, link.toSide, svg);
      });
      layer.appendChild(line);
    }
  }

  /**
   * Updates line endpoints for a specific node during drag, avoiding full redraw.
   * @param {SVGSVGElement} svg
   * @param {string} partId
   */
  _updateLinesForNode(svg, partId) {
    const pos = this._nodePositions[partId];
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
  _onNodeMouseDown(e, svg) {
    if (e.button !== 0) return;
    if (this._connectingFrom) return;
    const node = e.currentTarget;
    const partId = node.dataset.partId;
    const svgPos = this._toSvgCoords(svg, e.clientX, e.clientY);
    const nodePos = this._nodePositions[partId] ?? { x: 0, y: 0 };
    this._draggingPartId = partId;
    this._draggingOffset = { x: svgPos.x - nodePos.x, y: svgPos.y - nodePos.y };
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
  _onAnchorMouseDown(e, svg) {
    if (e.button !== 0) return;
    const anchor = e.currentTarget;
    this._connectingFrom     = anchor.dataset.partId;
    this._connectingFromSide = anchor.dataset.side ?? "right";

    const fromPos  = this._nodePositions[this._connectingFrom];
    const tempLine = svg.querySelector("#temp-link-line");
    if (!fromPos || !tempLine) return;

    const origin = anchorPoint(fromPos, this._connectingFromSide);
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
  _onSvgMouseMove(e, svg) {
    const svgPos = this._toSvgCoords(svg, e.clientX, e.clientY);

    // Node dragging
    if (this._draggingPartId) {
      const newX = svgPos.x - this._draggingOffset.x;
      const newY = svgPos.y - this._draggingOffset.y;
      this._nodePositions[this._draggingPartId] = { x: newX, y: newY };
      const node = svg.querySelector(`.node[data-part-id="${this._draggingPartId}"]`);
      if (node) node.setAttribute("transform", `translate(${newX},${newY})`);
      this._updateLinesForNode(svg, this._draggingPartId);
    }

    // Connection drawing
    if (this._connectingFrom) {
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
  _onSvgMouseUp(e, svg) {
    // Finish node drag — persist positions
    if (this._draggingPartId) {
      this._draggingPartId = null;
      this._persistLayout();
    }

    // Finish connection drawing
    if (this._connectingFrom) {
      const target   = document.elementFromPoint(e.clientX, e.clientY);
      const anchor   = target?.closest(".link-anchor");
      const toPartId = anchor?.dataset.partId;
      const toSide   = anchor?.dataset.side ?? "left";

      if (toPartId && toPartId !== this._connectingFrom) {
        // Prevent any link involving the main actor node — it has no anchors by design
        if (toPartId === "__main__" || this._connectingFrom === "__main__") return;

        // Allow multiple links between the same pair IF they use different side combinations
        const exists = this._links.some(
          l => (l.from === this._connectingFrom && l.fromSide === this._connectingFromSide &&
                l.to   === toPartId            && l.toSide   === toSide) ||
               (l.from === toPartId            && l.fromSide === toSide &&
                l.to   === this._connectingFrom && l.toSide  === this._connectingFromSide)
        );
        if (!exists) {
          this._links.push({
            from:     this._connectingFrom,
            fromSide: this._connectingFromSide,
            to:       toPartId,
            toSide:   toSide
          });
          this._redrawLinks(svg);
          this._persistLayout();
        }
      }

      const tempLine = svg.querySelector("#temp-link-line");
      if (tempLine) tempLine.style.display = "none";
      svg.classList.remove("is-connecting");
      this._connectingFrom     = null;
      this._connectingFromSide = null;
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
  _removeLink(fromId, fromSide, toId, toSide, svg) {
    this._links = this._links.filter(l =>
      !(l.from === fromId && l.fromSide === fromSide &&
        l.to   === toId   && l.toSide   === toSide) &&
      !(l.from === toId   && l.fromSide === toSide &&
        l.to   === fromId && l.toSide   === fromSide)
    );
    this._redrawLinks(svg);
    this._persistLayout();
  }

  /* ------------------------------------------------------------------ */
  /*  Auto Layout                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Arranges all nodes in a grid starting at (40, 40), spaced 130px apart.
   * Capped at 6 columns. Overwrites existing positions.
   * @param {SVGSVGElement} svg
   */
  _onAutoLayout(svg) {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const parts = colossi[this.colossusId]?.parts ?? [];
    const cols = Math.min(6, Math.ceil(Math.sqrt(parts.length)));
    parts.forEach((part, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this._nodePositions[part.partId] = { x: 40 + col * 130, y: 40 + row * 130 };
    });
    this._persistLayout().then(() => this.render());
  }

  /* ------------------------------------------------------------------ */
  /*  Background Image Config                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Opens a FilePicker for the GM to select a background image for the SVG canvas.
   * Uses the v13 namespaced API: foundry.applications.apps.FilePicker.
   */
  _onConfigBackground() {
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
  _onShowPlayers() {
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
    if (this._cancelConnect) {
      document.removeEventListener("mouseup", this._cancelConnect);
      this._cancelConnect = null;
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
  async _persistLayout() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const c = colossi[this.colossusId];
    if (!c) return;
    c.nodePositions = foundry.utils.deepClone(this._nodePositions);
    c.links = foundry.utils.deepClone(this._links);
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
