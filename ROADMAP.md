# Scheduler Roadmap and Decisions

## Immediate Priorities
--UPDATE WHEN COMPLETE
1. Implement `getSheetByRole(role)` utility to decouple scripts from literal tab names.
2. Update `refreshLinks()` to generate universal hyperlinks for all review types (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`).
3. Add `idLog` `Merged IDs` alias logging and cascading `parentID` updates in `Lineup` for "Keep New" merges.
4. Enforce `decision_log` queue purge rule: applied items are deleted immediately; `SUPERSEDED` rows are retained for reference and removed via `Archive Superseded Decisions`.
5. ~~Implement engine handlers for `Bypassed`, `Delete Pending`, and `Possible Duplicate` status overrides in `Parent Lineup`.~~ — done: `Bypassed` blocks via status behavior; `Delete Pending` is applied in `goParent`; `Possible Duplicate` is handled by verify.
6. Create/Revise a method to compress whole rows/events into a single "snapshot" cell, and back into "row". It should be able to easily be parsed for comparison. Check fingerprint/hashing functions first. This way a removed duplicate can have its fields saved in the audit_log or idLog before merge/deletion 
7. Normalize `Status`, `ref`, behavior values, decisions, and requested actions. --done? Status and Mode_Config could likely use another pass
8. Add before/after evidence and links to decision records.
9. Improve import -> Parent Lineup matching so placeholder titles can become real titles without losing `parentID`.
10. Add read-only duplicate candidate reporting and explicit keeper selection.
11. Harden approved decision processing against exact recorded rows and IDs.
12. Reconcile Parent Lineup -> Lineup -> Crew Calendar relationships.
13. Correct Venue Calendar association semantics: `EventID` is the venue event; `UUID` is the associated Lineup/Crew row.
14. Add explicit pull-only, push-only, reconcile-only, and two-way operation modes.
15. Adapt property-level calendar patching from `gcalendarsync` for title, time, location, and description.
16. Add confirmed Developer Overrides for resets and initialization.
17. Build automated Role Swapping promotion script based on `Sheet_Settings`.
18. Implement "Custom Sync" capability: allow filtering sync runs by date range, venue, or specific context.
19. Develop "Detailed Reporting" mode: a "log-only" verification pass for auditing without mutation.
20. Implement UI-driven "Detailed Inspection" (popup/sidebar) for rapid entity review.
21. Remove totally depreciated functions to scriptLib/Depreciated for reference. 
22. Review engine organization/topography

## Decision Vocabulary
--does this belong here or in ARCHITECTURE?

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
--does this belong here or in ARCHITECTURE?
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
--does this belong here or in ARCHITECTURE?

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
- `SheetRole` in `Sheet_Settings` is the canonical reference for sheet access; scripts must never hardcode sheet names.
- `idLog` contains a `Merged IDs` column to preserve historical identity lineage and support cascading foreign key updates.
- `decision_log` is strictly an active task queue. Applied decisions are recorded in `Audit_Log` and removed from `decision_log` immediately; `SUPERSEDED` rows stay in `decision_log` for reference until `Archive Superseded Decisions` removes them (logged to `Audit_Log` first).
- Parent Lineup statuses (`Bypassed`, `Delete Pending`, `Possible Duplicate`) override default automated sync behavior. `Delete Pending` is executed by `Ingest Season`.
- `REVIEW_PARENT_ONLY` is a non-mutating review: `ACCEPT` / `NOT_DUPLICATE` / `REJECTED` close the decision with no data change (there is no import row to copy from).
- Import→Parent drift acceptance is governed by the active mode's `ImportUpdatePolicy` (`MANUAL_REVIEW` queues a decision; `AUTO_UPDATE` applies + summary log; `AUTO_UPDATE_AND_LOG` applies + per-field logs). The decision-apply path always bypasses the gate via `force: true`.
- `Verify Import vs Parent Lineup` writes one semantic audit entry per flagged row (e.g. `PARENT_ONLY`, `DRIFT_DETECTED`); the status paint no longer logs a duplicate row.

## Deferred Recovery
--UPDATE THIS WHEN WE RECOVER 

Use the deprecated scriptLib sources as references to rebuild, inside `Engine.*` first:

- generalized drift reconciliation;
- fingerprint matching;
- fuzzy time/space matching;
- Crew Calendar duplicate cleanup; 
- workbook-wide hash repair orchestration.

Promote code into `scriptLib` only after it is stable and reused outside scheduler3.

## Completed Goals

