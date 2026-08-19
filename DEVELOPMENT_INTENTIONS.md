# Scheduler Development Intentions

This file records the architectural intentions and decisions for the scheduler project. It is a project memory document, not runtime configuration.

## Core Architecture

- Google Apps Script and Google Sheets are the runtime platform.
- `Engine.getContext()` is the canonical entrypoint for runtime context.
- The engine is the source of truth for sync, configuration, sheet definitions, maps, modes, logging, status, and identity tracking.
- Legacy scripts may remain temporarily as compatibility wrappers, but they must not contain a second implementation of engine behavior.
- Avoid hardcoded schema knowledge wherever workbook metadata can provide it.

## Sheet Metadata Model

- `ctx.sheets[name]` is the raw Google Apps Script `Sheet` object.
- `ctx.sheetDefs[name]` is the richer sheet definition containing:
  - `sheet`
  - `map`
  - `settings`
  - `role`
- A map is intentional object metadata belonging to a sheet definition.
- Map entries are normally object-shaped, for example `{ index: 7 }`.
- Numeric map entries may be accepted for compatibility, but new code should preserve object maps.
- Convert a map entry to a numeric column only at a Sheets row/range access boundary.
- Use `Engine.getColumnIndex(map, fieldName)` or `ctx.getCol(identifier, fieldName)` for conversion.
- Missing or invalid map fields should return `-1`, not silently become `undefined`.

## Map Registry

- `Map_Registry` is authoritative for field-to-column mappings.
- `Sheet_Settings` identifies managed sheets and stores sheet-level settings and roles.
- Repair must discover managed sheets from workbook metadata, read physical row-1 headers, and reconcile them with `Map_Registry`.
- Do not hardcode field lists for `Mode_Config`, `Lookup`, or any other sheet in repair code.
- Repair may:
  - add physical headers missing from the registry
  - update registry column indices when columns move
  - report missing sheets
  - report duplicate physical headers
  - report duplicate registry entries
  - report stale registry fields
- Repair must not silently delete registry rows or rewrite physical headers.
- Health checks are read-only comparisons.

## Mode Configuration

`Mode_Config` is the runtime policy table. The current intended fields are:

- Mode Name
- Description
- IsActive
- SyncMode
- ConflictPolicy
- PreferredTruth
- WriteToCalendar
- WriteToSheet
- UseLiveVenueMirroring
- AllowedBehaviors
- AllowedLogTypes

Intentions:

- Exactly one mode should normally have `IsActive = TRUE`.
- Draft mode normally skips live venue mirroring.
- Live mode may mirror venue calendars.
- Allowed log types are parsed into arrays in the engine.
- Mode policy must not be inferred from calendar names or scattered ControlPanel logic.

## Runtime Testing

- Mode configuration and temporary test runtime are separate concepts.
- `Mode_Config` controls persistent operational policy.
- Runtime overrides control one execution and must not modify `Mode_Config` or `IsActive`.
- Calendar writes must be explicitly controlled during development.
- Development tests should default to `allowCalendarWrites: false`.
- Sheet reconciliation and sheet logging may run during sheet-only tests.
- Supported runtime options include:
  - `modeName`
  - `allowCalendarWrites`
  - `skipMirror`
  - `skipReconcile`
  - `skipPush`
- Example:

```javascript
Engine.Sync.runMasterSync({
  modeName: "Live 26-27",
  runtime: {
    allowCalendarWrites: false,
    skipPush: true
  }
});
```

- Apps Script cannot directly invoke methods inside a `var Engine = ...` namespace from the function picker. Provide top-level wrappers for development and testing.
- Existing development wrappers include:
  - `test_DiagnosticDump`
  - `test_MirrorVenues`
  - `test_DraftModeSheetOnly`
  - `test_LiveModeSheetOnly`
  - `test_CustomRuntimeSheetOnly`
  - `test_ReconcileLogs`
  - `test_SyncCrewCalendar`
  - `test_SyncIDRegistry`
  - `test_RefreshDropdowns`

## Sync Ownership

The active sync path is:

1. `Engine.Sync.runMasterSync()` loads context and registry state.
2. `Engine.Sync.mirrorVenues(ctx)` mirrors live venue calendars when the mode permits it.
3. `Engine.Sync.reconcileLogs(ctx)` compares crew intent with venue reality.
4. `Engine.Sync.syncCrewCalendar(ctx)` pushes crew events when calendar writes are allowed.

Every phase should be callable through a top-level Apps Script test wrapper.

## Logging

- `Audit_Log` is the operational record.
- Mode selection should be logged at sync start.
- Map repair should log a `MAP_REPAIR` entry with added, updated, and warning counts.
- Log filtering should use exact canonical values from `AllowedLogTypes`.
- Avoid old substring checks such as `includes("CONFLICT")` when the configured value is `CONFLICT_VENUE`.

## Legacy Cleanup Boundaries

Completed cleanup:

- Removed `masterAggregatorSync()` from `0_OnOpen.js`.
- Removed the obsolete `1_sync venue cal.js` module.
- Removed unreachable venue-sync fallback implementations from `0_draft season.js`.
- Kept `writeNewSeason()` and `pullDraftCal()` as thin compatibility wrappers.

Next cleanup candidates:

- Remove `repairEngineEnvironmentDefaults()` because it uses obsolete hardcoded setup and calls nonexistent APIs.
- Reduce `config.js` to only required compatibility/UI helpers.
- Review `runSystemHealthCheck()` because it still creates hardcoded infrastructure headers and conflicts with registry authority.
- Keep `1_verify.js` only as a temporary diagnostic reference; migrate it to object-map access or archive it.
- Keep destructive calendar cleanup separate until a mode-aware, explicitly confirmed utility exists.
- Check Apps Script installable triggers before removing any remaining legacy top-level function.

## Guardrails

- Do not reintroduce hardcoded field arrays into maintenance or repair logic.
- Do not flatten object maps globally.
- Do not make development tests write to calendars by default.
- Do not change workbook configuration just to test a mode.
- Do not delete legacy code until menu items, triggers, and cross-file references have been checked.
- Do not fix unrelated legacy bugs while removing code unless they block the active engine.

## Verification Checklist

Before calling the engine ready:

- Run `repairMapRegistry()` and inspect the `MAP_REPAIR` audit entry.
- Run `Engine.Maintenance.runHealthCheck()` and confirm discrepancies are reported without mutation.
- Test Draft sheet-only mode and confirm venue mirroring is skipped.
- Test Live sheet-only mode and confirm venue data is read and written to the venue log, but no calendar writes occur.
- Test custom runtime with `skipPush: true`.
- Test calendar writes only with an explicit opt-in and a controlled test row.
- Verify `Audit_Log` contains mode, phase, conflict, reconciliation, and repair entries.
- Run syntax checks on all modified Apps Script files.
