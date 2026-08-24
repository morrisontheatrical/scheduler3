# Scheduler Development Intentions

This document records the canonical architectural intentions, metadata specifications, module boundaries, and active issue log for the Scheduler project. It serves as the primary technical memory and reference for engine implementation.

## This is a clasp-linked Apps Script project. I will execute all tests, I know this is outside of the agents scope.

> **Merge note (2026-08-22):** this revision was drafted from the 2026-08-19 baseline. If you've edited this file locally since then, diff before overwriting — this is not guaranteed to be authoritative over your working copy.

## 1. Core Architecture & Logic Governance
* **Platform**: Google Apps Script (GAS) and Google Sheets form the runtime environment.
* **Canonical Entrypoint**: `Engine.getContext()` is the sole entrypoint for initializing runtime state (`ctx`).
* **Single Source of Truth**: The engine owns configuration, sync state, sheet maps, operational modes, audit logging, status rules, and identity mapping.
* **Dynamic Logic Tabs**: Engine behavior is governed by workbook metadata rather than hardcoded script constants:
* `ref`: Immutable system-level enumerations (`SheetRole`, `SheetBehavior`, `AllowedBehaviors`, `Log Types`). System-governed.


* `ControlPanel`: Key runtime execution parameters (`Mode`, `StartSync`, `EndSync`, `defaultDuration`). User-managed. **Revision drafted 2026-08-22** — see Section 15.


* `Mode_Config`: Operating policy table per mode (`Draft 26-27`, `Live 26-27`, etc.) dictating read/write permissions, conflict handling, and allowed log types. Now also carries `SpanDatePolicy` (added 2026-08-21).


* `Sheet_Settings`: Tab definitions, sync behaviors (`SOURCE`, `MIRROR`, `PULL`, `REFERENCE`), sync modes, and ID key bindings. Now also carries `SheetRole` bindings for the reserved `IMPORTDRAFT`/`PARENTDRAFT`/`LINEUPDRAFT` roles (added 2026-08-22, see Section 11 for a known typo).


* `Map_Registry`: Dynamic field-to-column index mappings for operational sheets. Now also expected to carry a populated `Header DisplayName` per field — see Section 2 and Section 11.


