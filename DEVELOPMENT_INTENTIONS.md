# Scheduler Development Intentions

This document records the canonical architectural intentions, metadata specifications, module boundaries, and active issue log for the Scheduler project. It serves as the primary technical memory and reference for engine implementation.

## This is a clasp-linked Apps Script project. I will execute all tests, I know this is outside of the agents scope. 

## 1. Core Architecture & Logic Governance

* **Platform**: Google Apps Script (GAS) and Google Sheets form the runtime environment.
* **Canonical Entrypoint**: `Engine.getContext()` is the sole entrypoint for initializing runtime state (`ctx`).
* **Single Source of Truth**: The engine owns configuration, sync state, sheet maps, operational modes, audit logging, status rules, and identity mapping.
* **Dynamic Logic Tabs**: Engine behavior is governed by workbook metadata rather than hardcoded script constants:
* `ref`: Immutable system-level enumerations (`SheetRole`, `SheetBehavior`, `AllowedBehaviors`, `Log Types`). System-governed.


* `ControlPanel`: Key runtime execution parameters (`Mode`, `StartSync`, `EndSync`, `defaultDuration`). User-managed.


* `Mode_Config`: Operating policy table per mode (`Draft 26-27`, `Live 26-27`, etc.) dictating read/write permissions, conflict handling, and allowed log types.


* `Sheet_Settings`: Tab definitions, sync behaviors (`SOURCE`, `MIRROR`, `PULL`, `REFERENCE`), sync modes, and ID key bindings.


* `Map_Registry`: Dynamic field-to-column index mappings for operational sheets.


* `Lookup`: Domain validation lists (Venues, Call Types, Series, Crew Staff) enforcing spreadsheet Data Validation.


* `Status`: Visual feedback formatting (hex colors) and exception routing rules (`behavior`).




* **Legacy Code Policy**: Legacy modules are retained strictly as thin compatibility wrappers until full migration; duplicate implementations of engine logic are prohibited.

## 2. Sheet Metadata & Mapping Protocol

* **Sheet Objects**:
* `ctx.sheets[name]`: Raw GAS `Sheet` object.


* `ctx.sheetDefs[name]`: Rich sheet metadata containing `sheet`, `map`, `settings`, and `role`.




* **Map Structure**: Map entries are structured objects (e.g., `{ index: 7 }`). Legacy numeric indices may be accepted for backwards compatibility, but all new code must preserve object maps.


* **Boundary Index Conversion**: Map entries must be converted to numeric column indices strictly at Sheets row/range access boundaries using `Engine.getColumnIndex(map, fieldName)` or `ctx.getCol(identifier, fieldName)`.


* **Error Handling**: Invalid or unmapped fields must return `-1` rather than `undefined`.



## 3. Map Registry & Auto-Repair Protocols

* **Authority**: `Map_Registry` is authoritative for field-to-column maps; `Sheet_Settings` identifies managed sheets and roles.


* **Automated Header Repair (`Engine.Maintenance.repairMapRegistry`)**:
* Dynamically discovers managed sheets from workbook metadata.
* Reads physical row-1 headers and reconciles them against `Map_Registry` when columns shift or fields are added.
* Permitted actions: Add missing physical headers to registry, update column indices on movement, report missing sheets, duplicate headers, duplicate registry entries, and stale fields.
* Restricted actions: Must **never** silently delete registry rows or overwrite physical workbook headers.


* **Health Checks**: `Engine.Maintenance.runHealthCheck()` performs read-only diagnostic comparisons without mutating workbook data.

## 4. Mode Configuration

* **Runtime Policy Fields**: `Mode Name`, `Description`, `IsActive`, `SyncMode`, `ConflictPolicy`, `PreferredTruth`, `WriteToCalendar`, `WriteToSheet`, `UseLiveVenueMirroring`, `AllowedBehaviors`, `AllowedLogTypes`.


* **Operational Rules**:
* Exactly one mode must have `IsActive = TRUE` at any time.


* `Draft` modes default to `UseLiveVenueMirroring = FALSE` and `WriteToCalendar = FALSE`.


* `Live` modes enable live venue mirroring and calendar pushes.
* `AllowedLogTypes` are parsed into string arrays in `ctx.mode` for exact-match filtering.


* Mode policies must be read directly from `Mode_Config`, never inferred from calendar names or `ControlPanel` heuristics.





## 5. Identity, Anchor Fields & Hash Drift Protocol

* **Canonical Hash (`SyncHash`)**:
* Field name of record across `import`, `Lineup`, `Parent Lineup`, `Calls`, `Crew_Calendar_Log`, `Venue_Cal_Log`, and `idLog`.
* `Sheet_Settings.ID Key` for `import` must be updated from `Fingerprint` to `SyncHash`.
* Calculated as a SHA-256 fingerprint derived from normalized event data (`Title | StartTime | EndTime | Location`).
* Mismatches during execution flag the row as `Data Drift Detected` and route action according to `Mode_Config.ConflictPolicy`.


