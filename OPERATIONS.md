# Scheduler Operations and Instructions

## Start Here

1. Run `test_DiagnosticDump` from `Dev / Test > Diagnostics`.
2. Run the appropriate verification function.
3. Review `decision_log` for pending decisions.
4. Apply only reviewed decisions.
5. Run the downstream stage only after its source is stable.

## Role-Based Routing Verification

`Mode_Config.TargetSeason` controls the active Import, Parent, and Lineup roles. The active mode name is not used to infer season routing.

1. Run `Diagnostic Dump` and confirm `Target Season` and the required `IMPORT*`, `PARENT*`, `LINEUP*`, `CREWCAL`, and `DRAFTCAL` roles are registered.
2. In `Draft 26-27`, run `Ingest Season`, `Explode Dates`, and `Sync Lineup to Crew Log`. Confirm the target tabs are `draft_import`, `draft_Parent`, `draft_Lineup`, and `Draft_Season_Log`.
3. In `Live 26-27`, repeat and confirm the target tabs are `import`, `Parent Lineup`, `Lineup`, and `Crew_Calendar_Log`.
4. Run both verification commands in each mode. Confirm newly created decision rows and `Audit_Log` links point to the active mode's physical Import or Parent tab.
5. Before applying a `MERGE_PARENT` decision, run `Refresh Decision Row Links`; confirm both links open the intended active-season Parent rows, then verify the selected keeper and duplicate IDs.

`Run Health Check` validates each physical sheet once even though the context stores both physical-name and SheetRole aliases. Remaining header findings should be reviewed against `Map_Registry` before any repair operation. `Repair Map Registry` modifies registry metadata; use `previewMapRegistryRepair(sheetName)` first when a finding is not already understood.

## Menu Organization

- `Diagnostics`: context and health checks.
- `Verification`: whole-sheet comparisons and calendar comparison.
- `Maintenance`: registry, headers, hashes, and dropdowns.
- `Decision Review`: pending review queue and approved decision processing.
- `Scheduler`: the short production pipeline.
- `Developer Overrides`: reserved for destructive reset/reinitialize operations with confirmation.

### 1. `📅 Scheduler` Menu (Production Pipeline)
- `1. Ingest Season` (`goParent`): CRUD `PARENTCURRENT` / `PARENTDRAFT` based on `IMPORTCURRENT` / `IMPORTDRAFT`.
- `2. Explode Dates` (`goLineup`): Parse `DatesAndTimes` to split Parent Events into individual show instances in `LINEUPCURRENT` / `LINEUPDRAFT`.
- `3. Sync Lineup to Crew Log` (`goCrewLog`): CRUD `Crew_Calendar_Log` / `Draft_Season_Log` based on Lineup.
- `4. Sync Calendars` (`goSync`): Apply reviewed decisions, then execute calendar sync pipeline.
- `Verify import vs Parent Lineup` (`goVerifyImportToParent`): Drift and duplicate detection between Import and Parent Lineup.
- `Verify Parent Lineup vs Lineup` (`goVerifyParentToLineup`): Date and venue verification between Parent Lineup and Lineup.
- `View Audit Log` (`openAuditLog`): Jump directly to the historical `Audit_Log` sheet.

The primary user interface is organized under the **Event Manager** menu:

### Ingest
- `goParent`: CRUD `PARENTCURRENT` / `PARENTDRAFT` based on `IMPORTCURRENT` / `IMPORTDRAFT`
- `goLineup`: parseDatesAndTimes to split Parent Events into individual show times
- `goCrewLog`: CRUD `Crew_Calendar_Log` / `Draft_Season_Log` based on `LINEUPCURRENT` / `LINEUPDRAFT`

### Planned Event Manager UI (Future Dialog / Sidebar)
As detailed in [UI-Design.md](UI-Design.md), a future consolidated **Event Manager** custom sidebar/dialog will provide:
- **Custom Sync Scoping:** UI controls to select specific date ranges, venues, or sheet roles.
- **Detailed Reporting Mode:** Log-only verification runs presented in an interactive summary modal.
- **Detailed Entity Inspection:** One-click popup inspecting full registry attributes for any row or ID.
- **Interactive Conflict Resolution:** Modal choices for location or timing conflicts.

### Sync
- `goSync(context)`: Execute sync based on provided context.
- `Run Custom Sync`: (Future UI Dialog) Execute sync with user-defined parameters. Current implementation is 'ControlPanel'
- `Report Mode`: `goSync("report")` - Perform a log-only verification pass.

### Navigation
- `Sheet options`: Access spreadsheet-specific navigation and settings.

### Sheet Management
- `Sheet Settings`: (Future UI) Edit active sheet settings.
- `Repair (active) Sheet`: Re-verify and repair the active sheet against the source of truth.
- `Reset (active?) Sheet`: Perform a destructive reset of the active sheet (requires confirmation).

## Header Direction

- `Read Sheet Headers into Registry`: physical sheet -> `Map_Registry`.
- `Repair Headers from Registry`: update only mismatched physical headers.
- `Write Headers from Registry`: registry -> physical sheets.
- `Reset Headers`: broader registry -> physical-sheet rewrite.

