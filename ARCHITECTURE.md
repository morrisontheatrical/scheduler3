# Scheduler Architecture and Logic

## Runtime

- Platform: Google Apps Script and Google Sheets.
- `Engine.getContext()` is the canonical runtime entrypoint.
- The engine owns workbook configuration, sync state, sheet maps, modes, status rules, audit logging, and identity relationships.
- `scriptLib` contains stable project-agnostic primitives. Scheduler-specific policy remains in `Engine.*`.
- **String comparison has one canonical implementation: `scriptLib`'s `SL.Utils.normalize(val, opts)`** (see `scriptLib/README_scriptLib_changes.md`, 2026-08-30 entry). Tiers: strict (default — trim + lowercase), `collapse` (squeeze whitespace), `fold` (typographic: smart quotes → straight, en/em dash/minus → hyphen, zero-width removal). Cross-sheet title/name equality and the `verify`/`ingest` lookups use `{ collapse: true, fold: true }` so titles that picked up smart punctuation via `IMPORTRANGE` still match. Date-aware comparison stays engine-side (`Engine.Ingest.sourceValuesEqual` needs `ctx.timeZone` for `Opening` vs other date fields, but delegates the string tier to `SL.Utils`). Deliberately distinct tiers that stay local: `compact`/`normalizeForCompare` (strip all non-alphanumerics — similarity scoring, not equality) and `normalizeHeader` in `engine_core.js` (Mode_Config header matching). Do not add a fourth inline `trim().toLowerCase().replace(...)` variant.
- **Context Object (`ctx`):** Initialized once per execution by `engine_core.buildContext()`. It translates spreadsheet-based settings into a machine-readable format to ensure consistent decision-making.

## Metadata Sources
metadata lives in various tabs (see Sheets_data folder for current csv)
- `ref`: controlled enumerations for roles, behaviors, actions, decisions, log types, and sheet behavior. **This is the single source of truth for every dropdown/Enum field's valid values** (`Decision`, `RequestedAction`, `KeepChoice`, `ActionStatus`, `Confidence`, `SuggestedAction`, `ReviewType`, `TechStatus`, etc.). Do not duplicate value lists in `Map_Registry`, `Field_Names.csv`, or code comments — reference `ref.csv` instead so there is one place to update.
- `ControlPanel`: user settings and system summary values.
- `Mode_Config`: mode policy, write permissions, conflict policy, allowed behaviors/log types, span policy, and `ImportUpdatePolicy`.
  - `ImportUpdatePolicy` (per active mode) governs the **apply/accept** step — how `Engine.Ingest.acceptImportDrift()` handles import→Parent drift **when a change is actually applied**. It does NOT change what `Verify import vs Parent Lineup` (`verifyImportToParent`) does: verify is always read-only — it detects drift, flags the row, and queues an `IMPORT_DRIFT` decision. Whether those flagged changes then apply automatically or wait for a human is decided here:
    - `MANUAL_REVIEW`: `acceptImportDrift()` (called directly, i.e. **not** via the Apply-Decisions path) does not apply; it re-queues an `IMPORT_DRIFT` decision and returns `false`. The Apply-Reviewed-Decisions path passes `force: true`, bypassing this gate — a human acceptance *is* the manual review.
    - `AUTO_UPDATE`: `acceptImportDrift()` applies the changed source fields and writes one summary audit entry.
    - `AUTO_UPDATE_AND_LOG`: `acceptImportDrift()` applies the changed source fields and writes a per-field audit entry for each change plus a summary.
  - Exposed at runtime as `ctx.mode.importUpdatePolicy` (default `MANUAL_REVIEW`, read only from the **active** `Mode_Config` row).
  - **Intended per-mode behavior (owner intent, 2026-08-29):**
    - **Draft mode** — the company is actively editing the import sheet, so changes are expected and events are unconfirmed. Target: `draft_import → AUTO_UPDATE → draft_parent → (policy TBD) → draft_lineup → (policy TBD) → draft_season_log → sync to draft calendar`. A summary log is sufficient; per-field logging is not wanted. *Open:* the parent→lineup and lineup→log hops have no per-layer policy yet — today only the import→parent hop is governed by `ImportUpdatePolicy`.
    - **Live / current season** — events are confirmed; a change is more notable. Target: `import → MANUAL_REVIEW → decision_log → Apply (accept) → Lineup → Crew_Calendar_Log`.
  - **Known gap (see ROADMAP.md):** the policy does not yet short-circuit verify — in draft/AUTO mode the user still has to run Apply Reviewed Decisions to realize an auto-update, and re-running verify can re-queue decisions that were already accepted. This is a separate modes-normalization issue.