* **Anchor IDs & Identity Tracking**:
* `UUID`: Row-level canonical anchor ID used for calendar event linking and `idLog` identity tracking.
* `Source`: Origin sheet identifier (e.g., `"Calls"` or `"Lineup"`).
* Code referencing legacy `crewRow.sourceID` must use `crewRow.UUID` for identity lookup and `crewRow.Source` when origin context is required.


* **Registry Alignment**:
* `Sheet_Settings.ID Key` must match the exact case-sensitive field name in `Map_Registry`.
* `Venue_Cal_Log`'s ID field in `Map_Registry` must be standardized to `EventID` (matching `Crew_Calendar_Log`).



## 6. Module Boundaries (`scriptLib` vs. Local Engine)

* **Universal Shared Library (`scriptLib` / `SL.*`)**:
* `SL.Utils`: Date/time string parsing, sync window calculations, array cleaning (`getCleanColumn`).


* `SL.Hash`: SHA-256 fingerprint generation.
* `SL.Sheets`: Dynamic header reading, range batch writing (`batchWrite`), row patching (`patchRows`), hex background formatting.
* `SL.Calendar`: Direct Google Calendar API wrappers (fetching, creating, updating, deleting events).
* `SL.Audit`: Structured log entry formatting.


* **Local Engine (Production-Specific)**:
* `Engine.Context`: Compiles runtime state (`ctx`) from local tabs (`ref`, `Lookup`, `ControlPanel`, `Mode_Config`, `Status`).


* `Engine.Sync`: Orchestrates sync phases (`mirrorVenues`, `reconcileLogs`, `syncCrewCalendar`) and domain state mapping (`scanSheet`, `buildRealityMap`).


* `Engine.IDService`: Allocates and updates entity relationships (`parentID`, `childID`, `callID`, `eventID`, `UUID`).



## 7. Sync Ownership & Execution Pipeline

* **Execution Pipeline**:
1. `Engine.Sync.runMasterSync(options)`: Initializes context (`ctx`) and loads `idLog` registry state.


2. `Engine.Sync.mirrorVenues(ctx)`: Fetches live venue calendar events into `Venue_Cal_Log` if enabled by `ctx.mode.useLiveVenueMirroring`.


3. `Engine.Sync.reconcileLogs(ctx)`: Reconciles `Crew_Calendar_Log` against `Venue_Cal_Log`, flagging location conflicts and venue adoptions.


4. `Engine.Sync.syncCrewCalendar(ctx)`: Pushes crew modifications, creations, and deletions to the target calendar if calendar writes are enabled.




* **Status & Behavior Enforcement**:
* Status behavior is checked via `ctx.status[crewRow.SyncStatus]?.behavior`.


* Rows with behaviors marked `LOCKED` or `BYPASS` (or listed in `idLog` bypass lists) are skipped during reconciliation and calendar writes.





## 8. Runtime Testing & Test Wrappers

* **Testing Overrides**: Persistent policy (`Mode_Config`) is distinct from execution overrides. Development runs use `options.runtime` overrides without modifying `IsActive`:
* `allowCalendarWrites`: Defaults to `false` in development wrappers.


* `skipMirror`, `skipReconcile`, `skipPush`: Step bypass toggles.




* **Top-Level Wrappers**: Required for execution from the GAS function picker:
* `test_DiagnosticDump`, `test_MirrorVenues`, `test_DraftModeSheetOnly`, `test_LiveModeSheetOnly`, `test_CustomRuntimeSheetOnly`, `test_ReconcileLogs`, `test_SyncCrewCalendar`, `test_SyncIDRegistry`, `test_RefreshDropdowns`.



## 9. Audit Logging & Status Coupling

* **Operational Record**: `Audit_Log` is the central audit sheet.


* **Automated Coupling**: `Engine.Status.apply()` automatically invokes `Engine.Log.write()` to record status transitions. Callers should **not** write duplicate log entries immediately after calling `Engine.Status.apply()`.


* **Exact Log Filtering**: Audit checks use exact match parsing against `ctx.mode.allowedLogTypes` (e.g., `CONFLICT_VENUE`, `RECONCILE_ADOPT`, `PUSH_CAL`).



## 10. Lookup Sheet Conventions

* **No Header Convention**: Dropdown ranges are read as entire columns (e.g., `Lookup!A:A`), so `Lookup` intentionally has **no header row** (headers would appear as selectable options). Column names are documented via adjacent annotations and `Map_Registry` notes (`"No Header: ... Dropdown"`).
* **Header Handling Exemption**: Maintenance routines (e.g., `applyDropdowns()`) must exempt `Lookup` from 1-row header slicing.
* **Future Architecture**: A proposed `HasHeaderRow` boolean in `Sheet_Settings` will formalize header existence per sheet.

## 11. Known Issues Found in Review (August 2026)

1. **`Engine.Status.apply()` Role Resolution**: Calls pass role names (e.g., `"CREWCAL"`) instead of sheet names. `apply()` fails on `getSheetByName("CREWCAL")` and early-returns before applying background colors or writing audit logs.


