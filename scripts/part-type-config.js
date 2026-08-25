/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, DEFAULT_PART_IDS, TEMPLATES } from "./constants.js";

/**
 * Configuration UI for managing Colossus part types.
 * Opened via game.settings.registerMenu in the module settings panel.
 * Uses ApplicationV2 + HandlebarsApplicationMixin per CLAUDE.md requirements.
 */
export class PartTypeConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  /** @type {string[]} IDs that ship with the module and cannot be deleted */
  static DEFAULT_IDS = DEFAULT_PART_IDS;

  static DEFAULT_OPTIONS = {
    id: "colossus-part-type-config",
    classes: [MODULE_ID],
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
    form: { template: TEMPLATES.partTypeConfig }
  };

  /**
   * Local working copy of part types, committed to settings only on submit.
   * @type {Array<{id: string, label: string}>|null}
   */
  #pendingTypes = null;

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
    if (!this.#pendingTypes) {
      this.#pendingTypes = foundry.utils.deepClone(
        game.settings.get(MODULE_ID, "partTypes")
      );
    }
    return {
      partTypes: this.#pendingTypes,
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
    this.#pendingTypes.push({ id: foundry.utils.randomID(), label });
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
    this.#pendingTypes = this.#pendingTypes.filter(pt => pt.id !== id);
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
    for (const pt of this.#pendingTypes) {
      const key = `label-${pt.id}`;
      if (key in data) pt.label = data[key];
    }
    await game.settings.set(MODULE_ID, "partTypes", this.#pendingTypes);
    this.#pendingTypes = null;
  }
}