- `Sheet_Settings`: sheet names, roles, ID keys, sync behavior, sync mode, and protection flags.
- `Map_Registry`: field-to-column mappings plus display names, data types, and sync behavior.
- `Status`: the canonical list of row states, colors, and exception/behavior rules.
- `Lookup`: domain lists used by spreadsheet validation.
- `decision_log`: active user decision and action queue; completed decisions are recorded in `Audit_Log` and removed from this queue.
- `idLog`: A registry for unique IDs and an alias table for merged IDs.

## Map Contract

Code references stable `Field Name` values. Physical headers use `Header DisplayName`. Their association is the registry row and `Column Index`.

Runtime maps use:
 
```javascript
{ FieldName: { index: 7, displayName: "Human Label", syncBehavior: "System-Managed" } }
```

All range access must convert through `Engine.getColumnIndex(map, fieldName)`. Invalid fields return `-1`.

### Field Name Conventions

- **`Field Name` must be unique within a sheet.** `assembleSheetMap()` builds `sheetConfig.map[fieldName] = {...}` keyed by `Field Name`, iterating registry rows in order — a later duplicate row for the same sheet+field silently overwrites the earlier column mapping with no error. This is not just a documentation nicety: it was found to be an active bug (2026-08-28) where leftover "xlookup helper" columns in `Parent Lineup` and `draft_Parent` were shadowing the real `EventName`/`DatesAndTimes` columns. `Engine.Maintenance.repairMapRegistry()` will only *flag* this condition (`[STALE: no matching column]`) once the physical column is removed — it never deletes registry rows automatically. Deleting the stale row is a manual step after a repair pass, until an auto-delete option is added (see ROADMAP.md).
- **`Field Name` casing must be consistent for the same concept across sheets.** Nothing should be differentiated by case alone — e.g. `parentID` (not `ParentID`), `SyncStatus` (not `Row.Status`). `Header DisplayName` may vary in capitalization/spacing for display purposes; `Field Name` may not, because `Engine.getColumnIndex`/`ctx.getMap` do an exact-string lookup today. (Case-insensitive lookup is an open discussion — see ROADMAP.md.)
- **`SyncStatus` vs. `TechStatus` are different concepts.** `SyncStatus` is the operational field that drives engine behavior (Status-sheet color + behavior rules, `Engine.Status.apply`). `TechStatus` is a reference-only production/technical status field (`Lookup`/`ref`) with no engine behavior attached — don't conflate the two when reading or writing registry rows.
- **`Map_Registry.isHidden`**: marks a field's column as intended to be hidden on the physical sheet. Planned feature — **not yet enforced by any code** (no `hideColumn()`/`showColumn()` helper exists yet; see ROADMAP.md).
- **`Map_Registry.Derivation`**: optional column documenting the exception cases where a field's value is *not* a simple same-name passthrough from the layer above (see Layered Data Architecture below) — e.g. computed fields (`EventOfTotal`, `RawDateStr` parsed from `DatesAndTimes`), generated identity fields (`UUID` via `Utilities.getUuid()`), or externally-sourced fields (`eventID` from the Google Calendar API, not a sheet at all). Ordinary passthrough fields (same `Field Name`, one layer up) leave this blank by convention — the layered architecture below is the implicit rule, `Derivation` documents the exceptions to it.
- **Identity/change-detection has two overlapping mechanisms, not yet unified:** `SyncHash` (a SHA-256 of normalized `Title|StartTime|EndTime|Location`, used today across `Lineup`/`Parent Lineup`/`Crew_Calendar_Log`/`Venue_Cal_Log`/draft equivalents for drift detection) and `idLog.Fingerprint` (planned — a full-row JSON snapshot via `Engine.IO.serializeRow()`, intended to make post-merge/post-delete recovery and comparison easier). `Fingerprint` is not yet wired to `serializeRow()`; treat it as reserved/aspirational until that lands.

