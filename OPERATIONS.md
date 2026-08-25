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
- `Sync Tests`: controlled sync runs with calendar writes disabled by default.
- `Scheduler`: the short production pipeline.
- `Developer Overrides`: reserved for destructive reset/reinitialize operations with confirmation.

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