* `Lookup`: Domain validation lists (Venues, Call Types, Series, Crew Staff) enforcing spreadsheet Data Validation. As of 2026-08-22 this sheet has a real header row (see Section 10 — this reverses the sheet's prior no-header convention).


* `Status`: Visual feedback formatting (hex colors) and exception routing rules (`behavior`). Now also carries `Date Span - Manual Review` (added 2026-08-21).




* **Legacy Code Policy**: Legacy modules are retained strictly as thin compatibility wrappers until full migration; duplicate implementations of engine logic are prohibited. **This includes `scriptLib`-side duplication**, not just `0_*.js` — see Section 6 for `SL.MapRegistry` as a live example.

## 2. Sheet Metadata & Mapping Protocol

* **Sheet Objects**:
* `ctx.sheets[name]`: Raw GAS `Sheet` object.


* `ctx.sheetDefs[name]`: Rich sheet metadata containing `sheet`, `map`, `settings`, and `role`.




* **Map Structure**: Map entries are structured objects (e.g., `{ index: 7 }`). As of 2026-08-22, map entries also carry `displayName` (falls back to Field Name when `Header DisplayName` is blank in the registry) — see Section 11. Legacy numeric indices may be accepted for backwards compatibility, but all new code must preserve object maps.


* **Field Name vs. Header DisplayName**: These are deliberately distinct. `Field Name` is the stable semantic key code should reference and should not change once set. `Header DisplayName` is the human-facing text expected on the physical sheet and is allowed to drift independently. Any maintenance routine that reads or writes physical headers (`repairMapRegistry`, `repairHeaders`, `resetHeaders`, `runHealthCheck`) must key off `Header DisplayName`, not `Field Name` — conflating the two was the root cause of the `Map_Registry` duplication bug found 2026-08-22 (Section 11).


* **Boundary Index Conversion**: Map entries must be converted to numeric column indices strictly at Sheets row/range access boundaries using `Engine.getColumnIndex(map, fieldName)` or `ctx.getCol(identifier, fieldName)`. Use `Engine.getDisplayName(map, fieldName)` for the equivalent display-text lookup.


* **Error Handling**: Invalid or unmapped fields must return `-1` rather than `undefined`.



## 3. Map Registry & Auto-Repair Protocols

* **Authority**: `Map_Registry` is authoritative for field-to-column maps; `Sheet_Settings` identifies managed sheets and roles.

* **Registry maintenance contract**:
	* Read physical headers from a managed sheet and write/update the corresponding `Header DisplayName` and `Column Index` in `Map_Registry`.
	* Write physical headers from `Map_Registry` using each row's `Field Name`/`Header DisplayName` association.
	* `createRegistry` may add missing registry entries from physical headers.
	* `deleteRegistry` is an explicit operation; repair must never silently delete rows.
	* `Field Name` is the stable code-facing identity. `Header DisplayName` is the physical/user-facing label. The registry row and column index associate them; a display-name change must not rename the field.


* **Automated Header Repair (`Engine.Maintenance.repairMapRegistry`)**:
* Dynamically discovers managed sheets from workbook metadata.
* Reads physical row-1 headers and reconciles them against `Map_Registry` **by matching `Header DisplayName` (falling back to `Field Name` for legacy rows without one set)** — matching directly against `Field Name` was the pre-2026-08-22 behavior and is deprecated; it could not recognize a renamed header as the same field, so every rename produced a duplicate row instead of an update.
* Permitted actions: Add missing physical headers to registry, update column indices on movement, report missing sheets, duplicate headers, duplicate registry entries, and stale fields.
* Restricted actions: Must **never** silently delete registry rows or overwrite physical workbook headers. Deleted/orphaned columns must be flagged persistently (e.g. a `[STALE: ...]` marker in `Notes`) rather than only surfaced in an ephemeral run report — this was a gap identified 2026-08-22 and is now part of the intended design (not yet live-tested).
* **Header convention**: all current sheets are expected to have headers. `isProtected` remains a write guard, and header writers should require explicit confirmation before overwriting a protected sheet. `Lookup` is now headered and may be scanned, provided its row 1 is excluded when building dropdown values.


* **Health Checks**: `Engine.Maintenance.runHealthCheck()` performs read-only diagnostic comparisons without mutating workbook data. Must compare against `Header DisplayName`, matching the repair function's convention.

## 4. Mode Configuration

* **Runtime Policy Fields**: `Mode Name`, `Description`, `IsActive`, `SyncMode`, `ConflictPolicy`, `PreferredTruth`, `WriteToCalendar`, `WriteToSheet`, `UseLiveVenueMirroring`, `AllowedBehaviors`, `AllowedLogTypes`, `SpanDatePolicy`.


* **Operational Rules**:
* Exactly one mode must have `IsActive = TRUE` at any time.


* `Draft` modes default to `UseLiveVenueMirroring = FALSE` and `WriteToCalendar = FALSE`.


* `Live` modes enable live venue mirroring and calendar pushes.
* `AllowedLogTypes` are parsed into string arrays in `ctx.mode` for exact-match filtering. **As implemented, this filtering is only enforced at specific call sites in `engine_sync.js` (`RECONCILE_ADOPT`, `CONFLICT_VENUE`) that manually check membership before calling `Engine.Log.write()`. Most other `Log.write()` calls are unconditional — `Engine.Log.write()` itself does not filter. Clarified 2026-08-22; previously assumed (incorrectly) to be unimplemented entirely.**
* **`AllowedBehaviors` is parsed into `ctx.mode.allowedBehaviors` but is not currently consulted anywhere.** `reconcileLogs()` and `syncCrewCalendar()` only check a row's own `Status.behavior` tag (hardcoded to look for `LOCKED`/`BYPASS`), never whether the active mode permits that behavior at all. This is a real gap, not a stylistic one — it blocks the planned `SyncCheck` mode (Section 15) from behaving differently per mode. **Flagged 2026-08-22, prioritized for the next implementation pass.**
* Mode policies must be read directly from `Mode_Config`, never inferred from calendar names or `ControlPanel` heuristics.
* `SpanDatePolicy` (`BYPASS` | `MULTI_DAY` | `DAY_BY_DAY`) governs how a detected "through" date span in `Parent Lineup.DatesAndTimes` is exploded into `Lineup` — see Section 15 for the full design and current implementation status.





## 5. Identity, Anchor Fields & Hash Drift Protocol

* **Canonical Hash (`SyncHash`)**:
* Field name of record across `import`, `Lineup`, `Parent Lineup`, `Calls`, `Crew_Calendar_Log`, `Venue_Cal_Log`, and `idLog`.
* `Sheet_Settings.ID Key` for `import` must be updated from `Fingerprint` to `SyncHash`. **Still open as of 2026-08-22** — deliberately: `import` rows are raw and unstable (row position isn't trustworthy against an `ImportRange`-fed source), so `Fingerprint` remains the practical row-identity mechanism until the `import`→`Parent Lineup` reconciliation feature (Section 15) is built to properly track drift by content rather than position.
* Calculated by one shared, deterministic fingerprint implementation derived from normalized event data (`Title | StartTime | EndTime | Location`). The encoding/hash algorithm is an implementation detail; consistency across all producers and consumers is the requirement. Existing records must be migrated deliberately if the algorithm changes.
* Mismatches during execution flag the row as `Data Drift Detected` and route action according to `Mode_Config.ConflictPolicy`.


* **Anchor IDs & Identity Tracking**:
* `UUID`: Row-level canonical anchor ID used for calendar event linking and `idLog` identity tracking. `Crew_Calendar_Log` and `Lineup`'s `Sheet_Settings.ID Key` were updated to `UUID` as of 2026-08-22, consistent with this.
* `Source`: Origin sheet identifier (e.g., `"Calls"` or `"Lineup"`).
* Code referencing legacy `crewRow.sourceID` must use `crewRow.UUID` for identity lookup and `crewRow.Source` when origin context is required.


* **Registry Alignment**:
* `Sheet_Settings.ID Key` must match the exact case-sensitive field name in `Map_Registry`.
* `Venue_Cal_Log`'s ID field in `Map_Registry` must be standardized to `EventID` (matching `Crew_Calendar_Log`).



## 6. Module Boundaries (`scriptLib` vs. Local Engine)

* **Universal Shared Library (`scriptLib` / `SL.*`)**:
* `SL.Utils`: Date/time string parsing, sync window calculations, array cleaning (`getCleanColumn`), UI helpers, identity string normalization.


* `SL.Hash`: SHA-256 fingerprint generation.
* `SL.Sheets`: Dynamic header reading, range batch writing (`batchWrite`), row patching (`patchRows`), hex background formatting.
* `SL.Calendar`: Direct Google Calendar API wrappers (fetching, creating, updating, deleting events).
* `SL.Audit`: Structured log entry formatting.



* `SL.Identity`: Fingerprint/hash generation from event fields (title, date, time, venue). Supersedes the older `getAdvancedDuplicateFingerprint`/`getTimeSpaceFingerprint` helpers referenced by the pre-migration `reconcile.gs`.
* `SL.HashMaintenance`: (rebuilt 2026, contents not reviewed this session)
* `SL.TheatricalParser`: Parses a single `DatesAndTimes` line (`"[Weekday, ]Month Day, Year[ at H:MMam/pm]"`, or `TBD`) into a start date. **Built 2026-08-21** — this was the root cause of the near-total Parent Lineup date-parsing failure found the same day; see Section 11.
* `SL.MapRegistry`: **Legacy / likely dead as of 2026-08-22.** Reads `Map_Registry` into a flat `{FieldName: ColumnIndex}` map — the pre-migration numeric shape, not the current `{index, displayName}` object shape. Map-registry logic is understood to live entirely in `engine_maintenance.js` now; this file is a candidate for retirement pending confirmation nothing external still calls `SL.getMap()`.
* `SL.EventTime`, `SL.Calendar`, `SL.DB`: (rebuilt 2026, contents not reviewed this session)
* **Local Engine (Production-Specific)**:
* `Engine.Context`: Compiles runtime state (`ctx`) from local tabs (`ref`, `Lookup`, `ControlPanel`, `Mode_Config`, `Status`).


* `Engine.Sync`: Orchestrates sync phases (`mirrorVenues`, `reconcileLogs`, `syncCrewCalendar`) and domain state mapping (`scanSheet`, `buildRealityMap`).


* `Engine.IDService`: Allocates and updates entity relationships (`parentID`, `childID`, `callID`, `eventID`, `UUID`).


* `Engine.Ingest`: Parses `Parent Lineup` into `Lineup` (`parseParentDatesAndTimes`, `goLineup`), including span-date policy resolution.


* `Engine.Maintenance`: Header repair, dropdown refresh, health checks, sheet resets.

* `Engine.Decisions`: durable manual-review decisions in `decision_log`; `SyncStatus` remains state, event-sheet `Options` remains an operational override, and `RequestedAction`/`ActionStatus` control decision processing.

* `ctx.timeZone` is bound from `SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()` and is the preferred timezone source for date/calendar conversions.



* **Promotion policy (added 2026-08-22)**: `scriptLib` is shared across projects outside this one, and churn there has real cost — described directly as causing "backlash" in another project. New general-purpose-*candidate* logic should be built and proven inside `Engine.*` first (private, prefixed `_` if not meant for external use), and only promoted into `SL.*` once it is genuinely stable, genuinely reused elsewhere, and not still being iterated on. `Engine.Maintenance._diffHeaders` (Section 11) is the first function built under this policy — it deliberately stayed in `engine_maintenance.js` rather than `SL_Utils.js` for this reason.

## 7. Sync Ownership & Execution Pipeline

* **Execution Pipeline**:
1. `Engine.Sync.runMasterSync(options)`: Initializes context (`ctx`) and loads `idLog` registry state.


2. `Engine.Sync.mirrorVenues(ctx)`: Fetches live venue calendar events into `Venue_Cal_Log` if enabled by `ctx.mode.useLiveVenueMirroring`.


3. `Engine.Sync.reconcileLogs(ctx)`: Reconciles `Crew_Calendar_Log` against `Venue_Cal_Log`, flagging location conflicts and venue adoptions.


4. `Engine.Sync.syncCrewCalendar(ctx)`: Pushes crew modifications, creations, and deletions to the target calendar if calendar writes are enabled.




* **Status & Behavior Enforcement**:
* Status behavior is checked via `ctx.status[crewRow.SyncStatus]?.behavior`.

* A checked row receives a status/timestamp update when its current `Row.Exception` behavior allows it. `LOCKED` and `BYPASS` rows are not mutated during verification or synchronization, but detected changes are still logged and may create a `decision_log` review item.

* `Possible Duplicate` is a review status whose `Row.Exception` is `Manual Review`; it should create a pending decision rather than being treated as an automatic update command.


* Rows with behaviors marked `LOCKED` or `BYPASS` (or listed in `idLog` bypass lists) are skipped during reconciliation and calendar writes.

* **Title matching in `reconcileLogs()` is currently exact-match-only** (`v.Title.trim() === crewRow.Title.trim()`), or an explicit manual `Options = "Prefer Venue Event"` override. The pre-migration `reconcile.gs` had a fuzzy substring match (`vTitle.includes(cTitle) || cTitle.includes(vTitle)`) that was dropped during the Engine/ctx migration — **confirmed 2026-08-22 to be an unintentional simplification, not a deliberate hardening.** See Section 15 for the planned tiered-matching redesign.





## 8. Runtime Testing & Test Wrappers

* **Testing Overrides**: Persistent policy (`Mode_Config`) is distinct from execution overrides. Development runs use `options.runtime` overrides without modifying `IsActive`:
* `allowCalendarWrites`: Defaults to `false` in development wrappers.


* `skipMirror`, `skipReconcile`, `skipPush`: Step bypass toggles.




* **Top-Level Wrappers**: Required for execution from the GAS function picker:
* `test_DiagnosticDump`, `test_MirrorVenues`, `test_DraftModeSheetOnly`, `test_LiveModeSheetOnly`, `test_CustomRuntimeSheetOnly`, `test_ReconcileLogs`, `test_SyncCrewCalendar`, `test_SyncIDRegistry`, `test_RefreshDropdowns`.

* **Menu organization**: development actions are grouped into Diagnostics, Verification, Maintenance, Decision Review, and Sync Tests. The `Scheduler` menu remains the short user-facing pipeline. Future row-level commands should live in a separate Row Actions menu and operate on an explicit selected row or supplied ID; each action needs validation, confirmation, and audit behavior.
* **Header operation names**: `Read Sheet Headers into Registry` updates `Map_Registry` from physical sheets; `Repair Headers from Registry` changes only mismatched header cells; `Write Headers from Registry`/`Reset Headers` writes the registry's display names to live sheets. Protected sheets are skipped unless an explicit confirmation path is added.



## 9. Audit Logging & Status Coupling

* **Operational Record**: `Audit_Log` is the central audit sheet.


* **Automated Coupling**: `Engine.Status.apply(ctx, roleOrSheetName, rowIdx, statusName, logContext)` automatically invokes `Engine.Log.write()` to record status transitions. Callers should **not** write duplicate log entries immediately after calling `Engine.Status.apply()`. Confirmed live and working as documented (2026-08-22 review).


* **Log Type Filtering — clarified 2026-08-22**: Filtering against `ctx.mode.allowedLogTypes` is **not** a global mechanism inside `Engine.Log.write()`. It is applied manually at specific call sites in `engine_sync.js` before certain optional log entries (`RECONCILE_ADOPT`, `CONFLICT_VENUE`) are written. Most `Log.write()` calls elsewhere in the codebase are unconditional. This is inconsistent but not necessarily wrong — worth a deliberate decision on whether filtering should become universal, stay call-site-specific, or be removed as a stated intention if it's not going to be made universal.



## 10. Lookup Sheet Conventions

* **Convention changed 2026-08-22.** `Lookup` previously had no header row by design (whole-column dropdown ranges, e.g. `Lookup!A:A`), on the reasoning that a header would appear as a selectable dropdown option. In practice this caused real problems: stray annotation text and columns duplicated from `ref` ended up sitting in row 1, indistinguishable from real dropdown data, and were then picked up as phantom fields by `repairMapRegistry` (which — unlike `runHealthCheck` — did not exempt `Lookup` from header-based scanning).
* **`Lookup` now has a real header row** (`Venue`, `Call Type`, `Series`, `Crew`, plus columns pending removal — see below). Any code reading `Lookup`'s columns as dropdown source lists (`Engine.Maintenance.applyDropdowns()`, `Engine.loadLookups()`) must now start at row 2, not row 1. This is a **reversal** of the previously-documented `.slice(1)` bug in `applyDropdowns()` — under the new convention, slicing off row 1 is correct behavior, not a bug.
* **Columns pending manual removal**: `Dept`, `Tech Status`, `Ren Priority`, `Priority Description` — leftover duplication of `ref`'s system enumerations (or bleed from an unrelated template), not part of this project's actual domain lists. `ref` was created specifically to separate back-end/system enumerations from front-end/domain dropdown lists; these columns predate that separation and should be deleted from `Lookup` once confirmed safe.
* **Future architecture**: A proposed `HasHeaderRow` boolean in `Sheet_Settings` would formalize header existence per sheet — now more clearly motivated given `Lookup`'s convention just changed.

## 11. Known Issues Found in Review (August 2026)

1. **`Engine.Status.apply()` Role Resolution**: ~~Calls pass role names instead of sheet names, causing early-return failures.~~ **Resolved** — confirmed working as of the 2026-08-19 status update; `apply()` correctly resolves role or sheet name, updates target objects, and logs automatically.


2. **In-Memory Target Object Updates**: ~~`Engine.Status.apply()` ignores `logContext.targetObj`.~~ **Resolved**, same status update.


3. **Missing Status Rows**: ~~`"Location Conflict"` and `"Calendar Log Updated"` missing from `Status`.~~ **Resolved** — both present with hex/color values as of 2026-08-21 export.


4. **Missing Calendar Method**: ~~`Engine.Calendar.createEvent()` missing.~~ **Resolved**, 2026-08-19.


5. **Missing Reality Map Helper**: ~~`buildRealityMap()` undefined.~~ **Resolved** as `Engine.Sync._buildRealityMap()`, 2026-08-19.


6. **Property Reference Error**: ~~`crewRow.sourceID` should be `crewRow.UUID`.~~ **Resolved**, 2026-08-19.


7. **Status Behavior Lookup Bug**: ~~Reads `ctx.lookup.statusBehavior[...]` instead of `ctx.status[statusName].behavior`.~~ **Resolved**, 2026-08-19.


8. **Direct Object Map Indexing**: ~~Several maintenance routines treat `{index: N}` as raw numbers.~~ **Resolved** via `Engine.getColumnIndex()` normalization, 2026-08-19.


9. **`applyDropdowns()` Field Mismatches**: `Lookup` now has a header row and the reader must exclude it. Crew and call-type lists are loaded but not applied, and the target mapping still needs confirmation for crew/staff assignment fields. **Partially addressed in code; field wiring remains open.**


10. **Dropdown Data Truncation**: ~~`applyDropdowns()` `.slice(1)` drops the first dropdown option.~~ **Reclassified 2026-08-22** — this is no longer a bug under the new `Lookup` header convention (Section 10); the same code is now correct and should stay as-is. Verify the range/read-start logic still matches once the header row lands for real.


11. **Undefined `Lib` Object**: ~~`goLineup()` calls `Lib.uuid()`.~~ **Resolved**, 2026-08-19.


12. **Log Function Signature Mismatch**: ~~`goParent()` calls `Log.write` with string args instead of an object.~~ **Resolved**, 2026-08-19.


13. **Missing Target Calendar Config**: ~~`ControlPanel` lacks `"Crew Draft Calendar ID"`.~~ **Resolved** — confirmed present and correctly resolved by `_getCrewDraftCalendarId()`'s multi-key fallback (`"Crew Draft Calendar ID"` / `"CrewDraftCal"` / `"Crew Draft Calendar"`), 2026-08-22 review.


14. **Date parsing library namespace failure**: scheduler3 was checking the undeclared/global `SL` namespace even though the library is imported as `scriptLib`. This produced `Theatrical parser unavailable` for every Parent Lineup row in the 2026-08-23 audit. The ingest and IO paths now resolve library modules through the imported namespace; rerun verification to confirm the deployed clasp library contains `TheatricalParser`.


15. **"through" date spans required a policy decision, not a hardcoded explosion (designed 2026-08-21)**: Originally the parser exploded every span into one row per calendar day unconditionally. Redesigned so the parser only *detects and reports* spans (`{raw, start, end}`); `goLineup()` resolves policy via `Mode_Config.SpanDatePolicy` (`BYPASS`/`MULTI_DAY`/`DAY_BY_DAY`), with an optional per-row `Parent Lineup.SpanOverride`. `BYPASS` routes through the new `Date Span - Manual Review` status (`Row.Exception = Manual Review`) rather than a bespoke logging path. `Lineup.EndDate` added to support `MULTI_DAY`. Spreadsheet side confirmed live (2026-08-22 export); rerun after the library namespace fix.


16. **Sheet role resolution used hardcoded sheet names instead of `SheetRole`**: `goLineup()` referenced `"Parent Lineup"`/`"Lineup"` directly instead of resolving through `ctx.sheets[role]`/`ctx.getMap(role)`, even though `assembleSheetMap()` already supports role-based lookup (used elsewhere, e.g. `Engine.Calendar.pullCalendarEvents`). Fix drafted 2026-08-22, using `Engine.Roles` constants (`PARENTCURRENT`/`LINEUPCURRENT`) rather than bare string literals.


17. **`Sheet_Settings` role typo**: the new draft-sheet row uses `IMPORTRAFT` (missing the `D`); `ref` reserves the role as `IMPORTDRAFT`. Silent failure risk — `ctx.roles["IMPORTDRAFT"]` would resolve to nothing. **Still open as of 2026-08-22.**


18. **`Lookup`/`ref` duplication and `repairMapRegistry` pollution (found 2026-08-22)**: see Section 10 for the full account. `repairMapRegistry()` lacked `runHealthCheck()`'s `Lookup` exemption, and treated row-1 non-header text as real field names, registering junk entries (`confirm sync`, `Log types`, `Sheet.Behavior`, `Dept`, `Tech Status`, `Ren Priority`) including a genuine column-index collision (`Log Types` and `confirm sync` both claiming index 12). `Lookup` now has a real header (Section 10); the `Lookup` exemption in `repairMapRegistry()` should be revisited once the `ref`-duplicate columns are actually removed and the new header convention is confirmed stable.


19. **`Map_Registry` duplicate/header association**: the registry must preserve stable `Field Name` while tracking physical `Header DisplayName` by column index. `Engine.Maintenance` now reads headers into the registry, updates moved/renamed associations, reports duplicate rows, and provides explicit create/delete/write entrypoints. Live verification is still required, especially against the known `Lookup` index collision.


20. **Protected header writes**: all current sheets are expected to have headers, so the old headerless-sheet exemption is no longer the governing rule. `repairHeaders()` and `resetHeaders()` now skip protected sheets by default and support an explicit confirmation path before overwriting them. Live verification is still required.


21. **Three maintenance functions with overlapping responsibility**: `repairHeaders()` (targeted, all sheets, safe), `resetHeaders()` (wholesale rewrite, all sheets, safe but heavier), and `reset()` (single-sheet, UI-confirmed, genuinely destructive — can wipe row data). The first two overlap enough in practice that it's worth deciding whether both are needed going forward, once both are fixed to parity. **Open question, not yet decided — see Section 12.**


22. **`idLog` has two related-but-unclear fields**: `LastSynced` (Header DisplayName: "Last Verified") and a separate physical `LastVerified` column, confirmed empty on every row in the live export. Original intent not documented and not remembered. Candidate meaning proposed 2026-08-22: `LastSynced` = last automatic engine touch, `LastVerified` = last explicit human/verify-function confirmation (`goVerifyImportToParent`/`goVerifyParentToLineup`) — not yet decided or wired.


23. **`SL.MapRegistry.getMap()` duplicates map-loading logic that lives in `engine_maintenance.js`/`Engine.assembleSheetMap()`**, returning the legacy flat-number map shape rather than the current `{index, displayName}` object shape. It is unused by this project and is now treated as deprecated; do not promote scheduler registry maintenance into it unless another project proves the need.


24. **`Mode_Config.AllowedBehaviors` is only partially enforced** — calendar create/update/delete operations now require `SYNC_ALLOWED` and are blocked for `AUDIT_ONLY`; row-level `LOCKED`/`BYPASS` behavior checks remain in place. Reconciliation and the broader `SyncCheck` policy still need a dedicated pass.

## 12. Open Questions & Architectural Decisions Needed

* **Standardizing Venue Event ID**: Confirm renaming `Venue_Cal_Log`'s `eventID` field to `EventID` in `Map_Registry`.
* **Crew Column Binding**: Determine if `Crew_Calendar_Log` requires an explicit `Staff`/`Crew` column for assignment drop-downs.
* **Header Metadata Flag**: Evaluate adding `HasHeaderRow` to `Sheet_Settings` to replace hardcoded sheet exclusions — more clearly motivated now that `Lookup`'s convention has changed once already (Section 10).
* **`repairHeaders()` vs. `resetHeaders()`**: once both are fixed to parity (Section 11, issues 19–20), is there still a reason to keep both, or does the targeted function make the wholesale one redundant except for deliberate full-schema-rewrite events?
* **`idLog.LastSynced` vs. `LastVerified`**: formalize the proposed distinction (Section 11, issue 22), collapse to one field, or repurpose `LastVerified` for something else entirely?
* **Draft role resolution trigger**: once `IMPORTDRAFT`/`PARENTDRAFT`/`LINEUPDRAFT` are wired in (Section 15), what should actually decide whether a function resolves to the `CURRENT` or `DRAFT` role at runtime — matching against `ctx.mode.mode` by name, or an explicit `ControlPanel` toggle independent of the active `Mode_Config` row?
* **`SL.MapRegistry.getMap()`**: still referenced anywhere outside this project, or safe to retire?
* **`AllowedLogTypes` filtering**: should this become a universal check inside `Engine.Log.write()`, stay as manual call-site checks, or be dropped as a stated design intention if it's not going to be made consistent?

## 13. Legacy Cleanup Boundaries

* **Completed**: Removed `masterAggregatorSync()`, `1_sync venue cal.js`, dead fallback paths in `0_draft season.js`, and `1_verify.js` (called an undefined `logDiscrepancy()`, was unreferenced anywhere). Its role is now covered by `Engine.Ingest.verifyImportToParent()` and `Engine.Ingest.verifyParentToLineup()`.
* **Next Targets**:
* Remove `repairEngineEnvironmentDefaults()` (obsolete hardcoded setup).
* Strip `config.js` down to essential UI/compatibility wrappers.
* Refactor `runSystemHealthCheck()` to eliminate hardcoded header creation.
* `parseDatesFromRange.js` — confirmed orphaned (called from nowhere in the current codebase), fully superseded by `SL.TheatricalParser` + `Engine.Ingest.parseParentDatesAndTimes()`. Safe to delete.
* `scriptLib_reconcile_gs` (`reconcileByFingerprint`, `reconcileVenuesByFuzzyFingerprint`) — confirmed pre-migration/outdated (hardcoded `VENUECALMAP`/`CREWCALMAP` legacy constants, calls `applyStatus()`/`masterLog()` instead of current `Engine.*` equivalents). Not safe to run as-is, but its `reconcileByFingerprint(params)` shape is the intended blueprint for the generalized reconciliation engine in Section 15 — retain for reference until that's built, then retire.
* `SL.MapRegistry.getMap()` — see Section 11, issue 23.



## 14. Guardrails & Verification Checklist

* **Guardrails**:
* Never hardcode field lists in repair or maintenance code.
* Never flatten object maps globally.
* Always default development test wrappers to `allowCalendarWrites: false`.


* Never mutate `Mode_Config` sheets during test runs.
* Check triggers and UI menu dependencies before deleting legacy functions.
* Maintenance routines that touch physical headers must key off `Header DisplayName`, never `Field Name` (Section 2).
* Maintenance routines must respect the headerless/do-not-touch sheet exemption list (currently `Lookup`; historically `import`) — do not add a routine that scans/writes physical row 1 without checking this list first (Section 11, issue 20).
* New general-purpose logic starts in `Engine.*`, not `scriptLib`, until proven stable and genuinely reused (Section 6).


* **Verification Checklist**:
* [ ] Execute `repairMapRegistry()` (once rewritten per Section 11, issue 19) and confirm a `MAP_REPAIR` entry in `Audit_Log`, with no duplicate rows produced on a header that was only renamed.
* [ ] Execute `Engine.Maintenance.runHealthCheck()` in read-only mode.
* [ ] Test `Draft` mode with `skipPush: true` (confirm venue mirror skipping).


* [ ] Test `Live` mode with `allowCalendarWrites: false` (confirm venue pull and log writing without calendar mutation).


* [ ] Perform controlled calendar push with explicit opt-in on a test row.
* [ ] Confirm `Audit_Log` accurately records mode, phase, reconciliation, and status transitions.
* [ ] Re-run `goLineup()` against the live `Parent Lineup` sheet and confirm the `SL.TheatricalParser` fix holds (target: 0 rows with `UNPARSEABLE_DATES`, aside from genuinely empty/TBD rows).
* [ ] Confirm `SpanDatePolicy`/`SpanOverride` are actually read by `goLineup()` once that code is re-uploaded and reviewed.
* [ ] Fix the `IMPORTRAFT` → `IMPORTDRAFT` typo in `Sheet_Settings` before relying on draft-role resolution.
* [ ] Apply the `repairHeaders()` headerless-sheet exemption before running it again.
* [ ] Run `resolveParentDuplicates()` to identify duplicate candidates; merge only after choosing keeper and duplicate IDs with `mergeParentDuplicate(keepParentID, duplicateParentID)`.
* [ ] Rerun `goParent()` and confirm Parent Lineup `SyncStatus`, `LastSynced`, `LastUpdated`, and `SyncHash` populate for new and changed rows.
* [ ] Rerun `goVerifyParentToLineup()` and confirm parser availability, nonzero Lineup checks, and status timestamps.
* [ ] Run `repairBlankHashes()` and confirm only blank `SyncHash` cells change, with repair counts in `Audit_Log`.
* [ ] Confirm `LOCKED`/`BYPASS` verification rows remain unchanged while `REVIEW_BLOCKED` entries are logged.
* [ ] Confirm `Possible Duplicate` rows create `PENDING` decision-log entries.

## 15. Roadmap / Deferred Feature Ideas

Captured 2026-08-22 from a series of design discussions. None of these are implemented; ordered roughly by dependency, not necessarily priority.

* **`AllowedBehaviors` enforcement** (Section 4/11) — foundational; several items below depend on this being real rather than loaded-but-unused.
* **`SyncCheck` as a new `Mode_Config` mode**: a mode with its own `AllowedBehaviors`/policy row, invoked by a scheduled trigger calling `Engine.Sync.runMasterSync({ modeName: "SyncCheck" })`. Depends on `AllowedBehaviors` enforcement being real first — otherwise the mode is decorative.
* **`import` → `Parent Lineup` change detection**: monitor the raw Draft Season import for changes while it's in active development (renamed events, changed dates, changed venues) and reflect those onto the Draft Season Google Calendar, matching on multiple signals (dates/times, venue, etc.) with different confidence levels driving auto-update vs. manual review. This is understood to unlock one of the project's original goals — using Google Calendar itself as an interaction surface for the draft season, with changes mirrored back to `Crew_Calendar_Log` (or its eventual successor, a proper draft-season log) and, eventually, into an updated Season Lineup export in delivery format.
* **Generalized reconciliation engine**: the shape common to `reconcileLogs()`, `syncCrewCalendar()`, and the `import` reconciliation above — source, destination, ID/fingerprint match, policy-gated log/sync/update/delete. The pre-migration `reconcileByFingerprint(params)` in `scriptLib_reconcile_gs` is a working prior draft of this exact shape and should inform the rebuild (modernized onto `SL.Identity.generate()`, object-shape maps, `Engine.Status.apply()`/`Engine.Log.write()`, and `ctx.mode.allowedBehaviors`). Per Section 6's promotion policy, build and prove this inside `Engine.*` before considering a `scriptLib` promotion.
* **Tiered reconciliation matching + revert path**: exact fingerprint match first; fuzzy substring title match (`vTitle.includes(cTitle) || cTitle.includes(vTitle)`, dropped during the Engine migration — Section 7) as an explicit fallback, not a silent equivalent; any fuzzy-based adoption must land in `Manual Review` rather than auto-confirm. This implies a genuine gap: there is currently no mechanism to revert/undo an adoption made in error. Needs design before the fuzzy fallback is reintroduced, not after.
* **Multi-day span → individual-dates conversion tool**: convert an already-exploded `MULTI_DAY` `Lineup` row (with `EndDate` set) into individual per-date rows on demand. Foundation already in place via the `EndDate` field and `MULTI_DAY` policy (Section 11, issue 15) — this tool would just re-run the day-by-day loop for one row on request rather than automatically.
* **Weekday filtering for `DAY_BY_DAY` span explosion**: not currently needed (per direct confirmation) — `DAY_BY_DAY` currently enumerates every calendar day in a span, including weekends. Flagged for future, not blocking.
* **Cross-workbook `Lookup` list sync** ("one lookup list to rule them all"): keep domain lists (`Venue`/`CallType`/`Series`/`CrewStaff`) consistent across this and other workbooks. Recommended approach: one canonical workbook, others as a scheduled one-way pull/mirror, rather than true bidirectional sync — Apps Script has no transactional guarantees, so simultaneous bidirectional edits risk real conflicts without a versioning scheme. Full bidirectional merge is a separate, harder feature to build only once one-way mirroring is proven insufficient.
* **`ref`-level Field Name master list**: a canonical enumeration of valid `Field Name`s across all sheets, for catching cross-sheet naming drift (e.g. `"UUID"` vs. `"uuid"` vs. `"ID"`). Decoupled from the `Map_Registry` repair fix — a data-quality lint, not a dependency of it.
* **`ControlPanel` restructure**: split into `Settings` (user-edited) and `Status` (system-written) sections, with several previously-implied-but-unwired toggles (`AutoApplyChanges`, `PushAllCrewLog`, `RunMapRepair`) either wired up or clearly marked as not-yet-functional rather than silently inert. A draft CSV was produced 2026-08-22; not yet imported/tested. Longer-term, `ControlPanel` is intended as the project's dashboard, with a friendlier UI layer planned on top — the Settings/Status split is meant to make that migration easier when it happens.
* **Calendar metadata expansion**: expand `Calendars` beyond display name, ID, and venue to include a deliberate calendar role plus read/write capabilities and any sync-window or mode restrictions. Replace name-based `Draft` detection with these metadata fields.
* **Registry and identity helpers**: consolidate sheet/role/map resolution and identity association into a small set of Engine helpers. `UniqueID` remains the idLog key because it can contain different ID forms; the source/record type determines how it is interpreted. An XLOOKUP-style spreadsheet helper is not required for runtime behavior, but a typed engine lookup by `UniqueID`, `RecordType`, and `SheetLocation` may be useful.
* **Sync policy enforcement**: return to `engine_sync.js` after the maintenance and ingest slices are stable. Enforce `AllowedBehaviors`, reconcile `UniqueID`/`UUID` registry usage, and add focused sync-menu tests before enabling calendar writes.
* **scriptLib stabilization**: maintain `scriptLib` as a separately versioned shared dependency with its own development intentions. Keep scheduler-specific registry maintenance in `Engine.Maintenance`; retire `SL.MapRegistry` after confirming no external project depends on it.
* **Recover deprecated functionality**: use the readable sources in `scriptLib/Depreciated` as references while rebuilding workbook-wide hash repair, generalized fingerprint reconciliation, venue fuzzy matching, and duplicate-row cleanup under current Engine/context APIs. Deprecated files are reference-only and must not export their former production names.
* **Row Actions and decision processing**: use a separate user-facing action surface for selected-row or supplied-ID operations. Keep `SyncStatus` as state, `Options` as an operational override, and `decision_log.Decision`/`RequestedAction` as the durable review command. `Apply Reviewed Decisions` processes reviewed rows and retains applied or failed rows outside the pending view.
* **Clean-slate project copy**: once each pipeline stage tests clean, copy to a fresh project with the current one retained as reference. (Carried over from prior planning; unchanged.)