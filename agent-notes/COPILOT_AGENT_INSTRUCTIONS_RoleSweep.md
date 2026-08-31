# Copilot Agent Instructions: Role-Based Sheet Access Sweep

**Closes:** GitHub Issue #1 ("Confirm Role-Based Sheet Access")
**Depends on:** `Mode_Config` sheet already has a `TargetSeason` column (Draft / Current)
per row — confirm this exists before starting Part 1.

## Summary

Three parts, in order:

1. Add two new primitives to `engine_core.js` (`Engine.getSheetByRole`,
   `Engine.getSeasonSheet`) and teach `loadModeConfig()` / `Engine.Roles.resolve()`
   to read `TargetSeason` instead of regexing the mode's display name.
2. Sweep every hardcoded `ss.getSheetByName("literal")` call in the ingest,
   decisions, and dropdown-maintenance code to use those primitives instead.
3. (Optional, lower risk) Clean up a handful of redundant `getSheetByName()` calls
   for sheets that are already loaded in `ctx` but don't have draft counterparts.

**Do not touch** the files/functions listed under "Explicitly out of scope" at the
bottom — they're either bootstrapping code that has to run before the role map
exists, or self-referential registry-repair tools.

---

## Part 1 — `engine_core.js`: new primitives

### 1a. Extend `loadModeConfig()` to read `TargetSeason`

Find the block of `getIdx(...)` calls in `loadModeConfig`:

```js
    const modeNameIdx = getIdx(["mode name", "mode", "mode_name"]);
    const isActiveIdx = getIdx(["isactive", "active", "is active"]);
```

Add one more line immediately after:

```js
    const modeNameIdx = getIdx(["mode name", "mode", "mode_name"]);
    const isActiveIdx = getIdx(["isactive", "active", "is active"]);
    const targetSeasonIdx = getIdx(["targetseason", "target_season", "target season"]);
```

Then find where the `mode` object literal is built:

```js
      const mode = {
        mode: modeName,
        syncMode: syncMode,
```

Add `targetSeason` as a field:

```js
      const mode = {
        mode: modeName,
        targetSeason: targetSeasonIdx !== -1 ? String(row[targetSeasonIdx] || "Current").trim() : "Current",
        syncMode: syncMode,
```

Also add a default in `getDefaultMode()`:

```js
  getDefaultMode: function() {
    return {
      mode: "Draft 26-27",
      targetSeason: "Draft",
      syncMode: "",
```

### 1b. Rewrite `Engine.Roles.resolve()`

Replace the entire block:

```js
Engine.Roles = {
  resolve: function(ctx, base) { 
  // base: "PARENT" | "LINEUP" | "IMPORT"
  const isDraft = /draft/i.test(ctx.mode.mode || "");
  return Engine.Roles[base] + (isDraft ? "DRAFT" : "CURRENT");
  }
};
```

with:

```js
Engine.Roles = {
  /**
   * Resolves a season-paired base ("IMPORT" | "PARENT" | "LINEUP") into the
   * concrete SheetRole for the active mode's TargetSeason. Returns null (and
   * logs) if the resulting role isn't registered in ctx.roles — callers should
   * treat null as "not found" the same way ctx.getRole() already does.
   *
   * NOTE: this only covers the three sheets that are genuinely the same layer
   * split by season. It intentionally does NOT cover CREWCAL/DRAFTCAL/VENUECAL —
   * those are purpose-distinct destinations, not a draft/current pair of the
   * same sheet. See syncLineupToLog() and applyDropdowns() for how those pick
   * their target role instead.
   */
  resolve: function(ctx, base) {
    const season = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase();
    const suffix = season === "DRAFT" ? "DRAFT" : "CURRENT";
    const role = base + suffix;
    if (!ctx.roles[role]) {
      console.error(`Engine.Roles.resolve("${base}") produced unknown role "${role}" (TargetSeason="${season}") — check Sheet_Settings.`);
      return null;
    }
    return role;
  }
};
```

### 1c. Add `Engine.getSheetByRole` and `Engine.getSeasonSheet`

Add these two functions to `engine_core.js`, near the bottom of the file, after
the `Engine.Roles` block:

```js
/**
 * Resolves any SheetRole (season-paired or not) directly to its Sheet object.
 * Returns null and logs (does not throw) on failure, matching ctx.getRole()'s
 * existing convention — callers keep their existing null-checks.
 */
Engine.getSheetByRole = function(ctx, role) {
  const sheetName = ctx.getRole(role); // already logs "Role missing!" on failure
  if (!sheetName) return null;
  const sheet = ctx.ss.getSheetByName(sheetName);
  if (!sheet) {
    console.error(`Sheet "${sheetName}" (role "${role}") not found in spreadsheet.`);
    return null;
  }
  return sheet;
};

/**
 * Convenience wrapper for the three season-paired layers: resolves the base
 * ("IMPORT" | "PARENT" | "LINEUP") against the active mode's TargetSeason and
 * returns the Sheet object directly.
 */
Engine.getSeasonSheet = function(ctx, base) {
  const role = Engine.Roles.resolve(ctx, base);
  return role ? Engine.getSheetByRole(ctx, role) : null;
};
```

### 1d. Update the existing global `getSheetByRole()` in `engine_maintenance.js`

This function is used interactively (script editor / menu-adjacent), and its
existing contract is to throw on failure. Keep that contract, but delegate to
the new graceful `Engine.getSheetByRole`:

Find:

```js
function getSheetByRole(roleName) {
  const ctx = Engine.getContext();
  const sheetName = ctx.getRole(roleName);
  if (!sheetName) throw new Error(`No sheet found for role "${roleName}"`);
  const sheet = ctx.ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" (role "${roleName}") not found in spreadsheet`);
  return sheet;
}
```

Replace with:

```js
function getSheetByRole(roleName) {
  const ctx = Engine.getContext();
  const sheet = Engine.getSheetByRole(ctx, roleName);
  if (!sheet) throw new Error(`No sheet found for role "${roleName}"`);
  return sheet;
}
```

---

## Part 2 — Call-site sweep (the "Critical" list from Issue #1)

For every change below: resolve the role once near the top of the function,
reuse the resolved role/sheet variable for the rest of the function body
(don't re-resolve mid-function), and keep each function's existing null-check /
early-return behavior — `Engine.getSeasonSheet`/`Engine.getSheetByRole` return
`null` on failure, they don't throw, so existing `if (!xSheet) { ... return; }`
guards keep working unchanged.

### `engine_ingest.js` — `goParent()`

Find:

```js
  const ss = ctx.ss;
  const iSheet = ss.getSheetByName("import");
  const pSheet = ss.getSheetByName("Parent Lineup");
 
  if (!iSheet || !pSheet) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Import or Parent Lineup sheet not found.", "Error");
    return;
  }
 
  const iMap = ctx.getMap("import");
  const pMap = ctx.getMap("Parent Lineup");
```

Replace with:

```js
  const ss = ctx.ss;
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
 
  if (!iSheet || !pSheet) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Import or Parent Lineup sheet not found for the active mode's target season.", "Error");
    return;
  }
 
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
```

### `engine_ingest.js` — `Engine.Ingest._writeParentIdentity()`

Find:

```js
  if (generated && generated.hash) ctx.ss.getSheetByName("Parent Lineup").getRange(rowNumber, hashCol + 1).setValue(generated.hash);
```

Replace with:

```js
  const pSheet = Engine.getSeasonSheet(ctx, "PARENT");
  if (generated && generated.hash && pSheet) pSheet.getRange(rowNumber, hashCol + 1).setValue(generated.hash);
```

### `engine_ingest.js` — `Engine.Ingest.resolveParentDuplicates()`

Find:

```js
  const sheet = ctx.ss.getSheetByName("Parent Lineup");
  const map = ctx.getMap("Parent Lineup");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const sheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const map = ctx.getMap(pRole);
```

### `engine_ingest.js` — `Engine.Ingest.buildParentDuplicateSuggestions()`

Same pattern — find:

```js
  const sheet = ctx.ss.getSheetByName("Parent Lineup");
  const map = ctx.getMap("Parent Lineup");
  if (!sheet || !map) return { created: 0, suggested: 0 };
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const sheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const map = ctx.getMap(pRole);
  if (!sheet || !map) return { created: 0, suggested: 0 };
