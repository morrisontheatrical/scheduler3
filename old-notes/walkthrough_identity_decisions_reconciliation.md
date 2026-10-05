# Walkthrough: Identity, Decisions, and Reconciliation Pipeline

**Issues Closed / Addressed**:
- [Issue #4: Fully Implement the idLog Alias & Cascading Merger Flow](https://github.com/morrisontheatrical/scheduler3/issues/4)
- [Issue #7: decision_log Queue Purge and Decision History](https://github.com/morrisontheatrical/scheduler3/issues/7)
- [Issue #13: Parent Lineup -> Lineup -> Calendar Reconciliation](https://github.com/morrisontheatrical/scheduler3/issues/13)

---

## 1. Accomplishments by Component

### A. Identity & Aliasing (`idLog` & Cascading Mergers — #4, #28)
- **`engine_IDService.js`**:
  - Standardized column lookups to safely recognize `Fingerprint` (the canonical column) while gracefully falling back to `SyncHash` if unmigrated, preventing range index crashes.
  - Implemented `Engine.IDService.applyLinks(ctx)` to automatically write hyperlinked formulas (`=HYPERLINK(...)`) for `UniqueID` (linking directly to source location `Sheet!R...`) and `ParentID` (linking directly to the parent show in `Parent Lineup`).
  - Automatically invokes `applyLinks()` at the end of `syncAll()`.
- **`engine_core.js` & `engine_sync.js`**:
  - `loadRegistry()` and `ctx.registry` now load `Fingerprint` / `SyncHash` safely, and read the `MergedIDs` alias column.
- **`engine_ingest.js` (`mergeParentDuplicate`)**:
  - Survivor parent row in `idLog` receives the duplicate ID appended to `MergedIDs` (comma-separated, deduplicated).
  - Duplicate parent row in `idLog` is marked `SyncStatus = "Merged"`, with `LogDetails = "Merged into ParentID <keepParentID>"`.
  - Cascading updates systematically repoint `parentID` across all child sheets: `Lineup`, `draft_Lineup`, `Crew_Calendar_Log`, `Draft_Season_Log`, `Venue_Cal_Log`, and `Calls`.
  - Scans `decision_log` for active decisions referencing the duplicate ID and repoints them to the survivor (`ExistingParentID`, `CandidateID`, `KeepParentID`, `DuplicateParentID`), logging `DECISION_REPOINTED` to `Audit_Log`.

---

### B. Decision Queue Lifecycle & History Rules (#7)
- **`engine_decisions.js`**:
  - **`Engine.Decisions.stableReviewID(type, sourceId, candidateId, evidenceKey)`**: Generates deterministic, content-derived Review IDs via `SL.Identity._hashString` (with MD5 fallback). A reflow of the import sheet produces the identical ID, preventing duplicate queue items.
  - **`Engine.Decisions.formatEvidence(comparison)`**: Standardizes formatted comparison evidence (`field: source="val" | dest="val"`).
  - **`refreshLinks(ctx)`**: Extended to resolve rows in `import` / `draft_import`, creating clickable hyperlinks for `SourceID` and `ImportTitle` as well as Parent Lineup rows.
  - **`applyPending(ctx)`**: Added support for new requested actions `SYNC_PARENT_TO_LINEUP` and `EXPLODE_LINEUP`. Enforces immediate deletion of applied/rejected queue rows and logging to `Audit_Log` (with `ReviewID`).
- **`engine_ingest.js` (`verifyImportToParent`)**:
  - Replaced volatile row-number Review IDs with stable, content-derived Review IDs.
  - **Clean-Match Healing**: When a Parent row matches import cleanly (`comparison.equal === true`), any diagnostic status (`Manual Review`, `Data Drift Detected`) is healed back to `Synced`, and active pending drift decisions for that ID are marked `SUPERSEDED`.
  - Protected user overrides: `blocksWrite` continues to protect user locks from automatic status changes.

---

### C. Parent → Lineup → Calendar Reconciliation (#13)
- **`engine_ingest.js` (`verifyParentToLineup`)**:
  - Emits structured `PARENT_LINEUP_DRIFT` decisions to `decision_log` with stable Review IDs and full evidence.
  - **Clean-Match Healing**: Heals Lineup performance status from `Manual Review` back to `Synced` when dates/venue match Parent, superseding corresponding drift decisions.
  - **Missing Performances**: Detects when Parent `DatesAndTimes` has more performances than Lineup rows, queueing `LINEUP_MISSING_PERFORMANCE` (`EXPLODE_LINEUP`).
  - **Orphan Detection & Auto-Repointing**: Detects Lineup rows referencing defunct Parent IDs. If the ID is found in `idLog.MergedIDs`, it auto-repoints the Lineup row to the survivor and logs `PARENT_REPOINTED`. If genuinely orphaned, queues `LINEUP_ORPHAN`.
- **`engine_ingest.js` (`refreshRelevantDecisions`)**:
  - Unified command combining `refreshParentOnlyDecisions`, `refreshParentDuplicateDecisions`, and Lineup drift cleanup into a single pass.
- **`engine_sync.js` (`verifyLineupToCrewLog`)**:
  - Added verification between `Lineup` and `Crew_Calendar_Log` (or `Draft_Season_Log`). Detects missing calendar performances (`CREWLOG_MISSING`), date/venue drift, and orphaned calendar rows.

---

### D. Menus & Diagnostics (`0_OnOpen.js` & `0_temp.js`)
- Added menu actions:
  - **Diagnostics**: `Refresh ID Registry Links` (`refreshIDRegistryLinks`)
  - **Verification**: `Verify Lineup vs Crew Log` (`verifyLineupToCrewLog`)
  - **Decision Review**: `Refresh Stale Reviews (All Categories)` (`refreshRelevantDecisions`)
- Added test harness in `0_temp.js`:
  - `test_StableReviewID()`: Verifies stability of hash across identical reflows, assert uniqueness across different evidence, and validates evidence string formatting.

---

## 2. Verification Results

### Automated Tests
- Syntax check passed for all workspace files:
  ```bash
  node -c *.js # Exit code 0
  ```
- Stable Review ID & Evidence test executed via Node:
  ```
  ID 1: IMPORT_DRIFT_Hamlet_P-12345_BKFgarj9
  ID 2: IMPORT_DRIFT_Hamlet_P-12345_BKFgarj9
  ID 3: IMPORT_DRIFT_Hamlet_P-12345_LIKcoWOd
  Evidence: Venue: source="Main Stage" | dest="Studio" | Range: source="Jan 1 - 5" | dest="Jan 2 - 6"
  ```
  *(Identical payload produced identical ID; changed payload produced unique ID; evidence formatted correctly.)*

---

## 3. Recommended Manual Verification in Google Sheets

1. **Test ID Registry Hyperlinks**:
   - Run `Dev / Test -> Diagnostics -> Refresh ID Registry Links`.
   - Confirm `UniqueID` cells link to their exact source sheet cell, and `ParentID` cells link to `Parent Lineup`.
2. **Test Merged-ID Cascade**:
   - In `decision_log`, select `CONFIRMED_DUPLICATE` on a Parent pair and click `Apply Reviewed Decisions`.
   - Verify duplicate parent is deleted from `Parent Lineup`, survivor's `MergedIDs` cell in `idLog` contains the old ID, dependent rows in `Lineup` / `Crew_Calendar_Log` are updated, and open decisions pointing to the old ID are repointed.
3. **Test Clean-Match Healing**:
   - Run `Verify import vs Parent Lineup`.
   - Accept or correct a drifted field in `Parent Lineup` to match `import`.
   - Re-run `Verify import vs Parent Lineup` (or `Refresh Stale Reviews`).
   - Confirm status resets to `Synced` and the old decision is marked `SUPERSEDED`.
