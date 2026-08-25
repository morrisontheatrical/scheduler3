# Scheduler Roadmap and Decisions

## Immediate Priorities

1. Normalize `Status`, `ref`, behavior values, decisions, and requested actions.
2. Add before/after evidence and links to decision records.
3. Improve import -> Parent Lineup matching so placeholder titles can become real titles without losing `parentID`.
4. Add read-only duplicate candidate reporting and explicit keeper selection.
5. Harden approved decision processing against exact recorded rows and IDs.
6. Reconcile Parent Lineup -> Lineup -> Crew Calendar relationships.
7. Correct Venue Calendar association semantics: `EventID` is the venue event; `UUID` is the associated Lineup/Crew row.
8. Add explicit pull-only, push-only, reconcile-only, and two-way operation modes.
9. Adapt property-level calendar patching from `gcalendarsync` for title, time, location, and description.
10. Add confirmed Developer Overrides for resets and initialization.

## Decision Vocabulary

`Decision` is the user's conclusion:
 - See ref.csv for live list
- `PENDING`
- `ACCEPT`
- `CONFIRMED_DUPLICATE`
- `NOT_DUPLICATE`
- `DEFERRED`
- `REJECTED`

`RequestedAction` is the engine operation:
- See ref.csv for live list
- `ACCEPT_IMPORT`
- `MERGE_PARENT`
- `ADOPT_VENUE_EVENT`
- `REJECT_MATCH`
- `MARK_BYPASS`
- `MARK_DELETE`
- `REVIEW_DATE_SPAN`
- `REVIEW_IMPORT_DRIFT`
- `REVIEW_PARENT_ONLY`
- `REFRESH_DOWNSTREAM`

`ActionStatus` is execution state:

- `PENDING`
- `APPLIED`
- `FAILED`
- `NO_CHANGE_REQUIRED`

Do not use `Options` or `SyncStatus` as decision commands.

## Status Vocabulary
- See status.csv for live list
Normal:

- `Active`
- `Synced`
- `Pushed to Calendar`
- `Pulled from Calendar`
- `Calendar Log Updated`
- `Field AutoUpdated`

Review:

- `Manual Review`
- `Possible Duplicate`
- `Date Span - Manual Review`
- `Data Drift Detected`
- `Duplicate (ID Match)`
- `Orphaned ID`
- `Ghost Event`
- `Recovered`

Blocked:

- `Bypassed`
- `Location Conflict`
- `To Delete on calendar`
- `Delete Pending`

Terminal/history:

- `Deleted by Calendar`
- `Merged`
- `Rejected`

## Planned Review Types

- `IMPORT_PARENT`
- `PARENT_LINEUP`
- `LINEUP_CREW`
- `CREW_CALENDAR`
- `CREW_VENUE`
- `VENUE_ADOPTION`
- `DUPLICATE_EVENT`

## Decisions Made

- `import` remains raw and read-only because it is `IMPORTRANGE`-fed.
- Existing Parent IDs should be retained when date/venue evidence supports continuity, even if a placeholder title changes.
- Duplicate reports are read-only until the user makes an explicit decision.
- Applied or explicitly rejected decision rows are logged to `Audit_Log` and removed from the active `decision_log` queue; failed rows remain for correction and retry.
- `Recovered` means an identity or row was restored but still awaits human confirmation; only after approval should the resulting operational row move to `Active` or `Synced` with `SYNC_ALLOWED`.
- Reviewed decisions are applied at the start of the normal Scheduler sync; test wrappers remain non-applying unless explicitly configured.
- `UniqueID` remains the mixed-form idLog key.
- `SL.MapRegistry` remains deprecated.
- `BYPASS` spans create no Lineup row; `MULTI_DAY` creates one row with `EndDate`; `DAY_BY_DAY` creates individual dates.
- Calendar writes require explicit permission and should preserve event IDs.
- External Node/React/Firebase repositories provide reference patterns only.

## Deferred Recovery

Use the deprecated scriptLib sources as references to rebuild, inside `Engine.*` first:

- generalized drift reconciliation;
- fingerprint matching;
- fuzzy time/space matching;
- Crew Calendar duplicate cleanup; 
- workbook-wide hash repair orchestration.

Promote code into `scriptLib` only after it is stable and reused outside scheduler3.