```

### `engine_ingest.js` — `Engine.Ingest.buildParentOnlyReplacementSuggestions()`

Find:

```js
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
```

### `engine_ingest.js` — `Engine.Ingest.applyConfirmedParentMerges()`

`decision_log` has no draft counterpart — use `Engine.getSheetByRole` directly,
not `Engine.getSeasonSheet`. Find:

```js
  const decisionSheet = ctx.ss.getSheetByName("decision_log");
```

Replace with:

```js
  const decisionSheet = Engine.getSheetByRole(ctx, "DECISIONS");
```

### `engine_ingest.js` — `Engine.Ingest.mergeParentDuplicate()`

Find:

```js
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map not found");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map not found for the active mode's target season");
```

Later in the same function, find the cross-sheet parentID repoint loop:

```js
  const changedLocations = [];
  Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
    const map = ctx.getMap(sheetName);
    const sheet = ctx.ss.getSheetByName(sheetName);
    const col = Engine.getColumnIndex(map, "parentID");
    if (!sheet || col < 0 || sheetName === "Parent Lineup") return;
```

Replace the skip condition so it compares sheet objects instead of a literal
name (this loop already iterates all sheets dynamically — this is the one line
in it that assumed a fixed name):

```js
  const changedLocations = [];
  Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
    const map = ctx.getMap(sheetName);
    const sheet = ctx.ss.getSheetByName(sheetName);
    const col = Engine.getColumnIndex(map, "parentID");
    if (!sheet || col < 0 || sheet === parentSheet) return;
