/**
 * Configuration UI for managing Colossus part types.
 * Opened via game.settings.registerMenu in the module settings panel.
 * Uses ApplicationV2 + HandlebarsApplicationMixin per CLAUDE.md requirements.
 */
export class PartTypeConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  /** @type {string[]} IDs that ship with the module and cannot be deleted */
  static DEFAULT_IDS = [
    "head", "torso", "arm-left", "arm-right", "arms",
    "leg-left", "leg-right", "legs", "wing-left", "wing-right", "wings", "carapace"
  ];

  static DEFAULT_OPTIONS = {
    id: "colossus-part-type-config",
    tag: "form",
    form: { handler: PartTypeConfig.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    window: { title: "Configure Part Types", icon: "fas fa-puzzle-piece" },
    position: { width: 460, height: "auto" },
    actions: {
      addType: PartTypeConfig.#onAddType,
      removeType: PartTypeConfig.#onRemoveType
    }
  };

  static PARTS = {
    form: { template: "modules/dh-colossus/templates/part-type-config.hbs" }
  };

  /**
   * Local working copy of part types, committed to settings only on submit.
   * @type {Array<{id: string, label: string}>|null}
   */
  _pendingTypes = null;

  /* ---------------------------------------- */
  /*  Data Preparation                        */
  /* ---------------------------------------- */

  /**
   * Provides data to the Handlebars template.
   * Called during the AppV2 render lifecycle.
   * @param {object} partId - The part identifier for PARTS rendering.
   * @returns {Promise<object>}
   */
  async _prepareContext(partId) {
    if (!this._pendingTypes) {
      this._pendingTypes = foundry.utils.deepClone(
        game.settings.get("dh-colossus", "partTypes")
      );
    }
    return {
      partTypes: this._pendingTypes,
      defaults: PartTypeConfig.DEFAULT_IDS
    };
  }

  /* ---------------------------------------- */
  /*  Actions                                 */
  /* ---------------------------------------- */

  /**
   * Adds a new custom part type to the local working list.
   * Triggered by the "Add" action button.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAddType(event, target) {
    const input = this.element.querySelector('input[name="new-type-label"]');
    const label = input?.value?.trim();
    if (!label) return;
    this._pendingTypes.push({ id: foundry.utils.randomID(), label });
    input.value = "";
    this.render();
  }

  /**
   * Removes a custom part type from the local working list.
   * Default types are protected and cannot be removed.
   * Triggered by the "Remove" action button.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveType(event, target) {
    const id = target.dataset.typeId;
    if (PartTypeConfig.DEFAULT_IDS.includes(id)) return;
    this._pendingTypes = this._pendingTypes.filter(pt => pt.id !== id);
    this.render();
  }

  /**
   * Persists edited labels and the current list to the world setting.
   * Triggered on form submission (AppV2 form handler).
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    for (const pt of this._pendingTypes) {
      const key = `label-${pt.id}`;
      if (key in data) pt.label = data[key];
    }
    await game.settings.set("dh-colossus", "partTypes", this._pendingTypes);
    this._pendingTypes = null;
  }
}
