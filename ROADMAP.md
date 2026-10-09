# Scheduler Roadmap and Decisions

## Immediate Priorities
Sequence work by operational risk: finish the Apps Script/live-workbook checks for code already reported complete before taking on broader features. The exact Draft/Live verification steps are in [OPERATIONS.md](OPERATIONS.md#role-based-routing-verification). Do not close an issue based on local code inspection alone when its acceptance depends on the live spreadsheet.

1. **Validate completed identity, decision, and routing work** — issues #1, #4, #7, #8, #10, and #28. The implementation and prior progress notes are in place; the Apps Script checks and any required issue updates/closures remain outstanding.
2. **Complete end-to-end reconciliation validation** — issues #13, #24, and #25. Exercise Parent → Lineup → Crew Calendar in both seasons, including span dates, derived fields, pending deletes, and review queue behavior. Record concrete gaps before expanding the feature scope.
3. **Finish reference-data normalization** — issue #9. `Engine.loadLookups()` now loads Lookup-owned lists and `REFRULES`-owned enums, and dropdown refresh skips empty sources. Verify the live mappings and dropdowns, then continue the separate Status/behavior/mode vocabulary cleanup.
4. **Close out hyperlink scope** — #6's decision-row links and #23's idLog links are implemented; #26's Audit_Log-to-decision links and the remaining per-sheet links under #27 still need scoped implementation and verification.
5. **After these gates**, prioritize schema/reference integrity (#2, #9, #12), then explicit sync modes and reporting (#11, #17, #19). Defer UI and maintenance enhancements (#14–16, #20–22) unless operational needs change.

<!-- Keep the detailed issue mapping below aligned with the current code and validation status. -->
1. ~~Implement `getSheetByRole(role)` utility to decouple scripts from literal tab names.~~
  - implemented for active engine flows in [#1](https://github.com/morrisontheatrical/scheduler3/issues/1): `TargetSeason` now routes Import/Parent/Lineup roles; `CREWCAL`/`DRAFTCAL` routing is explicit; decisions and audit links use resolved active-season tabs.
  - only manual Draft/Live Apps Script validation remains; bootstrap, registry-repair, UI-jump, and legacy helper exceptions remain intentionally out of scope.

2. Cross-Sheet Hyperlinking (Issues #6, #23, #26, #27).
  - **Implemented, needs live verification:** `refreshLinks()` links Import→Parent, Parent-only, and Parent-duplicate reviews (#6); `Engine.IDService.applyLinks()` links idLog `UniqueID` to its source and `ParentID` to Parent (#23).
  - **Implemented, needs live verification (#27):** `Engine.IDService.applyLogLinks()` hyperlinks Crew/Draft log `UUID`→Lineup, `parentID`→Parent, `eventID`→Venue_Cal_Log (adopted events), and Venue_Cal_Log `UUID`→Lineup, `parentID`→Parent. It runs at the end of every registry sync because `patchRows()`/`batchWrite()` overwrite cells with plain values.
  - **Still open:** #26 asks for Audit_Log links to corresponding decision rows. #27's broader request remains for associated IDs in Calls, Lineup, Venue_Cal_Log, Crew_Calendar_Log, and Draft_Season_Log. New Lineup/Crew review types also need source/candidate links. Define linked fields and stable row-resolution behavior per sheet, including after sorting, before implementing.


3. ~~Add `idLog` `Merged IDs` alias logging and cascading `parentID` updates in `Lineup` for "Keep New" merges.~~
  - Implemented in `mergeParentDuplicate()` with downstream ID repointing and pending-decision updates; controlled current/draft workbook verification remains for [#4](https://github.com/morrisontheatrical/scheduler3/issues/4).

4. ~~Enforce `decision_log` queue purge rule: applied items are deleted immediately; `SUPERSEDED` rows are retained for reference and removed via `Archive Superseded Decisions`.~~
  - Queue lifecycle, stable review IDs, clean-match healing, and decision evidence are implemented. Controlled workbook verification remains for [#7](https://github.com/morrisontheatrical/scheduler3/issues/7); any broader decision-history requirements should be recorded separately from the active-queue rules.

5. ~~Implement engine handlers for `Bypassed`, `Delete Pending`, and `Possible Duplicate` status overrides in `Parent Lineup`.~~ 
  — done: `Bypassed` blocks via status behavior; `Delete Pending` is applied in `goParent`; `Possible Duplicate` is handled by verify.
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/9

6. ~~Serialize and deserialize row snapshots for recovery and comparison.~~
  - `Engine.IO.serializeRow()` / `deserializeRow()` now preserve Dates, and `idLog.Fingerprint` stores full row snapshots; merge/delete paths save the row before removal.
  - implementation addresses [#8](https://github.com/morrisontheatrical/scheduler3/issues/8); broader helper integration remains tracked under [#18](https://github.com/morrisontheatrical/scheduler3/issues/18). Manual Apps Script verification remains.

7. Normalize `Status`, `ref`, behavior values, decisions, and requested actions. --done? Status and Mode_Config could likely use another pass
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/9

8. ~~Add before/after evidence and links to decision records.~~
  - Evidence formatting and source links are implemented for decision reviews; controlled workbook verification remains under [#7](https://github.com/morrisontheatrical/scheduler3/issues/7).

9. Improve import -> Parent Lineup matching so placeholder titles can become real titles without losing `parentID`.
  - Candidate ranking/evidence is implemented and remains review-gated; validate against Current and Draft data before closing [#10](https://github.com/morrisontheatrical/scheduler3/issues/10).

10. ~~Add read-only duplicate candidate reporting and explicit keeper selection.~~
  - Candidate generation and explicit keeper IDs are implemented; verify the controlled duplicate workflow under [#7](https://github.com/morrisontheatrical/scheduler3/issues/7).

11. Harden approved decision processing against exact recorded rows and IDs.
  - see also https://github.com/morrisontheatrical/scheduler3/issues/7

12. Reconcile Parent Lineup -> Lineup -> Crew Calendar relationships.
  - see parent https://github.com/morrisontheatrical/scheduler3/issues/13
  - Parent→Lineup drift, missing/orphan detection, and Lineup→crew-log verification are implemented. Approved `PUSH_LINEUP_TO_CREWLOG` reviews now route one stable UUID to the active season's log; Delete Pending and blocked rows are not pushed.
  - **Unpopulated Lineup Fields ([#25](https://github.com/morrisontheatrical/scheduler3/issues/25))**: `EventOfTotal`, `EndDate`, `AfterToday`, `WithinQuarter`, `WithinMonth`, `SyncStatus`, and `LastUpdated` are populated/refreshed by `goLineup()`; verify both new and updated rows in Apps Script.
  - **Theatrical Date Parsing & Unparseable Review ([#24](https://github.com/morrisontheatrical/scheduler3/issues/24))**: `TheatricalParser` and `Manual Review`/`UpdateDetails` on parse failure are implemented; test actual parser-library behavior with representative strings in Apps Script.
  - **Crew-log spans ([#13](https://github.com/morrisontheatrical/scheduler3/issues/13))**: `EndDate` now determines the crew-log `End` timestamp for multi-day Lineup entries; verify downstream calendar duration with writes disabled first.
  - **Lineup → Crew log (2026-10-07 live run):** 144 Lineup rows are all present in `Crew_Calendar_Log` (0 missing, 0 drifted). `parentID` is now written on new crew rows and backfilled on existing ones. Reconcile uses fuzzy title matching (`Engine.Sync._titlesLikelyMatch`) and re-evaluates `Location Conflict` rows, so typo'd venue titles are no longer false conflicts. `Calendar > Refresh/Accept Adoption Suggestions` links a crew row to its venue event (`eventID`), sets `Adopted from Venue` (BYPASS), and writes the Lineup `UUID` onto the `Venue_Cal_Log` row; 71 crew rows were adopted in the first run. See [OPERATIONS.md](OPERATIONS.md#adopting-venue-events).
  - **Open:** crew row `C-4C655F9E` is a stale legacy row with no Lineup match (reported as an orphan on every reconcile); orphan crew rows are warned about but never resolved. 73 crew rows remain `Manual Review` with no `eventID`; they will be created on the first calendar push, which has not been run yet. Adoption currently covers `CREWCAL` only, not `DRAFTCAL`.
  - Apps Script/workbook validation remains outstanding across Current and Draft; code completion is not issue closure.


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

23a. **Registry field names must be used end to end (core tenet).** The 2026-10-07 audit found callers using the wrong field name (`EventID` vs registry `eventID`; `ParentID` vs `parentID` on idLog), which silently returned -1/undefined and broke calendar linking, idLog ParentID population, and Lineup-delete calendar cleanup. Fixed in `engine_sync.js`, `engine_ingest.js`, `engine_core.js`, `engine_IDService.js`, `engine_decisions.js`. Remaining: `Draft_Season_Log` registry rows may still carry `Row.Status`/`ParentID` as Field Names (verify in the live sheet); `loadBypassList` and the bootstrap loaders (`ControlPanel`, `Calendars`, `Status`, `Sheet_Settings`, `Mode_Config`) read by header/position — move the bootstrap loaders to GID lookups; the legacy helper files (`0_helper.js`, `0_sync calls and crew log.js`, `UI_helper.js`) were removed (see #20/#21). Closely related to #2 (case-insensitive matching).

24. Evaluate case-insensitive `Field Name` matching in `Engine.getColumnIndex`/`ctx.getMap`, so that things like `parentID` vs. `ParentID` can't silently diverge into two different keys again. Touches every `pCol`/`lCol`/`getCol`/`ctx.getMap` call site — needs a deliberate pass, not a quick patch.
  - in progress https://github.com/morrisontheatrical/scheduler3/issues/2
  - Normalize Branch
  - see agent-notes/normalizeTitle-0829.md

25. ~~Wire `idLog.Fingerprint` to `Engine.IO.serializeRow()` as a full-row JSON snapshot, distinct from operational `SyncHash`.~~
  - implemented in `Engine.IDService`; legacy compact Fingerprint values are upgraded on registry sync. See [#8](https://github.com/morrisontheatrical/scheduler3/issues/8); wider JSON helper integration remains under [#18](https://github.com/morrisontheatrical/scheduler3/issues/18).


26. Add a `Dept` column to `Calls` to match the existing `Lookup.Dept` dropdown list (Lights, Sound, Props, Scenic, Costumes, Video, etc.) — the list currently has no destination field to populate.
  - pending Spreadsheet-Revision 

27. Draft/confirm an `IDTypes` reference list enumerating every ID-shaped field in the system (`parentID`, `UUID`, `callID`, `eventID`, `ReviewID`, `VenueEventID`, `VenueUUID`, `SourceID`, `CandidateID`, `UniqueID`, `KeepParentID`, `ExistingParentID`, `DuplicateParentID`, `SuggestedKeepID`) — may have existed in an earlier hardcoded version of the registry.
  - see 

28. Reconcile `decision_log`'s live dropdown data-validation rules against the Decision/Status vocabularies below — several have drifted since the sheet was new (`Decision`, `RequestedAction`, `KeepChoice`, `ActionStatus`, `Confidence`, `SuggestedAction`, `ReviewType` all had blank `Data Type` in `Map_Registry` until this pass, which is likely part of why the sheet's validation rules drifted unnoticed).
  - see https://github.com/morrisontheatrical/scheduler3/issues/7

29. ~~Confirm and finish wiring `draft_Lineup`/`draft_Parent`/`Draft_Season_Log` into `Sheet_Settings` roles (`LINEUPDRAFT`/`PARENTDRAFT`/etc.).~~
  - Role resolution is implemented under [#1](https://github.com/morrisontheatrical/scheduler3/issues/1); verify the live Sheet_Settings mappings as part of the Draft/Live checklist above.

30. Confirm the still-unverified `Map_Registry` fields added by `repairMapRegistry()`'s auto-detection: `Calendars.CalendarRole`, `Calendars.allowCalendarWrites`, `Sheet_Settings.GID`, `Sheet_Settings.Source`. Their Data Type/Sync Behavior were filled with best guesses during the 2026-08-28 registry cleanup and need a real definition.
  - see 

31. **Import drift policy enforcement (modes-normalization issue):** `ImportUpdatePolicy` currently gates only the accept step (`acceptImportDrift`), not verify — so in draft/AUTO mode the user still has to run Apply Reviewed Decisions, and re-running verify re-queues decisions that were already accepted (repeated decisions). Desired: (a) AUTO policies short-circuit the queue/accept round-trip at detect time; (b) already-accepted `IMPORT_DRIFT` decisions are not re-queued by a subsequent verify pass (dedupe on `ExistingParentID`/`ReviewID`); (c) per-layer policies for the downstream hops (parent→lineup, lineup→log) — today only import→parent has a policy. Related to the separate modes revision issue (additional preconfigured modes likely).
  - see 

32. make sure runHealthCheck logs the health check results.
  - see 

33. Findings from the 2026-10-06 review (`Test-Results/review 10-6-26`), still open:
  - ~~`MARK_DELETE` on `PARENT_ONLY` reviews is unsupported~~ — implemented as Parent `Delete Pending`; retain via `ACCEPT`/`MARK_BYPASS` (`Bypassed`). Verify in the sheet.
  - Duplicated `parentID` rows are now detected by verify (`PARENT_ID_DUPLICATE`); source of the original append is not found in code (`goParent` only mints new IDs, now collision-checked) — re-check after testing whether any path still creates them.
  - `LINEUP_DELETE_CLEANUP` evidence repeats "CREWCAL row remains without an EventID" even when the row has an `EventID`.
  - `LINEUP_ORPHAN` review ID is not written to `Audit_Log`.
  - Log mode changes and `Lookup list diagnostics` to `Audit_Log`.
  - Verify `draft_parent` Map_Registry column indexes (RangeRef shows `Row N` in draft mode).
  - Re-check after testing: `Compare Draft Calendar vs Crew Log` errors with "Draft calendar not found for ID: CrewDraftCal" (calendar ID/setting).
  - Adoption decisions: reconcile logs `Possible Adoption` and `Room Booked by:` venue matches but queue no review; add an `ADOPT_VENUE_EVENT` decision for them.
  - Add `LINEUP_EXTRA_PERFORMANCE` (ReviewType) to `ref`.
  - Deferred UI: a "Row Actions" menu acting on the selected row (retain, delete, bypass, sync) once the back end settles.

33. Sync ID Registry Error (Issue #28): `Engine.IDService.syncAll()` and `upsert()` now resolve `Fingerprint` first with `SyncHash` fallback.
  - Code-side fix is in place; run `Sync ID Registry` on a controlled workbook and verify registry locations/snapshots before closing the issue.
  - see [#28](https://github.com/morrisontheatrical/scheduler3/issues/28)
  - `SyncHash` vs. `Fingerprint` distinction now documented in ARCHITECTURE.md.

34. Unpopulated Lineup Fields (Issue #25): verify that `EventOfTotal`, `EndDate`, `AfterToday`, `WithinQuarter`, `WithinMonth`, `SyncStatus`, and `LastUpdated` are populated/refreshed by `goLineup()` for both new rows and updates.
  - Tracked under Immediate Priority 12 / [#13](https://github.com/morrisontheatrical/scheduler3/issues/13); complete Current and Draft workbook checks before closing.
  - see [#25](https://github.com/morrisontheatrical/scheduler3/issues/25)

35. Complex Date Parser (Issue #24): `TheatricalParser` is integrated; `Manual Review` with `UpdateDetails` is applied when parsing fails in `goLineup()` and `verifyParentToLineup()`.
  - Verify representative complex, multi-day, and unparseable date strings in Apps Script before closing.
  - see [#24](https://github.com/morrisontheatrical/scheduler3/issues/24)
  - see parent [#13](https://github.com/morrisontheatrical/scheduler3/issues/13)

36. `EndDate` downstream propagation: `syncLineupToLog()` now derives the crew-log `End` from Lineup `EndDate` and updates it when the span changes.
  - Tracked under [#13](https://github.com/morrisontheatrical/scheduler3/issues/13); verify both season modes in the sheet-only path before any calendar-write test.


37. ~~Load `ref`-owned enum lists into `ctx.lookup.lists` and prevent empty data-validation writes.~~
  - `Engine.loadLookups()` now loads `LOOKUP` and `REFRULES` by role, retaining `Lookup` as the owner of `Venue`, `CrewStaff`, and `CallType`; `REFRULES` supplies the other enums. `Refresh Dropdowns` skips and logs any empty list instead of installing an empty rule.
  - Use **Lookup List Diagnostics** to confirm list sources and counts, then verify the live sheet mappings and resulting validations before closing the related #9 work.
  - see [#9](https://github.com/morrisontheatrical/scheduler3/issues/9)


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
- `REASSIGN_PARENT_ID` (new; add to `ref`, along with ReviewType `PARENT_ID_DUPLICATE`)
- `REVIEW_DATE_SPAN`
- `REVIEW_IMPORT_DRIFT`
- `REVIEW_PARENT_ONLY`
- `REFRESH_DOWNSTREAM`
- `PUSH_LINEUP_TO_CREWLOG`

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

## Review Types

- `IMPORT_PARENT`
- `PARENT_LINEUP_DRIFT`
- `LINEUP_MISSING_PERFORMANCE`
- `LINEUP_ORPHAN`
- `CREWLOG_MISSING`
- `LINEUP_CREW_DRIFT`
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
- Parent Lineup statuses (`Bypassed`, `Delete Pending`, `Possible Duplicate`) override default automated sync behavior. Parent `Delete Pending` is executed by `Ingest Season`; Lineup `Delete Pending` is previewed and applied by `Explode Dates` with a snapshot retained in `idLog.Fingerprint`, a tombstone preventing regeneration of the same parent/date occurrence, and a follow-up cleanup decision for linked `CREWCAL` rows with EventIDs.
- `REVIEW_PARENT_ONLY` closes with `ACCEPT` / `NOT_DUPLICATE` / `REJECTED` by retaining the row as `Retained` (verification skips it afterward). `MARK_DELETE` marks the Parent row `Delete Pending` for the next `Ingest Season`. `PARENT_ID_DUPLICATE` reviews use `REASSIGN_PARENT_ID` or `MARK_DELETE`.
- Import→Parent drift acceptance is governed by the active mode's `ImportUpdatePolicy` (`MANUAL_REVIEW` queues a decision; `AUTO_UPDATE` applies + summary log; `AUTO_UPDATE_AND_LOG` applies + per-field logs). The decision-apply path always bypasses the gate via `force: true`.
- `Verify Import vs Parent Lineup` writes one semantic audit entry per flagged row (e.g. `PARENT_ONLY`, `DRIFT_DETECTED`); the status paint no longer logs a duplicate row.
- **(2026-08-28 registry review)** `Map_Registry.Field Name` must be unique within a sheet. Two leftover "xlookup helper" rows (`Parent Lineup` and `draft_Parent`, both duplicating `EventName`/`DatesAndTimes` at columns 19/20) were silently shadowing the real column mappings since `assembleSheetMap()` indexes by Field Name and a later duplicate row wins. Physical columns were deleted by Seth; the stale registry rows were removed manually since `repairMapRegistry()` never auto-deletes.
- **(2026-08-28)** `SyncStatus` and `TechStatus` are distinct field names, not interchangeable — `Draft_Season_Log`'s field was previously misnamed `Row.Status` from header/field-name confusion and has been corrected to `SyncStatus`.
- **(2026-08-28)** `Field Name` casing must match exactly across sheets for the same concept (`parentID`, not `ParentID`) since lookups are exact-string today; `Draft_Season_Log.ParentID` was corrected to `parentID`.
- **(2026-08-28)** `repairMapRegistry()` intentionally skips any `Sheet_Settings.isProtected` sheet (`import`, `Lookup`, `Status`, `ref`) — cleanup of stale/duplicate rows on those sheets requires a manual pass, this is not a bug.
- **(2026-08-28)** `draft_Lineup`, `draft_Parent`, and `Draft_Season_Log` `Map_Registry` rows now exist (added to make `Sheet_Settings` operational) and are fully typed. They still need `Sheet_Settings` role assignment (`LINEUPDRAFT`/`PARENTDRAFT`) before `Engine.Roles.resolve()` can rely on them.
- **(2026-08-28)** At the time, `idLog.Fingerprint` had not yet been wired to full-row JSON snapshots; that implementation was completed on 2026-10-05. Its physical header was reverted from an auto-drifted "SyncHash" back to "Fingerprint" to keep it distinct from operational hashes.
- **(2026-10-05)** **`SyncHash` vs. `Fingerprint` distinction confirmed**: `SyncHash` is an operational compact hash (MD5/SHA-256 of `Title|Date|Time|Venue`) on data sheets for fast drift detection. `Fingerprint` is an `idLog`-owned full-row JSON snapshot via `Engine.IO.serializeRow()` for post-merge/post-delete recovery and audit. Historically, `Fingerprint` originated as a human-readable pipe-delimited string in legacy scripts (`createFingerprint()`). Code must never query `idLog` for `SyncHash`; always use `Fingerprint` for the `idLog` column. See ARCHITECTURE.md.
- **(2026-10-05)** **Unparseable dates flag `Manual Review`**: When `parseParentDatesAndTimes` returns zero dates and zero spans, the Parent Lineup row is flagged `Manual Review` with the raw date text in `UpdateDetails` — restoring legacy behavior where parse failures were always visible on the sheet, not just logged to `Audit_Log`.
- **(2026-10-05)** **`EndDate` flows downstream**: Multi-day `Lineup` rows (from `MULTI_DAY` span policy) carry `EndDate`. Sync to `Crew_Calendar_Log` / Google Calendar should create multi-day events. `EndDate` may also be backfilled from calendar logs when events are associated with Lineup rows.
- **(2026-10-05)** **Approved orphan deletes require explicit review**: `Preview Approved Deletes` is available to inspect accepted `MARK_DELETE` decisions; applying one deletes only the unique, still-orphaned Lineup row identified by its UUID and active season. A pre-delete snapshot is retained in `idLog.Fingerprint`; a surviving `CREWCAL` row with an `EventID` triggers a follow-up cleanup decision.
- **(2026-10-05)** **Calendar log ordering**: `Venue_Cal_Log`, `Crew_Calendar_Log`, and `Draft_Season_Log` are sorted ascending by `Date`, then `Start`, after their respective sync writes. `idLog.SheetLocation` and links are refreshed after sort operations.

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
- **Season-Aware Role Routing:** `Mode_Config.TargetSeason` now drives `IMPORT`/`PARENT`/`LINEUP` role resolution, and active ingest, verification, decision, calendar, IO, identity, and sync paths use role-based sheet/map access. Draft decision metadata and links use `draft_import` / `draft_Parent`; manual mode-by-mode validation remains required before closing #1.
- **Universal Hyperlinking:** Updated `refreshLinks()` to generate rich-text clickable links across all review categories (`REVIEW_PARENT_ONLY`, `REVIEW_IMPORT_DRIFT`, `PARENT_DUPLICATE`).
- **Decision Queue Lifecycle:** Implemented immediate queue deletion for applied decisions, retention of `SUPERSEDED` rows for audit trail, and bulk archiving via `archiveSupersededDecisions()`.
- **Parent Lineup Status Overrides:** Built engine handling for user flags in Parent Lineup:
  - `Bypassed`: completely ignored in drift/duplicate runs.
  - `Delete Pending`: Parent rows are removed during `goParent`; active-season Lineup rows are previewed, then removed during `goLineup`, with snapshots, registry refresh, and tombstones to prevent regeneration of the same parent/date occurrence.
  - `Possible Duplicate`: triggers targeted duplicate and drift verification.
- **Cascading Merge Repointing:** Implemented `mergeParentDuplicate()` to cascade surviving `parentID` keys across child sheets (`Lineup`, `Crew_Calendar_Log`, etc.) and log merged aliases into `idLog`.
- **Import Drift Policy Engine:** Integrated `ImportUpdatePolicy` (`MANUAL_REVIEW`, `AUTO_UPDATE`, `AUTO_UPDATE_AND_LOG`) to regulate automated field updates vs queuing manual review decisions.