2. **In-Memory Target Object Updates**: `Engine.Status.apply()` expects a numeric `rowIdx` and ignores `logContext.targetObj`, preventing status updates on in-memory row objects prior to `patchRows()`.


3. **Missing Status Rows**: `"Location Conflict"` and `"Calendar Log Updated"` are missing from the `Status` sheet.


4. **Missing Calendar Method**: `Engine.Calendar.createEvent()` is referenced in `syncCrewCalendar()` but missing from `engine_calendar.js`.


5. **Missing Reality Map Helper**: `buildRealityMap()` is called in `reconcileLogs()` but undefined in engine scripts.


6. **Property Reference Error**: `syncCrewCalendar()` references non-existent `crewRow.sourceID`; must be updated to `crewRow.UUID`.


7. **Status Behavior Lookup Bug**: `reconcileLogs()` and `syncCrewCalendar()` attempt to read `ctx.lookup.statusBehavior[...]` instead of `ctx.status[statusName].behavior`. Multi-behavior cells require `Engine.parseModeList()`.


8. **Direct Object Map Indexing**: Several maintenance routines treat object map entries `{ index: N }` as raw numbers rather than invoking `Engine.getColumnIndex()`.


9. **`applyDropdowns()` Field Mismatches**: References `lMap.Crew` instead of `CrewStaff`, and targets missing `Staff`/`Venue` fields on `Crew_Calendar_Log`.
10. **Dropdown Data Truncation**: `applyDropdowns()` uses `lData.slice(1)` on `Lookup`, dropping the first dropdown option due to the no-header convention.
11. **Undefined `Lib` Object**: `engine_ingest.js: goLineup()` calls `Lib.uuid()`, throwing a runtime error.
12. **Log Function Signature Mismatch**: `engine_ingest.js: goParent()` calls `Engine.Log.write("Parent Lineup Updated", "Success")` with string arguments instead of `(ctx, paramsObject)`.


13. **Missing Target Calendar Config**: `ControlPanel` lacks the `"Crew Draft Calendar ID"` row required for calendar pushes.

### Section A implementation status (2026-08-19)

Completed in local code:

- `Engine.Status.apply()` now resolves roles, updates target objects, supports direct row writes, and logs once.
- `Engine.Calendar.createEvent()` and the private `Engine.Sync._buildRealityMap()` are implemented.
- Sync identity uses `UUID`, status behavior comes from `ctx.status`, and venue ID comparison has a temporary `eventID` fallback.
- Ingest logging and library references are corrected; executable `Lib.*` references are gone.
- Maintenance reset, header repair, and dropdown paths normalize object maps through `Engine.getColumnIndex()`.
- The obsolete `repairEngineEnvironmentDefaults()` bootstrap has been removed.

Still requires live spreadsheet verification:

- Run the Section C Apps Script wrappers and inspect `Audit_Log`.
- Apply the Section B `Sheet_Settings`, `Map_Registry`, `ControlPanel`, and `Status` data changes directly in the workbook.



## 12. Open Questions & Architectural Decisions Needed

* **Standardizing Venue Event ID**: Confirm renaming `Venue_Cal_Log`'s `eventID` field to `EventID` in `Map_Registry`.
* **Status Rule Definitions**: Determine hex colors and behavior strings for missing `"Location Conflict"` and `"Calendar Log Updated"` status rows.
* **Crew Column Binding**: Determine if `Crew_Calendar_Log` requires an explicit `Staff`/`Crew` column for assignment drop-downs.
* **Header Metadata Flag**: Evaluate adding `HasHeaderRow` to `Sheet_Settings` to replace hardcoded sheet exclusions.

## 13. Legacy Cleanup Boundaries

* **Completed**: Removed `masterAggregatorSync()`, `1_sync venue cal.js`, and dead fallback paths in `0_draft season.js`.
* **Next Targets**:
* Remove `repairEngineEnvironmentDefaults()` (obsolete hardcoded setup).
* Strip `config.js` down to essential UI/compatibility wrappers.
* Refactor `runSystemHealthCheck()` to eliminate hardcoded header creation.
* Archive `1_verify.js` or migrate to object-map access.



## 14. Guardrails & Verification Checklist

* **Guardrails**:
* Never hardcode field lists in repair or maintenance code.
* Never flatten object maps globally.
* Always default development test wrappers to `allowCalendarWrites: false`.


* Never mutate `Mode_Config` sheets during test runs.
* Check triggers and UI menu dependencies before deleting legacy functions.


* **Verification Checklist**:
* [ ] Execute `repairMapRegistry()` and confirm `MAP_REPAIR` entry in `Audit_Log`.


* [ ] Execute `Engine.Maintenance.runHealthCheck()` in read-only mode.
* [ ] Test `Draft` mode with `skipPush: true` (confirm venue mirror skipping).


* [ ] Test `Live` mode with `allowCalendarWrites: false` (confirm venue pull and log writing without calendar mutation).


* [ ] Perform controlled calendar push with explicit opt-in on a test row.
* [ ] Confirm `Audit_Log` accurately records mode, phase, reconciliation, and status transitions.