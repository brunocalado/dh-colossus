import { ColossusSheet } from "./colossus-sheet.js";
import { ColossusLinksEditor } from "./colossus-links-editor.js";
import { ColossusLinksViewer } from "./colossus-links-viewer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ---------------------------------------------------------------------------
// ColossusHudDialog -- AppV2 dialog opened from the Token HUD button
// ---------------------------------------------------------------------------

class ColossusHudDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dh-colossus-hud-app"],
    window: { title: "Colossus Actions" },
    position: { width: 260 },
    actions: {
      openSheet:    ColossusHudDialog.#onOpenSheet,
      viewSegments: ColossusHudDialog.#onViewSegments,
    }
  };

  static PARTS = {
    main: { template: "modules/dh-colossus/templates/colossus-hud-dialog.hbs" }
  };

  /**
   * @param {string} colossusId - The colossus world-setting ID.
   */
  constructor(colossusId) {
    super();
    this.colossusId = colossusId;
  }

  /** @returns {string} Unique per-colossus application ID. */
  get id() {
    return `dh-colossus-hud-dialog-${this.colossusId}`;
  }

  /**
   * Provides the colossus name to the dialog template.
   * Called during the AppV2 render lifecycle.
   * @returns {Promise<object>}
   */
  async _prepareContext() {
    const colossi = game.settings.get("dh-colossus", "colossi");
    const colossus = colossi[this.colossusId];
    return {
      colossusName: colossus?.name ?? "Colossus",
    };
  }

  /**
   * Opens the ColossusSheet for this colossus, or brings it to front if already open.
   * Triggered by the openSheet action button.
   */
  static #onOpenSheet() {
    const id = this.colossusId;
    const colossi = game.settings.get("dh-colossus", "colossi");
    if (!colossi[id]) {
      ui.notifications.warn("Colossus no longer exists.");
      return;
    }
    const existing = foundry.applications.instances.get(`colossus-sheet-${id}`);
    if (existing) existing.bringToFront();
    else new ColossusSheet(id).render(true);
    this.close();
  }

  /**
   * Opens the ColossusLinksEditor for this colossus.
   * Triggered by the viewSegments action button.
   */
  static #onViewSegments() {
    ColossusLinksEditor.open(this.colossusId);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// ColossusHud -- Token HUD button injection
// ---------------------------------------------------------------------------

export class ColossusHud {

  /**
   * Registers the renderTokenHUD hook. Call from main.js Hooks.once("ready").
   */
  static init() {
    Hooks.on("renderTokenHUD", (app, html) => {
      if (!game.user.isGM) return;
      ColossusHud._injectHUDButton(app, html);
    });
  }

  /**
   * Injects a Colossus dragon button into the left HUD column for any
   * token carrying a valid dh-colossus.colossusId flag.
   * Mirrors the pattern used in dh-horde HordeHud._injectHUDButton().
   *
   * Triggered by the renderTokenHUD hook registered in ColossusHud.init().
   * @param {TokenHUD} app
   * @param {HTMLElement|jQuery} html
   */
  static _injectHUDButton(app, html) {
    // v13: html is HTMLElement. Normalise defensively.
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root) return;

    const token = app.object ?? app.token;
    if (!token) return;

    const colossusId = token.document?.getFlag("dh-colossus", "colossusId");
    if (!colossusId) return;

    // Validate: colossus must still exist in world settings
    const colossi = game.settings.get("dh-colossus", "colossi");
    if (!colossi[colossusId]) return;