Protected sheets are skipped unless an explicit confirmation path is used.

Do not run `Refresh Dropdowns` until the `ref`-backed enum lookup work is complete. `Options` and other enum values are owned by `ref`, while the current dropdown loader reads `Lookup`; an empty source list could install an empty validation rule.

## Map_Registry Maintenance

`Repair Map Registry` (`Engine.Maintenance.repairMapRegistry()`) reconciles physical sheet headers against `Map_Registry`, but by design it is **non-destructive**:

- It will add new rows for unmapped physical columns, reunite a row with a moved column by matching `Field Name`, and update `Header DisplayName` to match reality.
- It will only **flag** a registry row as `[STALE: no matching column]` when the physical column is gone — it never deletes the row itself. If a physical column was intentionally removed (e.g. a temporary xlookup/helper column), deleting the now-stale registry row is a manual step. Until the auto-delete option described in `ROADMAP.md` exists, check the Audit_Log entry `MAP_REPAIR` after every repair pass for `Stale registry entry` lines and clean those up by hand.
- It **intentionally skips any sheet marked `Sheet_Settings.isProtected = Yes`** (`import`, `Lookup`, `Status`, `ref`). If those sheets accumulate duplicate or orphaned registry rows (e.g. a field that moved from `Lookup` to `ref`), that cleanup has to be done manually — it is not something a repair pass will ever touch.
- A `Field Name` must be unique within a sheet. Two rows with the same `Field Name` on the same sheet will silently collide in `assembleSheetMap()` — whichever row comes later in the registry wins, with no warning at runtime. This is easy to introduce by accident (e.g. copy-pasting a row for a temporary helper column) and easy to miss, since nothing errors; it just silently redirects every `ctx.getCol()`/`pCol()`/`lCol()` call for that field. Treat any duplicate `Field Name` within a sheet as a bug to fix immediately, not a cosmetic issue.

## decision_log Dropdown Validation

`decision_log`'s `Decision`, `RequestedAction`, `KeepChoice`, `ActionStatus`, `Confidence`, `SuggestedAction`, and `ReviewType` columns are dropdown-validated on the sheet, and their valid values are meant to track the vocabularies documented in `ROADMAP.md` (Decision Vocabulary / Status Vocabulary) and ultimately sourced from `ref.csv`. Since `decision_log` is a newer sheet, its `Map_Registry` `Data Type` entries for these fields were blank for a while, which made it easy for the sheet's actual dropdown lists to drift out of sync with the documented vocabulary without anything catching it. Periodically re-check the live dropdown validation rules on `decision_log` against `ref.csv` and `ROADMAP.md`, and correct whichever one is out of date.

## Verification

`Verify Import vs Parent Lineup` compares raw import data to Parent Lineup and may create pending decisions. It must not treat every Parent-only row as a duplicate.

