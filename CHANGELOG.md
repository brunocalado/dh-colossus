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