```

### `engine_ingest.js` — `goLineup()`

Already calls `Engine.Roles.resolve()` — no change needed here once Part 1 is
done, other than confirming it now resolves correctly. Do not modify this
function's body.

### `engine_ingest.js` — `Engine.Ingest.syncLineupToLog()`

Find:

```js
Engine.Ingest.syncLineupToLog = function(ctx, options) {
  options = options || {};
  const targetRole = options.targetRole || "CREWCAL"; // <-- swap default here once Draft Season sheet/role exists

  const lSheet = ctx.ss.getSheetByName("Lineup");
  const lMap = ctx.maps["Lineup"];
```

Replace with:

```js
Engine.Ingest.syncLineupToLog = function(ctx, options) {
  options = options || {};
  // CREWCAL/DRAFTCAL are purpose-distinct destinations, not a season pair of one
  // sheet (see Engine.Roles.resolve() doc comment) — routed here explicitly
  // rather than through Engine.Roles.resolve().
  const isDraftSeason = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase() === "DRAFT";
  const targetRole = options.targetRole || (isDraftSeason ? "DRAFTCAL" : "CREWCAL");

  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
  const lMap = ctx.getMap(lRole);
```

### `engine_ingest.js` — `Engine.Ingest._reparseDateFromParent()`

Find:

```js
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const pMap = ctx.maps["Parent Lineup"];
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const pMap = ctx.getMap(pRole);
```

### `engine_ingest.js` — `Engine.Ingest.verifyImportToParent()`

Find:

```js
  const iSheet = ctx.ss.getSheetByName("import");
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const iMap = ctx.maps["import"];
  const pMap = ctx.maps["Parent Lineup"];
```

Replace with:

```js
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
```

### `engine_ingest.js` — `Engine.Ingest.refreshParentOnlyDecisions()`

Find:

```js
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const importSheet = ctx.ss.getSheetByName("import");
  const parentMap = ctx.getMap("Parent Lineup");
  const importMap = ctx.getMap("import");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const importSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const parentMap = ctx.getMap(pRole);
  const importMap = ctx.getMap(iRole);
```

### `engine_ingest.js` — `Engine.Ingest.refreshParentDuplicateDecisions()`

Find:

```js
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map is missing");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map is missing for the active mode's target season");
```

### `engine_ingest.js` — `Engine.Ingest.verifyParentToLineup()`

Find:

```js
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const lSheet = ctx.ss.getSheetByName("Lineup");
  const pMap = ctx.maps["Parent Lineup"];
  const lMap = ctx.maps["Lineup"];
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
  const pMap = ctx.getMap(pRole);
  const lMap = ctx.getMap(lRole);
```

### `engine_ingest.js` — `Engine.Ingest.acceptImportDrift()`

Find:

```js
  const iSheet = ss.getSheetByName("import");
  const pSheet = ss.getSheetByName("Parent Lineup");
  const iMap = ctx.getMap("import");
  const pMap = ctx.getMap("Parent Lineup");
```

Replace with:

```js
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
```

### `engine_ingest.js` — `acceptAllFlaggedDrift()`

Find:

```js
  const pSheet = ss.getSheetByName("Parent Lineup");
  const pMap = ctx.getMap("Parent Lineup");
```

Replace with:

```js
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const pMap = ctx.getMap(pRole);
```

### `engine_decisions.js` — `ensureComparisonColumns()`

Find:

```js
    const sheet = ctx.ss.getSheetByName("decision_log");
```

Replace with:

```js
    const sheet = Engine.getSheetByRole(ctx, "DECISIONS");
```

### `engine_decisions.js` — `ensureSchema()`

Find:

```js
    const sheet = ctx.ss.getSheetByName("decision_log");
    this.ensureComparisonColumns(ctx);
```

Replace with:

```js
    const sheet = Engine.getSheetByRole(ctx, "DECISIONS");
    this.ensureComparisonColumns(ctx);
```

### `engine_decisions.js` — `refreshLinks()` → `resolveParentRow()`

Find:

```js
    const resolveParentRow = parentID => {
      const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
      const parentMap = ctx.getMap("Parent Lineup");
```

Replace with:

```js
    const resolveParentRow = parentID => {
      const pRole = Engine.Roles.resolve(ctx, "PARENT");
      const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
      const parentMap = ctx.getMap(pRole);
```

### `engine_maintenance.js` — `applyDropdowns()`

Find:

```js
  applyDropdowns: function(ctx) {
    const ss = ctx.ss;
    const lookupSheet = ss.getSheetByName("Lookup");
    const lMap = ctx.maps["Lookup"];
    if (!lookupSheet || !lMap) return;
```

Replace with:

```js
  applyDropdowns: function(ctx) {
    const ss = ctx.ss;
    const lookupSheet = Engine.getSheetByRole(ctx, "LOOKUP");
    const lMap = ctx.getMap("LOOKUP");
    if (!lookupSheet || !lMap) return;
```

Then find the write-targets block:

```js
    const targets = {
      "Lineup": {
        "Venue": venueList
      },
      "Crew_Calendar_Log": {
        "Location": venueList,
        "Options": optionsList
      }
    };

    for (const [sheetName, config] of Object.entries(targets)) {
      const targetSheet = ss.getSheetByName(sheetName);
      const targetMap = ctx.maps[sheetName];
      if (!targetSheet || !targetMap) continue;
```

Replace with:

```js
    const lineupRole = Engine.Roles.resolve(ctx, "LINEUP");
    // CREWCAL/DRAFTCAL are purpose-distinct, not a season pair — same routing
    // rule as Engine.Ingest.syncLineupToLog().
    const isDraftSeason = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase() === "DRAFT";
    const logRole = isDraftSeason ? "DRAFTCAL" : "CREWCAL";

    const targets = {};
    if (lineupRole) targets[lineupRole] = { "Venue": venueList };
    targets[logRole] = { "Location": venueList, "Options": optionsList };

    for (const [role, config] of Object.entries(targets)) {
      const targetSheet = Engine.getSheetByRole(ctx, role);
      const targetMap = ctx.getMap(role);
      if (!targetSheet || !targetMap) continue;
```

---

## Part 3 (optional, lower risk) — redundant re-fetch cleanup

These sheets don't have draft counterparts, so this isn't a correctness bug —
just replacing a re-query with the already-loaded `ctx` reference. Safe to skip
this part in a first pass if you want to keep the PR smaller; do it as a
follow-up commit if so.

### `engine_core.js` — `loadLookups()`

Find:

```js
    const calSheet = ss.getSheetByName("Calendars");
```

Replace with:

```js
    const calSheet = ctx.sheets["Calendars"] || ss.getSheetByName("Calendars");
```

Find:

```js
    const listSheet = ss.getSheetByName("Lookup");
```

Replace with:

```js
    const listSheet = ctx.sheets["Lookup"] || ss.getSheetByName("Lookup");
```

### `engine_core.js` — `loadBypassList()`

Find:

```js
  loadBypassList: function(ctx) {
    const sheet = ctx.ss.getSheetByName("idLog");
```

Replace with:

```js
  loadBypassList: function(ctx) {
    const sheet = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
```

### `engine_core.js` — `loadRegistry()`

Find:

```js
  loadRegistry: function(ctx) {
    const sheet = ctx.ss.getSheetByName("idLog");
```

Replace with:

```js
  loadRegistry: function(ctx) {
    const sheet = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
```

### `engine_core.js` — `Log.write()`

Find:

```js
    write: function(ctx, params) {
      const auditSheet = ctx.ss.getSheetByName("Audit_Log"); 
```

Replace with:

```js
    write: function(ctx, params) {
      const auditSheet = ctx.sheets.AUDIT || ctx.ss.getSheetByName("Audit_Log");
```

### `config.js` — `getUIFriendlySchema()`

Find:

```js
  const ctx = Engine.getContext();
  const map = ctx.maps[sheetName];
  const registrySheet = ctx.ss.getSheetByName("Map_Registry");
```

Replace with:

```js
  const ctx = Engine.getContext();
  const map = ctx.maps[sheetName];
  const registrySheet = ctx.sheets.REGISTRY || ctx.ss.getSheetByName("Map_Registry");
```

---

## Explicitly out of scope — do not modify

**Bootstrap/self-referential (must stay hardcoded — they run before the role
map exists, or they build it):**
- `engine_core.js` — `assembleSheetMap()`, `loadModeConfig()`, `loadConfig()`,
  `loadControlPanelSettings()`, `loadStatusRules()`
- `engine_maintenance.js` — `repairMapRegistry()`, `deleteRegistry()`
- `config.js` — `setControlPanelValue()`, `runSystemHealthCheck()`

**Low-blast-radius UI helpers (fine as literal jumps, not part of this issue):**
- `0_OnOpen.js` — `openAuditLog()`
- `engine_decisions.js` — `openDecisionLog()`

**Dead/legacy, not wired to any menu — flagged for a future cleanup pass, not
this one:**
- `0_helper.js` — `getParentData()`, `getChildData()`, `getRowByUuid()`,
  `getCrewCall()`
- `UI_helper.js` — `findIdAndJump()`

**`Venue_Cal_Log` / `VENUECAL`:** not touched by this sweep. Per the design
discussion, its relationship to `Draft_Season_Log`/`Crew_Calendar_Log` is about
to change (Lineup UUID associations, potential `Delete Pending` transitions) —
that's its own future issue, not a role-resolution bug.

---

## Testing checklist (run after applying all of Part 1 and Part 2)

1. `test_DiagnosticDump` — confirm it still runs clean.
2. `goHealthCheck` — confirm no new header/mapping errors.
3. With `Mode_Config` active mode set to **Draft 26-27** (`TargetSeason = Draft`):
   - Run `goParent` — confirm it reads/writes `draft_import` / `draft_Parent`,
     **not** `import` / `Parent Lineup`.
   - Run `goLineup` — confirm it no longer alerts "sheet/map not found" and
     writes to `draft_Lineup`.
   - Run `goCrewLog` — confirm it writes to `Draft_Season_Log`, not
     `Crew_Calendar_Log`.
4. Switch active mode to **Live 26-27** (`TargetSeason = Current`) and repeat
   step 3 — confirm the same three functions now target `import` /
   `Parent Lineup` / `Lineup` / `Crew_Calendar_Log` instead.
5. Run `Refresh Dropdowns` (`test_RefreshDropdowns`) in both modes — confirm
   dropdown validation gets applied to `Lineup`/`Crew_Calendar_Log` in Live
   mode and `draft_Lineup`/`Draft_Season_Log` in Draft mode.
6. Run `Apply Reviewed Decisions` in a mode with at least one pending
   `MERGE_PARENT` decision — confirm `mergeParentDuplicate()` still correctly
   skips the keeper row when repointing `parentID` across sheets.
