import { MODULE_ID } from "./constants.js";
import { ColossusSheet } from "./colossus-sheet.js";

/**
 * Manager window that lists all created Colossi and allows CRUD operations.
 * Opened via the scene control button or game.colossus.openManager().
 * Uses ApplicationV2 + HandlebarsApplicationMixin.
 */
export class ColossusManager extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "colossus-manager",
    classes: ["dh-colossus"],
    window: { title: "Colossus Manager", icon: "fas fa-dragon" },
    position: { width: 420, height: 500 },
    actions: {
      createColossus: ColossusManager.#onCreateColossus,
      openColossus: ColossusManager.#onOpenColossus,
      deleteColossus: ColossusManager.#onDeleteColossus,
      copyOpen: ColossusManager.#onCopyOpen
    }
  };

  static PARTS = {
    list: { template: "modules/dh-colossus/templates/colossus-manager.hbs" }
  };

  /* ---------------------------------------- */
  /*  Data Preparation                        */
  /* ---------------------------------------- */

  /**
   * Builds the context for the manager template.
   * Called during AppV2 render lifecycle.
   * @returns {Promise<{colossi: object[]}>}
   */
  async _prepareContext() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const entries = Object.values(colossi).map(c => {
      let img = "icons/svg/mystery-man.svg";
      if (c.principalActorUuid) {
        const actor = fromUuidSync(c.principalActorUuid);
        if (actor?.img) img = actor.img;
      }
      return { ...c, img };
    });
    return { colossi: entries };
  }

  /* ---------------------------------------- */
  /*  Actions                                 */
  /* ---------------------------------------- */

  /**
   * Creates a new Colossus with an auto-generated placeholder name.
   * Saves to world settings and opens the new sheet automatically.
   * Triggered by the createColossus action button.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onCreateColossus(event, target) {
    const id = foundry.utils.randomID();
    const colossus = { id, name: `Colossus ${id.slice(0, 6)}`, principalActorUuid: null, parts: [] };
    const colossi = game.settings.get(MODULE_ID, "colossi");
    colossi[id] = colossus;
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.render();
    new ColossusSheet(id).render(true);
  }

  /**
   * Opens the ColossusSheet for an existing Colossus, or brings it to front.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenColossus(event, target) {
    const colossusId = target.dataset.colossusId;
    const existing = foundry.applications.instances.get(`colossus-sheet-${colossusId}`);
    if (existing) {
      existing.bringToFront();
      return;
    }
    new ColossusSheet(colossusId).render(true);
  }

  /**
   * Deletes a Colossus after user confirmation.
   * Closes any open sheet for that Colossus and re-renders the manager.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteColossus(event, target) {
    const colossusId = target.dataset.colossusId;
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const name = colossi[colossusId]?.name ?? "this Colossus";

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Colossus" },
      content: `<p>Are you sure you want to delete <strong>${name}</strong>?</p>`
    });
    if (!confirmed) return;

    delete colossi[colossusId];
    await game.settings.set(MODULE_ID, "colossi", colossi);

    // Close any open sheet for this colossus
    const openSheet = foundry.applications.instances.get(`colossus-sheet-${colossusId}`);
    if (openSheet) openSheet.close();

    this.render();
  }

  /**
   * Copies a macro-style command to the clipboard for opening this Colossus via the public API.
   * Useful for wiring up macros or sharing a direct open command.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onCopyOpen(event, target) {
    const id = target.dataset.colossusId;
    const command = `Colossus.Open("${id}")`;
    await navigator.clipboard.writeText(command);
    ui.notifications.info(`Copied: ${command}`);
  }

}
