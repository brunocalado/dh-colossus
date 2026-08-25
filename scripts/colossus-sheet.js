/*!
 * Daggerheart: Colossus
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES } from "./constants.js";
import { ColossusLinksEditor } from "./colossus-links-editor.js";

/**
 * Sheet for viewing and editing a single Colossus.
 * Displays aggregated HP, parts with their stats, and supports drag-drop of Actors.
 * Uses ApplicationV2 + HandlebarsApplicationMixin.
 */
export class ColossusSheet extends foundry.applications.api.HandlebarsApplicationMixin(
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

  /** @type {number} Saved scroll offset to restore after programmatic re-renders. */
  #savedScrollTop = 0;

  /**
   * Gives each sheet a stable per-colossus application ID so multiple sheets can be open at
   * once and `foundry.applications.instances.get("colossus-sheet-<id>")` can find one that's
   * already open. ApplicationV2#id is backed by a true private field the base class populates
   * from `options.uniqueId` during construction, so overriding the `id` getter (the previous
   * approach here) never reaches it — the framework silently keeps its own auto-incrementing
   * `app-N` id instead, and every lookup by our custom id misses. Per ApplicationV2#id's own
   * doc comment, `_initializeApplicationOptions` is the supported hook for this.
   * @param {object} options
   * @returns {ApplicationConfiguration}
   */
  _initializeApplicationOptions(options) {
    const applicationOptions = super._initializeApplicationOptions(options);
    applicationOptions.uniqueId = applicationOptions.colossusId;
    return applicationOptions;
  }

  /** Relay for preCreateToken hook: set on dragstart, cleared after token creation. */
  static pendingColossusId = null;

  static DEFAULT_OPTIONS = {
    id: "colossus-sheet-{id}",
    colossusId: null,
    classes: [MODULE_ID, "colossus-sheet"],
    window: { title: "Colossus", icon: "fas fa-dragon", resizable: true },
    position: { width: 800, height: 700 },
    actions: {
      openActorSheet: ColossusSheet.#onOpenActorSheet,
      removePart: ColossusSheet.#onRemovePart,
      removePrincipal: ColossusSheet.#onRemovePrincipal,
      toggleFeatures: ColossusSheet.#onToggleFeatures,
      locateToken: ColossusSheet.#onLocateToken,
      viewActorImage: ColossusSheet.#onViewActorImage,
      setPip: ColossusSheet.#onSetPip,
      openLinksEditor: ColossusSheet.#onOpenLinksEditor
    },
  };

  static PARTS = {
    sheet: { template: TEMPLATES.colossusSheet }
  };

  /* ---------------------------------------- */
  /*  Data Preparation                        */
  /* ---------------------------------------- */

  /**
   * Resolves actors for each part and builds the parts list.
   * Called during AppV2 render lifecycle.
   * @returns {Promise<object>}
   */
  async _prepareContext() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const data = colossi[this.colossusId];
    if (!data) return { colossus: null, parts: [], partTypes: [] };

    const partTypes = game.settings.get(MODULE_ID, "partTypes");

    // Check whether the Massive Damage variant rule is active
    let massiveDamageEnabled = false;
    try {
      const variantRules = game.settings.get(
        CONFIG.DH.id,
        CONFIG.DH.SETTINGS.gameSettings.variantRules
      );
      massiveDamageEnabled = variantRules?.massiveDamage?.enabled === true;
    } catch {
      // CONFIG.DH may not be defined in non-Daggerheart worlds; silently ignore
    }

    /**
     * Capitalises the first letter of a featureForm value for display.
     * e.g. "action" -> "Action", "passive" -> "Passive", "reaction" -> "Reaction"
     * @param {string} form
     * @returns {string}
     */
    const formatFeatureForm = (form) => {
      if (!form) return "";
      return form.charAt(0).toUpperCase() + form.slice(1);
    };

    // Resolve principal actor for the header row
    let principal = null;
    if (data.principalActorUuid) {
      const pActor = fromUuidSync(data.principalActorUuid);
      if (pActor) {
        const stressValue = pActor?.system?.resources?.stress?.value ?? 0;
        const stressMax   = pActor?.system?.resources?.stress?.max   ?? 0;
        const makePips = (value, max) =>
          Array.from({ length: max }, (_, i) => ({ index: i + 1, filled: i < value }));
        const features = pActor.items?.filter(i => i.type === "feature") ?? [];

        // Build experiences array from system.experiences record map
        const experiencesMap = pActor?.system?.experiences ?? {};
        const experiences = Object.values(experiencesMap)
          .map(e => ({ name: e.name ?? "", value: e.value ?? 0 }))
          .filter(e => e.name !== "");

        principal = {
          actorUuid: data.principalActorUuid,
          actorName: pActor.name,
          actorImg:  pActor.img ?? "icons/svg/mystery-man.svg",
          stress: { value: stressValue, max: stressMax, pips: makePips(stressValue, stressMax) },
          features: features.map(f => ({
            name: f.name,
            img:  f.img,
            featureForm: formatFeatureForm(f.system?.featureForm ?? ""),
            description: f.system?.description?.value ?? f.system?.description ?? ""
          })),
          experiences
        };
      }
    }

    const resolvedParts = [];
    for (const part of data.parts) {
      const actor = fromUuidSync(part.actorUuid);
      if (!actor) continue;

      const hpValue     = actor?.system?.resources?.hitPoints?.value ?? 0;
      const hpMax       = actor?.system?.resources?.hitPoints?.max   ?? 0;
      const stressValue = actor?.system?.resources?.stress?.value    ?? 0;
      const stressMax   = actor?.system?.resources?.stress?.max      ?? 0;
      const features = actor.items?.filter(i => i.type === "feature") ?? [];
      const partTypeLabel = partTypes.find(pt => pt.id === part.partTypeId)?.label ?? "Unknown";

      // Attack bonus: system.attack.roll.bonus — null when not present so template can show "—"
      const rawAttackBonus = actor?.system?.attack?.roll?.bonus ?? null;
      const attackBonus = rawAttackBonus !== null ? `+${rawAttackBonus}` : "—";

      /** Generates a pip array where each entry carries its 1-based index and filled state. */
      const makePips = (value, max) => Array.from({ length: max }, (_, i) => ({ index: i + 1, filled: i < value }));

      const severeThreshold = actor?.system?.damageThresholds?.severe ?? 0;

      // Default to "healthy" for parts created before the status field existed
      const status = part.status ?? "healthy";

      resolvedParts.push({
        partId: part.partId,
        actorUuid: part.actorUuid,
        actorName: actor.name,
        actorImg: actor.img ?? "icons/svg/mystery-man.svg",
        partTypeId: part.partTypeId,
        partTypeLabel,
        status,
        hp:     { value: hpValue,     max: hpMax,     pips: makePips(hpValue,     hpMax)     },
        stress: { value: stressValue, max: stressMax, pips: makePips(stressValue, stressMax) },
        attackBonus,
        difficulty: actor?.system?.difficulty ?? "—",
        damageThresholds: {
          major:   actor?.system?.damageThresholds?.major  ?? 0,
          severe:  severeThreshold,
          massive: massiveDamageEnabled ? severeThreshold * 2 : null,
        },
        features: features.map(f => ({
          name: f.name,
          img:  f.img,
          featureForm: formatFeatureForm(f.system?.featureForm ?? ""),
          // Daggerheart stores rich-text descriptions as system.description.value; fall back to plain string
          description: f.system?.description?.value ?? f.system?.description ?? ""
        }))
      });
    }

    return { colossus: data, parts: resolvedParts, partTypes, principal, massiveDamageEnabled, isGM: game.user.isGM };
  }

  /* ---------------------------------------- */
  /*  Scroll Preservation                     */
  /* ---------------------------------------- */

  /**
   * Saves the current scroll offset of the parts list before a re-render.
   * Call this immediately before any this.render() triggered by user edits.
   */
  #saveScroll() {
    const scroller = this.element?.querySelector(".parts-table-wrapper");
    if (scroller) this.#savedScrollTop = scroller.scrollTop;
  }

  /**
   * Restores the previously saved scroll offset after a re-render.
   * Called from _onRender when options.scroll === true.
   * @param {HTMLElement} scrollEl
   */
  #restoreScroll(scrollEl) {
    if (scrollEl && this.#savedScrollTop > 0) {
      scrollEl.scrollTop = this.#savedScrollTop;
    }
  }

  /* ---------------------------------------- */
  /*  Public Helpers                          */
  /* ---------------------------------------- */

  /**
   * Returns all Actor UUIDs associated with this Colossus.
   * Used by the global updateActor hook for live-update detection.
   * @returns {string[]}
   */
  getPartUuids() {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const c = colossi[this.colossusId];
    if (!c) return [];
    const uuids = (c.parts ?? []).map(p => p.actorUuid);
    if (c.principalActorUuid) uuids.push(c.principalActorUuid);
    return uuids;
  }

  /**
   * Updates only the pip tracks and value labels for a given actor UUID,
   * avoiding a full re-render that would collapse expanded feature rows.
   * Called by the updateActor hook instead of render().
   * @param {string} actorUuid - The UUID of the updated actor.
   */
  refreshPips(actorUuid) {
    const actor = fromUuidSync(actorUuid);
    if (!actor) return;

    const stats = {
      hp:     actor.system?.resources?.hitPoints?.value ?? 0,
      stress: actor.system?.resources?.stress?.value    ?? 0
    };

    for (const track of this.element.querySelectorAll(`.pip-track[data-uuid="${actorUuid}"]`)) {
      const stat    = track.dataset.stat;
      const value   = stats[stat] ?? 0;
      const pips    = track.querySelectorAll(".pip");

      pips.forEach((pip, i) => pip.classList.toggle("filled", i < value));

      const label = track.closest(".pip-group")?.querySelector(".pip-value");
      if (label) label.textContent = `${value} / ${pips.length}`;
    }

    // Auto-destroy: when HP value equals HP max and max > 0, set status to "destroyed"
    const hpValue = actor.system?.resources?.hitPoints?.value ?? 0;
    const hpMax   = actor.system?.resources?.hitPoints?.max   ?? 0;
    if (hpMax > 0 && hpValue >= hpMax) {
      this.#autoSetStatus(actorUuid, "destroyed");
    }
  }

  /**
   * Sets a part's status by actor UUID and persists to the world setting.
   * Triggers a full re-render so the row tint and status select update.
   * Called by refreshPips when HP reaches max (auto-destroy).
   * @param {string} actorUuid
   * @param {string} newStatus - "healthy", "broken", or "destroyed"
   */
  async #autoSetStatus(actorUuid, newStatus) {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    if (!colossus) return;
    const part = colossus.parts.find(p => p.actorUuid === actorUuid);
    if (!part || part.status === newStatus) return;
    part.status = newStatus;
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.#saveScroll();
    this.render({ scroll: true });
  }

  /* ---------------------------------------- */
  /*  Drag & Drop                             */
  /* ---------------------------------------- */

  /**
   * Attaches native event listeners after each render.
   * AppV2 does not wire #onDrop or change-based select actions from DEFAULT_OPTIONS,
   * so we bind manually here. Triggered by the AppV2 _onRender lifecycle stage.
   * @param {object} context - The prepared render context.
   * @param {object} options - Render options.
   */
  _onRender(context, options) {
    const dropZone = this.element.querySelector(".parts-drop-zone");
    if (dropZone) {
      // Only wire drop events when the zone is active (principal exists)
      if (!dropZone.classList.contains("parts-drop-zone--disabled")) {
        dropZone.addEventListener("dragover", (e) => e.preventDefault());
        dropZone.addEventListener("drop", (e) => this.#onDrop(e));
      }
    }

    // Use "change" instead of "click" so the dropdown fully closes before we persist,
    // preventing premature re-renders that collapse the combobox mid-selection.
    this.element.querySelectorAll(".part-type-select").forEach(select => {
      select.addEventListener("change", (e) => this.#handlePartTypeChange(e));
    });

    this.element.querySelectorAll(".part-status-select").forEach(select => {
      select.addEventListener("change", (e) => this.#handlePartStatusChange(e));
    });

    // Principal drop zone: accepts adversary actors as the colossus principal
    const principalZone = this.element.querySelector(".principal-drop-zone");
    if (principalZone) {
      principalZone.addEventListener("dragover", (e) => e.preventDefault());
      principalZone.addEventListener("drop", (e) => this.#onDropPrincipal(e));
    }

    // Drag-to-scene: populate dataTransfer so the Foundry canvas can create a token on drop.
    // Principal drags carry _isColossusGroup: true so the dropCanvasData hook can intercept
    // them and place all colossus tokens in a grid instead of creating a single token.
    this.element.querySelectorAll(".drag-to-scene-btn").forEach(btn => {
      btn.addEventListener("dragstart", (event) => {
        const uuid = btn.dataset.uuid;
        const actor = fromUuidSync(uuid);
        if (!actor) return;

        // Detect if this drag originates from the principal row to trigger group placement
        const isPrincipal = !!btn.closest(".principal-row");

        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
            type: "Actor",
            uuid,
            _colossusId: this.colossusId,
            _isColossusGroup: isPrincipal
          })
        );
        event.dataTransfer.effectAllowed = "copy";
        ColossusSheet.pendingColossusId = this.colossusId;
      });
    });

    // Restore scroll position after re-renders triggered by user edits (pip clicks, combobox changes).
    if (options?.scroll) {
      const scroller = this.element.querySelector(".parts-table-wrapper");
      this.#restoreScroll(scroller);
    }
  }

  /**
   * Only GMs may drag-drop actors onto the sheet.
   * @returns {boolean}
   */
  #canDragDrop() {
    return game.user.isGM;
  }

  /**
   * Returns true if the actor's prototype token is linked (actorLink === true).
   * Unlinked actors must not be added to a Colossus because their HP/Stress live on
   * each individual token instance, not on the world actor — so the sheet would read
   * and write the wrong data source.
   * @param {Actor} actor
   * @returns {boolean}
   */
  static #isLinked(actor) {
    return actor.prototypeToken?.actorLink === true;
  }

  /**
   * Emits a standardised warning when an unlinked actor is dropped onto the sheet.
   * Points the user to where the setting can be changed.
   * @param {Actor} actor
   */
  static #warnUnlinked(actor) {
    ui.notifications.warn(
      `"${actor.name}" has an unlinked token (Actor Link is disabled on its Prototype Token). ` +
      `Only linked actors can be added to a Colossus — unlinked tokens store HP and Stress ` +
      `independently per token, so the Colossus sheet would not reflect combat changes correctly. ` +
      `To fix this, open the actor sheet → Prototype Token tab → enable "Link Actor Data".`
    );
  }

  /**
   * Asks the user whether to enable Link Actor Data on the dropped actor.
   * If confirmed, updates the prototype token and returns true so the drop can proceed.
   * If declined, emits the standard unlinked warning and returns false.
   * @param {Actor} actor
   * @returns {Promise<boolean>}
   */
  static async #promptLinkActor(actor) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Unlinked Actor" },
      content: `<p>"${actor.name}" has <strong>Link Actor Data</strong> disabled on its Prototype Token.</p>
        <p>Enable it now so this actor can be added to the Colossus?</p>`,
      yes: { label: "Enable & Add", icon: "fa-solid fa-link" },
      no:  { label: "Cancel",       icon: "fa-solid fa-xmark" },
    });
    if (confirmed) {
      await actor.update({ "prototypeToken.actorLink": true });
      return true;
    }
    ColossusSheet.#warnUnlinked(actor);
    return false;
  }

  /**
   * Handles dropping an Actor onto the parts drop zone.
   * Rejects the drop if no principal has been set yet.
   * Validates that the actor is of type "adversary", is linked, prevents duplicates,
   * adds it as a new part, and syncs its stress.max to the principal's stress.max.
   * @param {DragEvent} event
   */
  async #onDrop(event) {
    // Guard: parts cannot be added before a principal is set
    const colossiCheck = game.settings.get(MODULE_ID, "colossi");
    const colossusCheck = colossiCheck[this.colossusId];
    if (!colossusCheck?.principalActorUuid) {
      ui.notifications.warn("Set a principal first before adding parts to this Colossus.");
      return;
    }

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data.type !== "Actor") return;

    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    // Only adversary actors are valid Colossus parts in the Daggerheart system
    if (actor.type !== "adversary") {
      ui.notifications.warn(`Only adversary actors can be added to a Colossus. "${actor.name}" is type "${actor.type}".`);
      return;
    }

    // Prompt to enable Link Actor Data if needed — their data lives on the token otherwise
    if (!ColossusSheet.#isLinked(actor)) {
      if (!(await ColossusSheet.#promptLinkActor(actor))) return;
    }

    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    if (!colossus) return;

    // Prevent adding an actor that is already the principal or already a part
    if (colossus.principalActorUuid === data.uuid) {
      ui.notifications.warn(`${actor.name} is already the principal of this Colossus.`);
      return;
    }
    if (colossus.parts.some(p => p.actorUuid === data.uuid)) {
      ui.notifications.warn(`${actor.name} is already a part of this Colossus.`);
      return;
    }

    const partTypes = game.settings.get(MODULE_ID, "partTypes");
    const newPart = {
      partId: foundry.utils.randomID(),
      actorUuid: data.uuid,
      partTypeId: partTypes[0]?.id ?? "",
      status: "healthy"
    };
    colossus.parts.push(newPart);
    await game.settings.set(MODULE_ID, "colossi", colossi);

    // Sync the new part's stress.max to match the principal's stress.max
    const principalActor = await fromUuid(colossus.principalActorUuid);
    const principalStressMax = principalActor?.system?.resources?.stress?.max ?? null;
    if (principalStressMax !== null) {
      await actor.update({ "system.resources.stress.max": principalStressMax });
    }

    this.render();
  }

  /* ---------------------------------------- */
  /*  Principal Drop                          */
  /* ---------------------------------------- */

  /**
   * Handles dropping an Actor onto the principal drop zone.
   * Validates adversary type, linked token, prevents duplicates with the parts list,
   * and auto-names the colossus from the principal if the name is still a placeholder.
   * Wired manually in _onRender via native addEventListener.
   * @param {DragEvent} event
   */
  async #onDropPrincipal(event) {
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (data.type !== "Actor") return;

    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    if (actor.type !== "adversary") {
      ui.notifications.warn(`Only adversary actors can be set as the principal. "${actor.name}" is type "${actor.type}".`);
      return;
    }

    // Prompt to enable Link Actor Data if needed — their data lives on the token otherwise
    if (!ColossusSheet.#isLinked(actor)) {
      if (!(await ColossusSheet.#promptLinkActor(actor))) return;
    }

    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    if (!colossus) return;

    // Prevent setting a part actor as the principal
    if (colossus.parts.some(p => p.actorUuid === data.uuid)) {
      ui.notifications.warn(`${actor.name} is already a part of this Colossus.`);
      return;
    }

    colossus.principalActorUuid = data.uuid;
    // Auto-name the colossus from the principal if the name is still the auto-generated placeholder
    if (!colossus.name || colossus.name.startsWith("Colossus ")) {
      colossus.name = actor.name;
    }
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.render();
  }

  /* ---------------------------------------- */
  /*  Instance Helpers (change-event based)   */
  /* ---------------------------------------- */

  /**
   * Persists a part-type change triggered by the <select> "change" event.
   * Using "change" (rather than AppV2's click-based action dispatch) ensures the
   * browser fully closes the dropdown before we re-render the sheet.
   * @param {Event} event
   */
  async #handlePartTypeChange(event) {
    const select = event.currentTarget;
    const partId = select.dataset.partId;
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    const part = colossus?.parts.find(p => p.partId === partId);
    if (!part) return;
    part.partTypeId = select.value;
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.#saveScroll();
    this.render({ scroll: true });
  }

  /**
   * Persists a part-status change triggered by the status <select> "change" event.
   * Bound in _onRender, same pattern as #handlePartTypeChange.
   * @param {Event} event
   */
  async #handlePartStatusChange(event) {
    const select = event.currentTarget;
    const partId = select.dataset.partId;
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    const part = colossus?.parts.find(p => p.partId === partId);
    if (!part) return;
    part.status = select.value;
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.#saveScroll();
    this.render({ scroll: true });
  }

  /* ---------------------------------------- */
  /*  Actions                                 */
  /* ---------------------------------------- */

  /**
   * Opens the native Actor sheet for a part's linked actor.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenActorSheet(event, target) {
    const actor = await fromUuid(target.dataset.uuid);
    actor?.sheet?.render(true);
  }

  /**
   * Removes a part from the Colossus after user confirmation.
   * Uses DialogV2.confirm to prevent accidental deletions.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemovePart(event, target) {
    const partId = target.dataset.partId;
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    if (!colossus) return;

    const partEntry = colossus.parts.find(p => p.partId === partId);
    const actorName = partEntry
      ? (fromUuidSync(partEntry.actorUuid)?.name ?? "this part")
      : "this part";

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Part" },
      content: `<p>Remove <strong>${actorName}</strong> from this Colossus?</p>`
    });
    if (!confirmed) return;

    colossus.parts = colossus.parts.filter(p => p.partId !== partId);
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.render();
  }

  /**
   * Toggles the inline features list visibility for a part row or the principal row.
   * Principal path is identified by the data-principal attribute on the button.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onToggleFeatures(event, target) {
    // Principal path: toggle the features div inside .principal-row
    if (target.dataset.principal) {
      const row = target.closest(".principal-row");
      const featuresDiv = row?.querySelector(".principal-features-row");
      if (featuresDiv) {
        featuresDiv.style.display = featuresDiv.style.display === "none" ? "block" : "none";
      }
      return;
    }
    // Parts path: toggle the sibling features <tr>
    const partId = target.closest(".part-row")?.dataset.partId;
    if (!partId) return;
    const featuresRow = target
      .closest("tbody")
      .querySelector(`.features-row[data-part-id="${partId}"]`);
    if (featuresRow) featuresRow.classList.toggle("expanded");
  }

  /**
   * Removes the principal actor from this Colossus after user confirmation.
   * Uses DialogV2.confirm to prevent accidental removal, matching the behaviour of #onRemovePart.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemovePrincipal(event, target) {
    const colossi = game.settings.get(MODULE_ID, "colossi");
    const colossus = colossi[this.colossusId];
    if (!colossus) return;

    const actorName = colossus.principalActorUuid
      ? (fromUuidSync(colossus.principalActorUuid)?.name ?? "the principal")
      : "the principal";

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Principal" },
      content: `<p>Remove <strong>${actorName}</strong> as the principal of this Colossus?</p>`
    });
    if (!confirmed) return;

    colossus.principalActorUuid = null;
    await game.settings.set(MODULE_ID, "colossi", colossi);
    this.render();
  }

  /**
   * Opens an ImagePopout for the part's actor portrait.
   * Uses the v13 API: src and window.title go inside the options object.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onViewActorImage(event, target) {
    const uuid = target.dataset.uuid;
    const actor = await fromUuid(uuid);
    if (!actor) return;

    new foundry.applications.apps.ImagePopout({
      src: actor.img,
      window: { title: actor.name },
      shareable: true,
      uuid: actor.uuid
    }).render(true);
  }

  /**
   * Pans the canvas to the first token belonging to the linked Actor and selects it.
   * Compares by actorId (the root document ID) rather than the full token-actor UUID,
   * so it works for both linked and unlinked tokens.
   * Warns if no token for the Actor exists on the current scene.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onLocateToken(event, target) {
    const uuid = target.dataset.uuid;
    const actor = await fromUuid(uuid);
    if (!actor) return;

    // t.actor?.uuid returns the token-actor UUID (Scene.X.Token.Y.Actor.Z) which never
    // matches the world-actor UUID stored in data-uuid. Compare by actor ID instead,
    // which is consistent for both linked and unlinked tokens.
    const tokens = canvas.tokens.placeables.filter(
      t => t.document.actorId === actor.id || t.actor?.id === actor.id
    );

    if (!tokens.length) {
      ui.notifications.warn(`No token for "${actor.name}" found on the current scene.`);
      return;
    }

    const token = tokens[0];
    canvas.animatePan({ x: token.x, y: token.y, scale: 1 });
    token.control({ releaseOthers: true });
  }

  /**
   * Sets HP or Stress on the linked Actor by clicking a pip button.
   * Clicking the already-active last filled pip resets the value to 0 (toggle off).
   * Triggered by the setPip action on `.pip` buttons inside `.pip-track`.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSetPip(_event, target) {
    const track = target.closest(".pip-track");
    const uuid  = track.dataset.uuid;
    const stat  = track.dataset.stat;
    const index = parseInt(target.dataset.index);

    const actor = await fromUuid(uuid);
    if (!actor) return;

    const pathMap = {
      hp:     "system.resources.hitPoints.value",
      stress: "system.resources.stress.value"
    };

    // Clicking the exact pip that equals the current value toggles it off
    const currentValue = stat === "hp"
      ? (actor.system?.resources?.hitPoints?.value ?? 0)
      : (actor.system?.resources?.stress?.value    ?? 0);

    const newValue = currentValue === index ? 0 : index;
    await actor.update({ [pathMap[stat]]: newValue });
  }

  /**
   * Opens the ColossusLinksEditor for the GM to manage part connections.
   * Restricted to GM users — players see a warning if they somehow trigger it.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onOpenLinksEditor(event, target) {
    ColossusLinksEditor.open(this.colossusId);
  }
}
