# Scheduler Operations and Instructions

## Start Here

1. Run `test_DiagnosticDump` from `Dev / Test > Diagnostics`.
2. Run the appropriate verification function.
3. Review `decision_log` for pending decisions.
4. Apply only reviewed decisions.
5. Run the downstream stage only after its source is stable.

## Menu Organization

- `Diagnostics`: context and health checks.
- `Verification`: whole-sheet comparisons and calendar comparison.
- `Maintenance`: registry, headers, hashes, and dropdowns.
- `Decision Review`: pending review queue and approved decision processing.
- `Scheduler`: the short production pipeline.
- `Developer Overrides`: reserved for destructive reset/reinitialize operations with confirmation.

## Event Manager Menu Structure

The primary user interface is organized under the **Event Manager** menu:

### Ingest
- `goParent`: Navigate to Parent Lineup.
- `goLineup`: Navigate to Lineup.
- `goCrewLog`: Navigate to Crew Calendar Log.

### Sync
- `goSync(context)`: Execute sync based on provided context.
- `Run Custom Sync`: (Future UI Dialog) Execute sync with user-defined parameters.
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

## Verification

`Verify Import vs Parent Lineup` compares raw import data to Parent Lineup and may create pending decisions. It must not treat every Parent-only row as a duplicate.

`Verify Parent Lineup vs Lineup` compares parsed Parent Lineup dates and venues to Lineup rows.

Verification may update status and `LastSynced` when the current behavior allows it. `LOCKED` and `BYPASS` rows are not mutated, but detected differences are logged.

## Decision Workflow

`decision_log` is the editable review queue. `Audit_Log` is historical output.
`decision_log` acts strictly as an active to-do list.

* **Universal Hyperlinking:** `refreshLinks()` generates rich-text cell links for **all** review types (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`, `PARENT_DUPLICATE`) into `SourceLink` and `CandidateLink`.
* **Persistence:** Unresolved manual reviews (`PENDING`, `FAILED`) persist in `decision_log` across verification passes.
* **Purge on Resolution / Supersede:** When a review item is applied or marked `SUPERSEDED`, the engine logs the event details to `Audit_Log` and immediately deletes the row from `decision_log`.

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
* **`Delete Pending`:** The `ingest` script physically deletes the row from `Parent Lineup`, writes an audit record to `Audit_Log`, and clears any pending reviews for that ID from `decision_log`.
* **`Possible Duplicate`:** The `verify` script explicitly scans this row against `Parent Lineup` and `import`. If a match is found, it creates a `PARENT_DUPLICATE` task. If no automated match is found, it generates a `REVIEW_PARENT_ONLY` task with the note: *"Flagged as Possible Duplicate by user, but no automated match found."*

## Season Promotion Protocol (Role Swapping)

To promote a Draft season to Current season without copying data:

1. Update `Sheet_Settings` roles for current tabs (e.g., change `IMPORTCURRENT` to `IMPORT_25_26`).
2. Reassign draft tabs in `Sheet_Settings` to active roles (e.g., change `IMPORTDRAFT` to `IMPORTCURRENT`).
3. Provision new blank draft tabs in Sheets, register their GIDs in `Sheet_Settings`, and assign roles `IMPORTDRAFT`, `PARENTDRAFT`, and `LINEUPDRAFT`.