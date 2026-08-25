# 0.0.4

## Bug Fixes
- Fixed "Open"/bring-to-front for the Colossus Sheet, Part Links Editor, Part Links Viewer, and the Token HUD dialog always opening a new window instead of reusing an already-open one. These windows computed their per-colossus id through a `get id()` override, but ApplicationV2's internal window registry never used that override — it tracks its own id set during construction — so lookups by that id silently missed. Fixed by setting the id through `_initializeApplicationOptions`, the mechanism ApplicationV2 exposes for this.

## Internal
- Added the required GPLv3 license header to every `.js` and `.css` file.
- The `dh-colossus` CSS scoping class now comes from `MODULE_ID` instead of being repeated as a string literal in every Application's `DEFAULT_OPTIONS`.
- Centralized all Handlebars template paths in `scripts/constants.js` (`TEMPLATES`) instead of repeating `modules/dh-colossus/templates/...` literals across files.
- Replaced `_`-prefixed "private by convention" fields and methods with real `#private` class fields/methods (or renamed them) wherever they weren't overriding a documented ApplicationV2 lifecycle method — mainly in the Part Links Editor, the Colossus Sheet's drag-and-drop handlers, the Token HUD helpers, and Part Type Config's pending-edits state.

# 0.0.3

## Improvements
- Dropping an unlinked actor onto the principal or parts zone now shows a dialog offering to enable "Link Actor Data" automatically. Confirming updates the actor's prototype token and proceeds with the drop; declining shows the existing warning and cancels.

# 0.0.2

## Bug Fixes
- Fixed "Open" and "Delete" in the Colossus Manager failing to find an already-open sheet. `ui.windows` only tracks legacy ApplicationV1 instances; replaced with `foundry.applications.instances` throughout.

## Internal
- Created `scripts/constants.js` as the single source of truth for `MODULE_ID`, `DEFAULT_PART_TYPES`, and `DEFAULT_PART_IDS`. All files now import the constant instead of repeating the string literal.
- Eliminated duplicate default-part-ID list: `PartTypeConfig.DEFAULT_IDS` is now derived from `DEFAULT_PART_TYPES` in `constants.js`, preventing the two lists from drifting out of sync.
- Added `"dh-colossus"` to `DEFAULT_OPTIONS.classes` on all Application classes so the module-scoped CSS root is consistently present.
- Scoped `.colossus-icon-btn` CSS rule under `.dh-colossus` to prevent potential selector collisions with other modules.
- Moved CSS design-token variables to `.dh-colossus {}` so they are available to all module apps.
- `FilePicker` in the links editor now resolves via `.implementation` per the v14 API convention.
- Removed dead jQuery-normalization branch from the `renderTokenHUD` hook handler (v14 always passes `HTMLElement`).