## Layered Data Architecture

The workbook operates across four distinct structural layers to maintain deterministic data flow and strict identity isolation:

1. **Raw Intake Layer (`IMPORTCURRENT` / `IMPORTDRAFT`):**
   - **Sheets:** `import`, `draft_import`
   - **Key:** `Fingerprint` | **Mode:** `READ_ONLY` / `SOURCE`
   - External `IMPORTRANGE` feed. Read-only and protected from manual user edits.
   - import is read-only because it is supplied by `IMPORTRANGE`. Its row number is not a permanent identity.

2. **Master Catalog Layer (`PARENTCURRENT` / `PARENTDRAFT`):**
   - **Sheets:** `Parent Lineup`, `draft_Parent`
   - **Key:** `parentID` | **Mode:** `OVERWRITE_ALLOWED` / `MIRROR`
   - Canonical entity identity layer. Maintains event identity across title and date drifts.
   - Helps detect changes to `IMPORTCURRENT` / `IMPORTDRAFT`
   - **Two distinct import→parent paths, do not conflate them:** `Ingest Season` (`goParent`) **adds and updates** Parent rows directly from import (governed by `SheetBehavior`/`Source` fields). `Verify import vs Parent` (`verifyImportToParent`) only **detects and logs** drift and queues decisions — it never applies changes; realizing those changes is the separate Apply/accept step governed by `ImportUpdatePolicy`.

3. **Execution Layer (`LINEUPCURRENT` / `LINEUPDRAFT` & Calendars):**
   - **Sheets:** `Lineup`, `draft_Lineup`, `Calls`, `Crew_Calendar_Log`, `Venue_Cal_Log`, `Draft_Season_Log`
   - **Key:** `UUID` | **Mode:** `OVERWRITE_ALLOWED` / `SOURCE` / `SYNC` / `PULL`
   - **Calendar Log Key:** 'eventID' once populated. If not populated, depending on options/mode/sheetBehavior, a calendar event should be created and the eventID populated. 
   - Granular event instance layer parsed into individual performance dates/times for calendar sync.
   - parseDatesAndTimes performs the complex parsing of the DatesAndTimes field into individual evnts

4. **Governance Layer:**
   - See Metadata sources
   - **Sheets:** `decision_log`, `idLog`, `Audit_Log`, `Sheet_Settings`
   - Intercepts drift, tracks active review tasks, records historical audit logs, and maintains identity aliases.

### Call/Itinerary Layer (`Calls`)

`Calls` sits alongside the Execution Layer but is conceptually distinct from a `Lineup` row: a `Lineup`/`Parent Lineup` row represents *the event* (e.g. an 7:30pm performance), while a `Calls` row represents *a scheduled call time* for staff/crew relative to that event (load-in at 8:00am, a 12:00pm rehearsal, etc.) — the itinerary around the event, not the event itself. A single event can have many calls at different times of day, and a call is not required to share the event's own start time.

`Calls` carries four distinct ID columns, each meaning something different:

| Field | Meaning |
|---|---|
| `parentID` | Which show/event (`Parent Lineup` row) this call belongs to. |
| `UUID` | Legacy field name was `childID`; renamed for consistency with the rest of the identity chain. Associates the call with a specific `Lineup` (or, potentially, `Venue_Cal_Log`/`Crew_Calendar_Log`) instance. |
| `callID` | The call row's own identity, independent of the event it's attached to. |
| `eventID` | Populated once this call is pushed to a Google Calendar (via `Crew_Calendar_Log`); the calendar event ID for the call itself. |