**Matching uses the universal `Engine.IO.compare` primitive.** It applies `SL.Utils.normalize` with `collapse` + `fold` to text, so titles that look identical but differ by smart quotes, en/em dashes, or zero-width characters from the `IMPORTRANGE` round trip still match directly instead of falling through to the rename-candidate path. Map_Registry types control date behavior: `Date` compares the local calendar date, `Time` compares time-of-day, and `DateTime` compares the full timestamp. Calendar start comparisons explicitly use full timestamp equality. A row that is genuinely renamed (same Opening/Range/Venue, title still different after folding) is still flagged `Manual Review` with an `ACCEPT_IMPORT` decision — that is the intended path for placeholder→real-title changes (ROADMAP #9).

**Known open gap (issue #7):** a clean match today does nothing — a review status left by a prior run (e.g. `Data Drift Detected`) is not cleared, and the matching `IMPORT_PARENT` decision is not superseded, so a stale flag persists until a human resolves it. The heal-to-`Synced` + `markSuperseded` design is drafted for issue #7; do not treat "row stayed orange" as evidence of live drift until that lands.

`Verify Parent Lineup vs Lineup` compares parsed Parent Lineup dates and venues to Lineup rows using the same comparator. `Compare Draft Calendar vs Crew Log` likewise compares calendar title and full event start against the crew log.

Verification may update status and `LastSynced` when the current behavior allows it. `LOCKED` and `BYPASS` rows are not mutated, but detected differences are logged.

## Decision Workflow

`decision_log` is the editable review queue. `Audit_Log` is historical output.
`decision_log` acts strictly as an active to-do list.

* **Universal Hyperlinking:** `refreshLinks()` generates rich-text cell links for **all** review types (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`, `PARENT_DUPLICATE`) into `SourceLink` and `CandidateLink`.
* **Persistence:** Unresolved manual reviews (`PENDING`, `FAILED`) persist in `decision_log` across verification passes.
* **Applied rows:** When a review item is applied, the engine logs the event details to `Audit_Log` and immediately deletes the row from `decision_log`.
* **Superseded rows:** `Refresh Resolved Parent-Only Reviews` and `Refresh Stale Parent Duplicate Reviews` mark resolved items `SUPERSEDED` (with a reason in `ActionDetails`) but keep the row for reference. Use `Archive Superseded Decisions` to delete all `SUPERSEDED` rows from `decision_log` (each is logged to `Audit_Log` first).
* **`REVIEW_PARENT_ONLY` + `ACCEPT`:** a Parent-only review has no automatic mutation. Reviewing it `ACCEPT` (retain), `NOT_DUPLICATE` (retain as confirmed non-duplicate), or `REJECTED` (dropped) closes the decision and removes the row; there is no import row to copy from.
* **`REVIEW_IMPORT_DRIFT` / `ACCEPT_IMPORT`:** applies the import values over the Parent Lineup row. Requires the matching `import` row to still exist — if the import row was deleted upstream, the apply fails with "Import row could not be resolved" and the row stays `FAILED` for retry.

For a Parent-to-Parent duplicate, compare `ParentTitle` (the proposed keeper)
with `CandidateTitle` (the other Parent Lineup row). The source and candidate
row links open the corresponding rows for the full field-level comparison.

For an ordinary import update:

```text
Decision: ACCEPT
RequestedAction: ACCEPT_IMPORT
ActionStatus: PENDING
```

For a confirmed Parent duplicate:

```text
Decision: ACCEPT or CONFIRMED_DUPLICATE
RequestedAction: MERGE_PARENT
KeepParentID: <selected keeper>
DuplicateParentID: <selected duplicate>
ActionStatus: PENDING
```

`Apply Reviewed Decisions (Includes Merges)` is the only normal queue-processing
command. It preserves `KeepParentID` as the stable identity. For an accepted
duplicate, `DuplicateParentID` is the source-data row: its title, dates, range,
venue, and other source-managed values replace the retained row's values before
downstream references are repointed and the duplicate Parent row is deleted.

After Parent duplicates are reconciled, run `Refresh Resolved Parent-Only
Reviews`. It marks historical `PARENT_ONLY` rows as `SUPERSEDED` when their
surviving Parent row now matches import. A Parent-only review never merges an
import row: an exact import match is reviewed as `ACCEPT_IMPORT`; otherwise it
remains a non-mutating `REVIEW_PARENT_ONLY` item.

Before applying an older queue, run `Refresh Stale Parent Duplicate Reviews`.
It supersedes duplicate decisions whose two Parent rows are no longer present
or no longer share an opening date and venue. Generate new duplicate suggestions
only after that refresh.

For a false match:

```text
Decision: NOT_DUPLICATE
RequestedAction: REJECT_MATCH
ActionStatus: PENDING
```

Run `Apply Reviewed Decisions` only after checking IDs and notes. Successful or explicitly rejected rows are copied to `Audit_Log` with their decision and action details, then removed from `decision_log`. Deferred, incomplete, and failed rows remain in `decision_log` so they can be revisited, corrected, or retried.

The `Scheduler > 4. Sync Calendars` command applies reviewed decisions first, then runs the sync pipeline. Individual sync test wrappers do not automatically apply decisions unless they explicitly pass `runtime.applyDecisions: true`.

## Calendar Controls

Development wrappers must use `allowCalendarWrites: false`. Use pull-only or reconcile-only tests before enabling writes.

`Crew_Calendar_Log.EventID` identifies the Google Calendar event. `UUID` identifies the associated Lineup/Crew row. `Venue_Cal_Log.EventID` identifies the venue event; its `UUID` is the explicit cross-sheet association.

## Recovery

If a destructive reset is required, use a Developer Override after confirming the target sheet, operation, and row count. Do not use ordinary sync or verification functions as reset tools.
## Parent Lineup Manual Action Handling

Users can set operational statuses in `Parent Lineup` to dictate engine behavior during `ingest` and `verify` runs:

* **`Bypassed`:** The engine completely skips this row during drift and duplicate checks. No `decision_log` items will be generated.
* **`Delete Pending`:** `Ingest Season` (`goParent`) removes the row from `Parent Lineup`, supersedes any `decision_log` items referencing that `parentID`, and writes a `DELETE_PENDING_APPLIED` audit entry. The run summary reports `deletedPending`.
* **`Possible Duplicate`:** The `verify` script explicitly scans this row against `Parent Lineup` and `import`. If a match is found, it creates a `PARENT_DUPLICATE` task. If no automated match is found, it generates a `REVIEW_PARENT_ONLY` task with the note: *"Flagged as Possible Duplicate by user, but no automated match found."*

## Season Promotion Protocol (Role Swapping)

To promote a Draft season to Current season without copying data:

1. Update `Sheet_Settings` roles for current tabs (e.g., change `IMPORTCURRENT` to `IMPORT_25_26`).
2. Reassign draft tabs in `Sheet_Settings` to active roles (e.g., change `IMPORTDRAFT` to `IMPORTCURRENT`).
3. Provision new blank draft tabs in Sheets, register their GIDs in `Sheet_Settings`, and assign roles `IMPORTDRAFT`, `PARENTDRAFT`, and `LINEUPDRAFT`.
