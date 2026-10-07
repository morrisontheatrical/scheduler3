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

## Controlled Reconciliation and Identity Checks

Use a disposable workbook copy for any flow that writes rows, IDs, statuses, or decisions. Keep calendar writes disabled. Do not close issues #1, #4, #7, #8, #10, #13, #24, #25, or #28 until their relevant checks have been completed in both Draft and Current modes and the results recorded on the issue.

1. In **Dev / Test > Diagnostics**, run `Test Theatrical Date Parsing`; confirm representative complex date strings parse, spans retain their intended end date, and invalid input is reported.
2. In the disposable copy, run `Ingest Season`, then `Explode Dates`. Check that each Parent event's Lineup instances retain stable UUIDs on repeat runs and that new/updated rows populate `EventOfTotal`, `EndDate`, `AfterToday`, `WithinQuarter`, `WithinMonth`, `SyncStatus`, and `LastUpdated`.
3. Run `Verify Parent Lineup vs Lineup`. Confirm title/series/date/venue drift and missing/orphan rows create review items without silently applying field updates. Verify a clean match supersedes the corresponding drift review and an unresolved manual action is not overwritten.
4. Run `Sync Lineup to Crew Log` and `Reconcile Logs`. Check UUID associations, titles, dates, start/end times, locations, multi-day `EndDate`, missing crew-log decisions, drift decisions, and orphan reporting. Confirm Draft routes to `Draft_Season_Log` and Current routes to `Crew_Calendar_Log`.
5. In the controlled copy, approve a `CREWLOG_MISSING` or `LINEUP_CREW_DRIFT` review by setting `Decision=ACCEPT`, then run `Apply Reviewed Decisions`. Confirm exactly one active-season row matches the Lineup UUID and the decision is recorded in `Audit_Log`. Confirm a `Delete Pending` Lineup row is not pushed, and a locked/bypassed row remains unchanged.
6. For merge/delete paths, first run `Preview Approved Deletes` or `Preview Lineup Delete Pending`. In the controlled copy only, check snapshots and registry lineage after applying a reviewed operation; confirm the keeper ID remains stable and pending decisions are repointed or superseded as expected.
7. Run `Sync ID Registry`. Confirm `Fingerprint` snapshots, `Merged IDs`, current `SheetLocation`, and idLog links refer to the intended rows after the log sheets are sorted.
8. Run `Lookup List Diagnostics`. Confirm `Venue`, `CrewStaff`, and `CallType` report `LOOKUP` as source and enum lists such as `Options` report `REFRULES`, with nonzero counts for every list that should drive a dropdown. Then run **Maintenance > Refresh Dropdowns** and verify the expected validations; any skipped empty list should be investigated in `Audit_Log`, not replaced with an empty validation.
9. Run `Refresh Decision Row Links` and verify Import→Parent, Parent-only, and Parent-duplicate links. Treat links for newer Lineup/Crew review types, Audit_Log-to-decision references, and the broad Calls/calendar-log associations as unfinished until their scope is implemented and checked.

## Menu Organization

- `Diagnostics`: context, health, and lookup-list checks.
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

New Lineup performances receive readable `<parentID>-C##` UUIDs. Existing IDs,
including random UUIDs from earlier runs, are not rewritten.

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

`Refresh Dropdowns` reads `Venue`, `CrewStaff`, and `CallType` from the `LOOKUP` role and shared enum lists such as `Options` from `REFRULES`. Run **Lookup List Diagnostics** first when checking a new or changed registry mapping. Empty lists are skipped and logged; verify the source data rather than attempting to refresh an empty dropdown.

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

**Clean matches heal stale flags:** a clean import match resets `Manual Review` / `Data Drift Detected` rows to `Synced` and supersedes the matching `IMPORT_DRIFT` / `IMPORT_RENAME` decisions. Every clean, non-blocked match also stamps `LastSynced`, so active rows show the date of the last verification pass. Parent-to-Lineup verification likewise supersedes `PARENT_LINEUP_DRIFT` reviews for any Lineup performance that now matches, regardless of its current status.

`Verify Parent Lineup vs Lineup` compares parsed Parent Lineup dates and venues to Lineup rows using the same comparator. It ignores Lineup rows marked `Delete Pending` or carrying a `BYPASS` status behavior while aligning each Parent schedule occurrence to its Lineup row; pending removals must not shift the date comparison for remaining performances. The Lineup `Date` field compares by calendar day, not hidden fractional-time precision. `Compare Draft Calendar vs Crew Log` likewise compares calendar title and full event start against the crew log.

Verification may update status and `LastSynced` when the current behavior allows it. `LOCKED` and `BYPASS` rows are not mutated, but detected differences are logged.

## Decision Workflow

`decision_log` is the editable review queue. `Audit_Log` is historical output.
`decision_log` acts strictly as an active to-do list.