`Calls` → `Crew_Calendar_Log` sync (`syncCallsToCrewLog()` in `0_sync calls and crew log.js`) currently exists only as a **deprecated legacy path** — full re-integration of Calls into the `Engine.*` sync pipeline is open work (see `LEGACY_FEATURES.md` / ROADMAP.md).

## Role-Based Sheet Access (`SheetRole`)

All engine functions decouple script logic from static tab names by fetching worksheets via `SheetRole` defined in `Sheet_Settings` (e.g., `getSheetByRole('IMPORTCURRENT')`). 

- Tab name renames inside Google Sheets will never break script execution.
- Enables zero-copy season promotion by swapping `SheetRole` tags in `Sheet_Settings`.

## Identity Chain & `idLog` Alias Table


`IMPORTCURRENT` / `IMPORTDRAFT` (raw IMPORTRANGE source)
  -> `PARENTCURRENT` / `PARENTDRAFT` (parentID)
  -> `LINEUPCURRENT` / `LINEUPDRAFT` (UUID per performance)
  -> `Crew_Calendar_Log` / `Draft_Season_Log` (UUID + EventID)
  -> `Venue_Cal_Log` (EventID + associated UUID) 
  -> 'idLog' (UniqueID registry + Merged IDs alias table)

`Calls` attaches to this chain via `parentID` (which show) and `UUID` (which Lineup/calendar-log instance), but is not itself part of the linear identity chain above — see "Call/Itinerary Layer" above.

`import` is read-only because it is supplied by `IMPORTRANGE`. Its row number is not a permanent identity. Parent identity matching must use content/source evidence and preserve an existing `parentID` when continuity is established.

`UniqueID` remains the mixed-form `idLog` key. Its interpretation comes from `RecordType`, source sheet, and location.

## Status, Behavior, and Decisions

SEE METADATA SOURCES FOR LIVE DATA

Below notes are incomplete

**'Status.csv'** 
- `SyncStatus`: current state/result of a row.
   `Possible Duplicate` is a review status, not an automatic command. It should trigger a decision
   'Delete Pending' was originally a way for the user to request deletion. this may need reconsidered. 
- `Row.Exception` / `Behavior`: whether automatic mutation is allowed, based on applied status.

**'ref.csv**
- `Behavior`: whether automatic mutation is allowed
   `LOCKED` and `BYPASS` prevent mutation. Detected differences may still be logged and may create a pending decision.
- `Options`: row-level operational override such as `Bypass`, `Push to Calendar`, or `Prefer Venue Event`.

- Decisions
   - `decision_log.Decision`: user conclusion.
   - `decision_log.RequestedAction`: requested engine operation.
      - REVIEW_*: create or retain a review item; no automatic data mutation.
      - ACCEPT_*: apply an approved source update.
      - MERGE_*: combine identities and repoint relationships.
      - ADOPT_*: create an explicit cross-sheet association.
      - MARK_*: change an operational state.
      - REFRESH_*: propagate an already-approved upstream change.
   - `decision_log.ActionStatus`: processing result.
   - `decision_log.ParentTitle` and `CandidateTitle`: the visible pair to compare
   for a Parent-to-Parent duplicate; IDs and row links retain the row identity.


## Data Direction

The engine must support explicit modes for:

- pull-only: calendar to sheet;
- push-only: sheet to calendar;
- reconcile-only: compare and report;
- two-way: compare and apply policy-controlled changes.
- **Source-Preference Policy:** Ensure engine prefers source data when destination fields are null/blank.
Calendar event IDs must be preserved during property updates. Initial property patching covers title, start/end, location, and description. Use `ctx.timeZone` for date conversions.

## Developer Overrides

Destructive operations remain available for recovery and initialization, but belong under a confirmed Developer Overrides menu. Examples include resetting Parent Lineup, initializing a log, clearing sync-managed fields, rebuilding headers, repairing hashes, and deleting selected rows.

Developer overrides must show scope and row counts, require confirmation, and write an audit entry.
