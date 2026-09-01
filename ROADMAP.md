# Scheduler Roadmap and Decisions

## Immediate Priorities
<!-- UPDATE WHEN COMPLETE. KEEP THIS SECTION FOR REFERENCE BUT COPY COMPLETED ITEMS TO COMPLETED GOALS !-->
1. Implement `getSheetByRole(role)` utility to decouple scripts from literal tab names.
  - in progress https://github.com/morrisontheatrical/scheduler3/issues/1

2. Cross-Sheet Hyperlinking (Issues #23, #26, #27): Scope expanded beyond refreshLinks() to require universal linking across Calls, idLog, Audit_Log, Venue_Cal_Log, and Crew_Calendar_Log.
  - see parent [#27](https://github.com/morrisontheatrical/scheduler3/issues/27)
  - Update `refreshLinks()` to generate universal hyperlinks for all review types (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`).
  - pending https://github.com/morrisontheatrical/scheduler3/issues/6
  - see also [#23](https://github.com/morrisontheatrical/scheduler3/issues/23)
  - see also [#26](https://github.com/morrisontheatrical/scheduler3/issues/26)


3. Add `idLog` `Merged IDs` alias logging and cascading `parentID` updates in `Lineup` for "Keep New" merges.
  - pending https://github.com/morrisontheatrical/scheduler3/issues/4
  - see also https://github.com/morrisontheatrical/scheduler3/issues/7

4. Enforce `decision_log` queue purge rule: applied items are deleted immediately; `SUPERSEDED` rows are retained for reference and removed via `Archive Superseded Decisions`.
  - pending https://github.com/morrisontheatrical/scheduler3/issues/7
  - see also https://github.com/morrisontheatrical/scheduler3/issues/4

5. ~~Implement engine handlers for `Bypassed`, `Delete Pending`, and `Possible Duplicate` status overrides in `Parent Lineup`.~~ 
  — done: `Bypassed` blocks via status behavior; `Delete Pending` is applied in `goParent`; `Possible Duplicate` is handled by verify.
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/9

6. Create/Revise a method to compress whole rows/events into a single "snapshot" cell, and back into "row". It should be able to easily be parsed for comparison. Check fingerprint/hashing functions first. This way a removed duplicate can have its fields saved in the audit_log or idLog before merge/deletion 
  - in progress https://github.com/morrisontheatrical/scheduler3/issues/8

7. Normalize `Status`, `ref`, behavior values, decisions, and requested actions. --done? Status and Mode_Config could likely use another pass
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/9

8. Add before/after evidence and links to decision records.
  - see also https://github.com/morrisontheatrical/scheduler3/issues/7

9. Improve import -> Parent Lineup matching so placeholder titles can become real titles without losing `parentID`.
  - see also https://github.com/morrisontheatrical/scheduler3/issues/10

10. Add read-only duplicate candidate reporting and explicit keeper selection.
  - see also https://github.com/morrisontheatrical/scheduler3/issues/7

11. Harden approved decision processing against exact recorded rows and IDs.
  - see also https://github.com/morrisontheatrical/scheduler3/issues/7

12. Reconcile Parent Lineup -> Lineup -> Crew Calendar relationships.
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/13
  - see also https://github.com/morrisontheatrical/scheduler3/issues/25
  - see also https://github.com/morrisontheatrical/scheduler3/issues/24

13. Correct Venue Calendar association semantics: `EventID` is the venue event; `UUID` is the associated Lineup/Crew row.
  - see https://github.com/morrisontheatrical/scheduler3/issues/12

14. Add explicit pull-only, push-only, reconcile-only, and two-way operation modes.
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/11
  - see also https://github.com/morrisontheatrical/scheduler3/issues/17
  - see also https://github.com/morrisontheatrical/scheduler3/issues/19

15. Adapt property-level calendar patching from `gcalendarsync` for title, time, location, and description.
  - see https://github.com/morrisontheatrical/scheduler3/issues/14

16. Add confirmed Developer Overrides for resets and initialization.
  - see https://github.com/morrisontheatrical/scheduler3/issues/15

17. Build automated Role Swapping promotion script based on `Sheet_Settings`.
  - see https://github.com/morrisontheatrical/scheduler3/issues/16

18. Implement "Custom Sync" capability: allow filtering sync runs by date range, venue, or specific context.
  - see https://github.com/morrisontheatrical/scheduler3/issues/17

19. Develop "Detailed Reporting" mode: a "log-only" verification pass for auditing without mutation.
  - see https://github.com/morrisontheatrical/scheduler3/issues/19

20. Implement UI-driven "Detailed Inspection" (popup/sidebar) for rapid entity review.
  - see UI-Design.md

21. Remove totally depreciated functions to scriptLib/Depreciated for reference. 
  - see [#20](https://github.com/morrisontheatrical/scheduler3/issues/20)
  - added to agent instructions / confirm added to DEVELOPMENT_INTENTIONS.md

22. Review engine organization/topography
  - see 

23. Add an optional auto-delete-stale-row mode to `Engine.Maintenance.repairMapRegistry()`. Today it only ever flags stale rows (`[STALE: no matching column]`) and never deletes them, by design — but that leaves a manual cleanup step every time a physical column is removed (see `Decisions Made` below for the bug this caused).
  - see 

24. Evaluate case-insensitive `Field Name` matching in `Engine.getColumnIndex`/`ctx.getMap`, so that things like `parentID` vs. `ParentID` can't silently diverge into two different keys again. Touches every `pCol`/`lCol`/`getCol`/`ctx.getMap` call site — needs a deliberate pass, not a quick patch.
  - in progress https://github.com/morrisontheatrical/scheduler3/issues/2
  - Normalize Branch
  - see agent-notes/normalizeTitle-0829.md

25. Wire `idLog.Fingerprint` to `Engine.IO.serializeRow()` as the intended full-row JSON snapshot mechanism (item 6 above), and reconcile it against the existing `SyncHash` hash-based drift detection — decide whether these stay as two distinct mechanisms or get unified.
  - see https://github.com/morrisontheatrical/scheduler3/issues/18
  - see https://github.com/morrisontheatrical/scheduler3/issues/8


26. Add a `Dept` column to `Calls` to match the existing `Lookup.Dept` dropdown list (Lights, Sound, Props, Scenic, Costumes, Video, etc.) — the list currently has no destination field to populate.
  - pending Spreadsheet-Revision 

27. Draft/confirm an `IDTypes` reference list enumerating every ID-shaped field in the system (`parentID`, `UUID`, `callID`, `eventID`, `ReviewID`, `VenueEventID`, `VenueUUID`, `SourceID`, `CandidateID`, `UniqueID`, `KeepParentID`, `ExistingParentID`, `DuplicateParentID`, `SuggestedKeepID`) — may have existed in an earlier hardcoded version of the registry.
  - see 

28. Reconcile `decision_log`'s live dropdown data-validation rules against the Decision/Status vocabularies below — several have drifted since the sheet was new (`Decision`, `RequestedAction`, `KeepChoice`, `ActionStatus`, `Confidence`, `SuggestedAction`, `ReviewType` all had blank `Data Type` in `Map_Registry` until this pass, which is likely part of why the sheet's validation rules drifted unnoticed).
  - see https://github.com/morrisontheatrical/scheduler3/issues/7

29. Confirm and finish wiring `draft_Lineup`/`draft_Parent`/`Draft_Season_Log` into `Sheet_Settings` roles (`LINEUPDRAFT`/`PARENTDRAFT`/etc.) now that their `Map_Registry` rows exist and are fully typed — needed before `Engine.Roles.resolve()` can be built.
  - in progress [#1](https://github.com/morrisontheatrical/scheduler3/issues/1) 
  - see Immediate Priority 1

30. Confirm the still-unverified `Map_Registry` fields added by `repairMapRegistry()`'s auto-detection: `Calendars.CalendarRole`, `Calendars.allowCalendarWrites`, `Sheet_Settings.GID`, `Sheet_Settings.Source`. Their Data Type/Sync Behavior were filled with best guesses during the 2026-08-28 registry cleanup and need a real definition.
  - see 

31. **Import drift policy enforcement (modes-normalization issue):** `ImportUpdatePolicy` currently gates only the accept step (`acceptImportDrift`), not verify — so in draft/AUTO mode the user still has to run Apply Reviewed Decisions, and re-running verify re-queues decisions that were already accepted (repeated decisions). Desired: (a) AUTO policies short-circuit the queue/accept round-trip at detect time; (b) already-accepted `IMPORT_DRIFT` decisions are not re-queued by a subsequent verify pass (dedupe on `ExistingParentID`/`ReviewID`); (c) per-layer policies for the downstream hops (parent→lineup, lineup→log) — today only import→parent has a policy. Related to the separate modes revision issue (additional preconfigured modes likely).
  - see 

32. make sure runHealthCheck logs the health check results.
  - see 

33. Sync ID Registry Error (Issue #28): Open range exception bug (starting column of the range is too small) is missing from the roadmap.
  - see [#28](https://github.com/morrisontheatrical/scheduler3/issues/28)

34. Unpopulated Lineup Fields (Issue #25): Bug tracking missing values in LINEUPCURRENT / LINEUPDRAFT (EventOfTotal, AfterToday, SyncStatus, LastUpdated, etc.) is untracked.
  - see [#25](https://github.com/morrisontheatrical/scheduler3/issues/25)

35. Complex Date Parser (Issue #24): Restoring parseComplexDateTime from Depreciated/scriptLib.LookupSYNC.js 
  - see [#24](https://github.com/morrisontheatrical/scheduler3/issues/24)
  - see parent [#13](https://github.com/morrisontheatrical/scheduler3/issues/13)


## Decision Vocabulary
*Structural definitions are governed in [ARCHITECTURE.md](ARCHITECTURE.md); live enumerations reside in `ref` metadata sheet.*

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

Reference-only (not part of the `SyncStatus` state machine above — see `ARCHITECTURE.md`'s Field Name Conventions):

- `TechStatus`: technical/production status, `Lookup`/`ref`-backed, no engine behavior attached.

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
- **(2026-08-28 registry review)** `Map_Registry.Field Name` must be unique within a sheet. Two leftover "xlookup helper" rows (`Parent Lineup` and `draft_Parent`, both duplicating `EventName`/`DatesAndTimes` at columns 19/20) were silently shadowing the real column mappings since `assembleSheetMap()` indexes by Field Name and a later duplicate row wins. Physical columns were deleted by Seth; the stale registry rows were removed manually since `repairMapRegistry()` never auto-deletes.
- **(2026-08-28)** `SyncStatus` and `TechStatus` are distinct field names, not interchangeable — `Draft_Season_Log`'s field was previously misnamed `Row.Status` from header/field-name confusion and has been corrected to `SyncStatus`.
- **(2026-08-28)** `Field Name` casing must match exactly across sheets for the same concept (`parentID`, not `ParentID`) since lookups are exact-string today; `Draft_Season_Log.ParentID` was corrected to `parentID`.
- **(2026-08-28)** `repairMapRegistry()` intentionally skips any `Sheet_Settings.isProtected` sheet (`import`, `Lookup`, `Status`, `ref`) — cleanup of stale/duplicate rows on those sheets requires a manual pass, this is not a bug.
- **(2026-08-28)** `draft_Lineup`, `draft_Parent`, and `Draft_Season_Log` `Map_Registry` rows now exist (added to make `Sheet_Settings` operational) and are fully typed. They still need `Sheet_Settings` role assignment (`LINEUPDRAFT`/`PARENTDRAFT`) before `Engine.Roles.resolve()` can rely on them.
- **(2026-08-28)** `idLog.Fingerprint` is intended to become a full-row JSON snapshot via `Engine.IO.serializeRow()` (distinct from `SyncHash`'s hash-based approach) — not yet implemented; its physical header was reverted from an auto-drifted "SyncHash" back to "Fingerprint" to avoid confusing the two mechanisms.

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