* **Decision-row links:** `refreshLinks()` generates links for Import→Parent, Parent-only, and Parent-duplicate reviews into `SourceLink` and `CandidateLink`. New Lineup/Crew review types and Audit_Log-to-decision links still need implementation/validation.
* **Persistence:** Unresolved manual reviews (`PENDING`, `FAILED`) persist in `decision_log` across verification passes.
* **Applied rows:** When a review item is applied, the engine logs the event details to `Audit_Log` and immediately deletes the row from `decision_log`.
* **No re-prompt after apply:** If a later verification produces the same stable `ReviewID`, the engine checks `Audit_Log` and suppresses it when that review was already applied; any stale pending copy of that same ID is removed.
* **Superseded rows:** `Refresh Resolved Parent-Only Reviews` and `Refresh Stale Parent Duplicate Reviews` mark resolved items `SUPERSEDED` (with a reason in `ActionDetails`) but keep the row for reference. Use `Archive Superseded Decisions` to delete all `SUPERSEDED` rows from `decision_log` (each is logged to `Audit_Log` first).
* **`REVIEW_PARENT_ONLY` + `ACCEPT`:** retains the Parent row with no import source by setting it to `Retained`, so verification stops flagging it. `NOT_DUPLICATE` and `REJECTED` do the same. To remove the row instead, set `RequestedAction=MARK_DELETE` with `Decision=ACCEPT`.
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

