# Scheduler Roadmap and Decisions

## Immediate Priorities
<!-- UPDATE WHEN COMPLETE. KEEP THIS SECTION FOR REFERENCE BUT COPY COMPLETED ITEMS TO COMPLETED GOALS !-->
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
23. Integrate github issues

## Revised Priorities / To Do
1. **Row/Event Snapshot Compression:** Create/revise a helper to compress whole rows/events into a single portable "snapshot" string/cell (and parse back to row). Useful for storing pre-merge/pre-deletion state in `Audit_Log` or `idLog`.
2. **Metadata & Status Normalization:** Perform a normalization pass across `Status`, `ref`, `Mode_Config`, behavior values, decisions, and requested actions.
3. **Decision Evidence & Context:** Add richer before/after diff evidence and direct links to decision records.
4. **Placeholder Title Matching:** Improve import -> Parent Lineup matching so placeholder titles can evolve to real titles without losing `parentID` continuity.
5. **Read-Only Duplicate Reporting:** Provide explicit duplicate candidate reporting with human keeper selection before applying merges.
6. **Hardened Decision Processing:** Validate recorded row state and IDs strictly before applying queued actions.
7. **Downstream Relationship Reconciliation:** Reconcile Parent Lineup -> Lineup -> Crew Calendar relationships.
8. **Venue Calendar Association Semantics:** Ensure `Venue_Cal_Log` consistently maps `EventID` to the venue event and `UUID` to the associated Lineup/Crew row.
9. **Operation Mode Enforcement:** Implement explicit pull-only, push-only, reconcile-only, and two-way sync operation modes.
10. **Granular Calendar Property Patching:** Adapt property-level calendar patching from `gcalendarsync` for title, time, location, and description.
11. **Developer Overrides Menu:** Finalize confirmed Developer Overrides for destructive resets and reinitializations.
12. **Automated Role Swapping Script:** Build an automated Season Promotion script to swap roles in `Sheet_Settings`.
13. **Custom Sync Scoping:** Allow filtering sync runs by date range, venue, or specific context (see [UI-Design.md](UI-Design.md)).
14. **Detailed Reporting Mode:** Develop a "log-only" verification pass for auditing without mutation.
15. **Detailed Entity Inspection UI:** Implement popup/sidebar for rapid entity attribute inspection.
16. **Deprecation Cleanup:** Move obsolete functions to `scriptLib/Deprecated`.
17. **Engine Topography & Organization:** Review file organization and modular boundaries.
18. **GitHub Issues Integration:** Integrate workflow with GitHub issues.

## Decision Vocabulary
*Structural definitions are governed in [ARCHITECTURE.md](ARCHITECTURE.md); live enumerations reside in `ref` metadata sheet.*

`Decision` is the user's conclusion:
- `PENDING`
- `ACCEPT`
- `CONFIRMED_DUPLICATE`
- `NOT_DUPLICATE`
- `DEFERRED`
- `REJECTED`

`RequestedAction` is the engine operation:
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
*Structural definitions are governed in [ARCHITECTURE.md](ARCHITECTURE.md); live lists reside in `Status` metadata sheet.*

**Normal:**
- `Active`
- `Synced`
- `Pushed to Calendar`
- `Pulled from Calendar`
- `Calendar Log Updated`
- `Field AutoUpdated`

**Review:**
- `Manual Review`
- `Possible Duplicate`
- `Date Span - Manual Review`
- `Data Drift Detected`
- `Duplicate (ID Match)`
- `Orphaned ID`
- `Ghost Event`
- `Recovered`

**Blocked:**
- `Bypassed`
- `Location Conflict`
- `To Delete on calendar`
- `Delete Pending`

**Terminal / History:**
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

- **Role-Based Sheet Decoupling:** Implemented `getSheetByRole(role)` and `ctx.getRole()` to decouple script execution from hardcoded sheet tab names, enabling zero-copy season promotion via `Sheet_Settings`.
- **Universal Hyperlinking:** Updated `refreshLinks()` to generate rich-text clickable links across all review categories (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`, `PARENT_DUPLICATE`).
- **Decision Queue Lifecycle:** Implemented immediate queue deletion for applied decisions, retention of `SUPERSEDED` rows for audit trail, and bulk archiving via `archiveSupersededDecisions()`.
- **Parent Lineup Status Overrides:** Built engine handling for user flags in Parent Lineup:
  - `Bypassed`: completely ignored in drift/duplicate runs.
  - `Delete Pending`: cleanly removed during `goParent` with downstream audit records.
  - `Possible Duplicate`: triggers targeted duplicate and drift verification.
- **Cascading Merge Repointing:** Implemented `mergeParentDuplicate()` to cascade surviving `parentID` keys across child sheets (`Lineup`, `Crew_Calendar_Log`, etc.) and log merged aliases into `idLog`.
- **Import Drift Policy Engine:** Integrated `ImportUpdatePolicy` (`MANUAL_REVIEW`, `AUTO_UPDATE`, `AUTO_UPDATE_AND_LOG`) to regulate automated field updates vs queuing manual review decisions.