    const colLeft = root.querySelector(".col.left");
    if (!colLeft) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("control-icon", "dh-colossus-hud-btn");
    btn.setAttribute("data-tooltip", "Colossus Actions");
    btn.innerHTML = `<i class="fas fa-dragon"></i>`;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      game.tooltip?.deactivate();
      app.close?.();
      new ColossusHudDialog(colossusId).render(true);
    });

    // Append after the gear icon (first .control-icon in left column)
    const gearBtn = colLeft.querySelector(".control-icon");
    if (gearBtn) gearBtn.after(btn);
    else colLeft.prepend(btn);
  }

  /**
   * Registers the refreshToken and deleteToken hooks for the player inspect icon.
   * refreshToken fires on hover in/out and all token state changes, providing
   * reliable show/hide control. deleteToken handles cleanup when tokens are removed.
   * Call from main.js alongside ColossusHud.init().
   */
  static initPlayerIcon() {
    Hooks.on("refreshToken", (token) => ColossusHud._refreshInspectIcon(token));
    Hooks.on("deleteToken", (tokenDoc) => ColossusHud._removeInspectIcon(tokenDoc.id));
  }

  /**
   * Creates or repositions the inspect icon on the tokens layer.
   * Icons live on canvas.tokens (same layer as Token placeables) because that layer
   * guarantees PIXI pointer-event propagation to interactive children.
   * Triggered by the refreshToken hook registered in ColossusHud.initPlayerIcon().
   * @param {Token} token - The PIXI Token object being refreshed.
   */
  static _refreshInspectIcon(token) {
    if (game.user.isGM) return;
    if (!canvas.tokens) return;

    const colossusId = token.document?.getFlag("dh-colossus", "colossusId");
    const existing = canvas.tokens.children?.find(c => c.__colossusToken === token.id);

    // Remove stale icon if flag or colossus no longer valid
    if (!colossusId || !game.settings.get("dh-colossus", "colossi")[colossusId]) {
      if (existing) canvas.tokens.removeChild(existing);
      return;
    }

    // Create the icon once; subsequent refreshes only reposition it
    let icon = existing;
    if (!icon) {
      icon = ColossusHud._createInspectIcon(colossusId, token.id);
      canvas.tokens.addChild(icon);
    }

    const R = 14;
    icon.x = token.x + canvas.grid.size / 2;
    icon.y = token.y - R - 2;
  }

  /**
   * Removes the inspect icon from the tokens layer when its token is deleted.
   * Triggered by the deleteToken hook registered in ColossusHud.initPlayerIcon().
   * @param {string} tokenId - The ID of the deleted token document.
   */
  static _removeInspectIcon(tokenId) {
    if (!canvas.tokens) return;
    const icon = canvas.tokens.children?.find(c => c.__colossusToken === tokenId);
    if (icon) canvas.tokens.removeChild(icon);
  }

  /**
   * Builds the PIXI.Graphics magnifier icon and wires its click handler.
   * Separated from _refreshInspectIcon so the graphics object is created only once
   * per token lifetime rather than on every refresh cycle.
   * @param {string} colossusId - The colossus world-setting ID.
   * @param {string} tokenId - The token document ID this icon belongs to.
   * @returns {PIXI.Graphics}
   */
  static _createInspectIcon(colossusId, tokenId) {
    const R = 14;
    const g = new PIXI.Graphics();
    g.__colossusInspect = true;
    g.__colossusToken = tokenId;

    // Dark semi-transparent circular button background
    g.beginFill(0x1a1a2e, 0.75);
    g.drawCircle(0, 0, R);
    g.endFill();

    // Magnifier glass circle (white outline)
    const lensR = 6;
    const lensX = -1;
    const lensY = -2;
    g.lineStyle(2, 0xFFFFFF, 1);
    g.drawCircle(lensX, lensY, lensR);
    g.lineStyle(0);

    // Magnifier handle
    g.lineStyle(2.5, 0xFFFFFF, 1, 0.5, false);
    g.moveTo(lensX + lensR * 0.7, lensY + lensR * 0.7);
    g.lineTo(lensX + lensR * 0.7 + 4, lensY + lensR * 0.7 + 4);
    g.lineStyle(0);

    g.eventMode = "static";
    g.cursor = "pointer";
    g.hitArea = new PIXI.Circle(0, 0, R);
    g.on("pointerdown", (ev) => {
      ev.stopPropagation();
      ColossusLinksViewer.open(colossusId);
    });

    return g;
  }
}