For accepted `MARK_DELETE` decisions on `LINEUP_ORPHAN` reviews, run
`Preview Approved Deletes` first and inspect each UUID, title, active-season row,
and eligibility reason in `Audit_Log`. The preview is read-only. Applying the
decision deletes only the unique Lineup row that still has no Parent row in the
active season; a missing, duplicate, or no-longer-orphan UUID fails and remains
available for correction. The deleted row snapshot is retained in
`idLog.Fingerprint`. If a linked `CREWCAL` row has an `EventID`, a follow-up
`LINEUP_DELETE_CLEANUP` decision is queued. Rows without an `EventID` and
`DRAFTCAL` staging rows are retained and audited without a non-actionable
review. `MARK_DELETE` on a Parent-targeted review (`PARENT_ONLY`, `IMPORT_DRIFT`, `IMPORT_RENAME`, `PARENT_ID_DUPLICATE`, `PARENT_DUPLICATE`'s duplicate row) does not delete immediately: it sets the Parent row to `Delete Pending`, and the next `Ingest Season` run removes it, supersedes related reviews, and logs it. `Preview Approved Deletes` also reports these targets.

**Keeping a Parent row without an import source:** accept (or reject) a `PARENT_ONLY` review, or choose `MARK_BYPASS` on any Parent-targeted review. The row's status becomes `Retained` (add it to the `Status` sheet with behavior `BYPASS`), the decision is logged to `Audit_Log`, and later verification passes skip the row instead of asking again. Verify also sets `Retained` on parent-only rows whose review was already applied. Clear the status to put the row back under verification.

**`SYNC_PARENT_TO_LINEUP`:** copies the reviewed fields (`ChangedFields`, default title, series, date, venue) from Parent Lineup onto that Lineup performance, aligned by position among the parent's non-`BYPASS` Lineup rows, refreshes `SyncHash`, then sets `Synced`. A blocked status fails the decision; a missing Lineup row supersedes it.

**Decision history in `idLog`:** applied deletes and merges (`MARK_DELETE`, `MERGE_PARENT`, `MARK_CALENDAR_DELETE`) always write an `idLog` row (`Record Type=DECISIONS`, `Sync Status=Applied`, the decision snapshot in `Fingerprint`). Other applied decisions only update the row `Sync ID Registry` already created for them. Verification treats `Applied` idLog rows like `DECISION_APPLIED` audit entries, so history survives `Audit_Log` trimming.

**Running Ingest instead of deciding:** `Ingest Season` and `Explode Dates` finish by refreshing reviews. Pending `PARENT_ONLY`, `IMPORT_DRIFT`, `IMPORT_RENAME` and `PARENT_LINEUP_DRIFT` reviews are superseded when their target row is gone or its status (`Retained`, `Bypassed`, `Delete Pending`, or any `LOCKED`/`BYPASS` behavior) makes them moot.

**Parent vs Lineup alignment:** Lineup rows are paired with Parent dates by exact date and time first. Leftover rows pair in order and are flagged as a changed date. A Lineup row with no Parent date becomes a `LINEUP_EXTRA_PERFORMANCE` review (`MARK_DELETE` sets it `Delete Pending`; `Explode Dates` removes it with a snapshot). A Parent date with no Lineup row becomes a `LINEUP_MISSING_PERFORMANCE` review. Removing one performance from the import therefore no longer shifts every later row.

**Duplicated `parentID`s:** `Verify Import vs Parent Lineup` keeps the ID on the import-matched row (else the first row) and gives every other row a `PARENT_ID_DUPLICATE` review plus the `Duplicate (ID Match)` status. Suggested action is `REASSIGN_PARENT_ID` (assign a new `parentID`; both rows are live events) when the row also matches import, otherwise `MARK_DELETE`. The apply step identifies the row by `CandidateRow` and title, never by the shared ID alone, and refuses to act when the row cannot be isolated.

For Lineup rows manually marked `SyncStatus=Delete Pending`, run
`Preview Lineup Delete Pending` and inspect the UUIDs, titles, and any blocked
duplicate/missing identities in `Audit_Log`. The next `Explode Dates` run
deletes only eligible rows from the active season's Lineup sheet, saves each
pre-delete snapshot in `idLog.Fingerprint`, marks the registry entry `Deleted`,
and refreshes registry locations. Rows that cannot be uniquely identified or
snapshotted remain in place and are logged as blocked. A deleted occurrence is
not regenerated from its Parent row while that same parent/date pair remains;
changing the source date creates a new occurrence.

The resulting `LINEUP_DELETE_CLEANUP` review defaults to `KEEP_CALENDAR`.
Reviewers may choose `MARK_CALENDAR_DELETE` for an active `CREWCAL` entry with
an `EventID`;
after accepting and applying that decision, the linked log row is marked
`To Delete on calendar`. The existing calendar sync removes the event only
when its write permissions allow it, and retains the log row as history.
`DRAFTCAL` is a staging log and does not currently support calendar-event
deletion through that sync path.

The `Scheduler > 4. Sync Calendars` command applies reviewed decisions first, then runs the sync pipeline. Individual sync test wrappers do not automatically apply decisions unless they explicitly pass `runtime.applyDecisions: true`.

## Calendar Controls

Development wrappers must use `allowCalendarWrites: false`. Use pull-only or reconcile-only tests before enabling writes.

`Crew_Calendar_Log.EventID` identifies the Google Calendar event. `UUID` identifies the associated Lineup/Crew row. `Venue_Cal_Log.EventID` identifies the venue event; its `UUID` is the explicit cross-sheet association.

After syncing, `Venue_Cal_Log`, `Crew_Calendar_Log`, and `Draft_Season_Log`
are sorted ascending by `Date`, then `Start`. The ID registry's sheet locations
and links are refreshed after each sort.

## Recovery

If a destructive reset is required, use a Developer Override after confirming the target sheet, operation, and row count. Do not use ordinary sync or verification functions as reset tools.
## Parent and Lineup Manual Action Handling

Users can set operational statuses in `Parent Lineup` to dictate engine behavior during `ingest` and `verify` runs:

* **`Bypassed`:** The engine completely skips this row during drift and duplicate checks. No `decision_log` items will be generated.
* **`Delete Pending`:** `Ingest Season` (`goParent`) removes the row from `Parent Lineup` and writes an audit entry. For Lineup rows, first use `Preview Lineup Delete Pending`; `Explode Dates` (`goLineup`) then removes uniquely identified rows, saves snapshots to `idLog.Fingerprint`, marks registry entries `Deleted`, refreshes row locations, and logs blocked rows. The Parent and Lineup workflows are season-aware.
* **`Possible Duplicate`:** The `verify` script explicitly scans this row against `Parent Lineup` and `import`. If a match is found, it creates a `PARENT_DUPLICATE` task. If no automated match is found, it generates a `REVIEW_PARENT_ONLY` task with the note: *"Flagged as Possible Duplicate by user, but no automated match found."*

## Cross-Layer Match Review

`Verify import vs Parent Lineup` first uses the exact event-name match. When names differ, it may suggest a likely related row using title similarity, series, venue, opening-date proximity, and date range. Review evidence lists the signals and score; ambiguous candidates are not selected. `Verify Parent Lineup vs Lineup` also reports title and series drift, in addition to expected date and venue, for records connected by `parentID`. Date verification compares calendar days explicitly, ignoring hidden fractional-time differences in spreadsheet date values.

These signals are comparison evidence only. They do not change identities, merge rows, or apply field updates automatically. Review the source and candidate rows before accepting a change.

## Season Promotion Protocol (Role Swapping)

To promote a Draft season to Current season without copying data:

1. Update `Sheet_Settings` roles for current tabs (e.g., change `IMPORTCURRENT` to `IMPORT_25_26`).
2. Reassign draft tabs in `Sheet_Settings` to active roles (e.g., change `IMPORTDRAFT` to `IMPORTCURRENT`).
3. Provision new blank draft tabs in Sheets, register their GIDs in `Sheet_Settings`, and assign roles `IMPORTDRAFT`, `PARENTDRAFT`, and `LINEUPDRAFT`.
