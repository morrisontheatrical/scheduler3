# Plan: Incremental (cell-level) Venue Calendar Mirror

Status: DRAFT, not committed to. Written 2026-10-05.

## Background

`Engine.Sync.mirrorVenues` ([engine_sync.js](../engine_sync.js)) currently clears all of `Venue_Cal_Log` and rewrites every row via `batchWrite`. Consequences:

- Manually or engine-assigned `UUID` (lineup link) values are wiped each run.
- Every row gets a new `LastSynced`; there is no record of *what* changed.
- Events that vanish from the calendar silently disappear.

Already done (interim fixes):

- [engine_calendar.js](../engine_calendar.js) `global_pullCalendarEvents` no longer sets `UUID = eventID` (blank instead).
- `mirrorVenues` snapshots `EventID -> UUID` before the clear and restores it after. This patch becomes unnecessary once this plan lands (remove it then).

## Goals

1. Only write cells whose values actually changed.
2. Record field-level change details so reconcile/review can surface them.
3. Never touch columns the mirror does not own: `UUID`, `Options`, `ParentID`, `Call Type`.
4. Handle events that disappear from the calendar explicitly.

## Facts

- `idKey` for `VENUECAL` is `EventID` (Sheet_Settings).
- Columns: EventID, Title, Date, Start, End, End Date, Location, Options, Description, Source, UUID, Last Synced, Sync Status, Last Updated, Update Details, Call Type, ParentID, SyncHash.
- `sortLogByDate` reorders rows, so match by EventID, never by row number.
- Pull window is `syncWindow.startDays` (default 14) back to `endDays` (default 400) forward.
- `patchRows` ([engine_IO.js](../engine_IO.js)) rewrites whole rows one at a time and is not suitable as-is.

## Design

### Owned vs. preserved columns

| Owned (mirror writes) | Preserved (never written on existing rows) |
|---|---|
| Title, Date, Start, End, End Date, Location, Description, Source, Last Synced, Last Updated, Sync Status, Update Details, SyncHash | UUID, Options, ParentID, Call Type |

### Algorithm (new `Engine.Sync.mirrorVenues` body, helper in engine_IO.js)

1. Pull events from all non-Draft calendars (unchanged).
2. `existing = scanSheet("VENUECAL")`; build `Map<EventID, row>` incl. `_rowNum`.
3. For each pulled event:
   - No existing row: queue as **new** (append).
   - Existing: compare owned fields with a normalizer (below). Collect `changes = [{field, old, new}]`.
     - No changes: skip (optionally stamp `Last Synced` only; decide, see Open Questions).
     - Changes: queue cell updates for changed fields only; set `Last Updated`, `Sync Status` = "Updated", `Update Details` = `field: old -> new; ...`, recompute `SyncHash`.
4. Existing EventIDs not in the pull:
   - If the stored Date is inside the pull window: mark **Deleted/Cancelled** (status + Update Details, keep row).
   - If outside the window: leave alone (aged out, not deleted).
5. Apply writes in batches (see Writes).
6. Run `sortLogByDate`, `IDService.syncAll` as today.

### Normalization (main bug risk)

Sheets returns `Date` objects for Date/Start/End; the pull returns `Date` objects too, but timezone/format and empty-vs-null differ.

- Date/End Date: compare as `yyyy-MM-dd` in script timezone.
- Start/End: compare as `HH:mm` in script timezone.
- Strings: `String(v || "").trim()`; collapse `\r\n` to `\n` for Description.
- Treat `null`, `undefined`, `""` as equal.
- Unit-testable pure function: `normalizeVenueField(field, value, tz)`.

### Writes

Apps Script cell writes are slow. Options, simplest first:

1. Per-column contiguous batching: for each changed field, `setValues` on the minimal bounding range only if many rows changed; otherwise `setValue` per cell (typical run changes few cells).
2. Appends: single `setValues` of all new rows at `lastRow + 1`.
3. Deleted-marking: batch via same cell-update queue.

Cap/log: write count per run via `Engine.Log.info`.

### Sheet/config touchpoints

- No new sheet columns needed (`Sync Status`, `Update Details`, `Last Updated` exist).
- Confirm `Map_Registry` maps these for VENUECAL (note existing TODO in `reconcileLogs` about `Map_Registry` capitalization of EventID).
- Add `Sync Status` values used ("Updated", "Deleted") to the status reference sheet if `ctx.status` requires them to be known.

## Implementation steps

1. Add `normalizeVenueField` and `diffVenueEvent(existingRow, pulledEvent, tz)` (pure functions).
2. Add `applyVenueMirror(ctx, role, pulled, existing)` returning `{added, updated, unchanged, deleted}`.
3. Rewrite `mirrorVenues` step 3 to use it; remove the clear and the UUID-snapshot patch.
4. Handle the zero-event case: do not mark everything deleted if the pull returned 0 events or a calendar failed (guard: only mark deleted for calendars that pulled successfully).
5. Log summary counts; log per-change detail at a debug type listed in `allowedLogTypes`.
6. Update docs: OPERATIONS.md, ARCHITECTURE.md (Phase 1 mirror description).

## Testing

- Dry-run mode: compute and log the diff without writing; run against the real sheet first.
- Cases: no change; title change; time change; date change; new event; removed event inside window; event aged out of window; calendar fetch failure; pre-populated UUID preserved; row order changed by sort between runs.
- Verify idempotence: two consecutive runs produce zero writes on the second.

## Risks

- Date/time normalization false positives (mitigated by pure function + dry run).
- Calendar fetch failure misread as mass deletion (mitigated by step 4 guard).
- Window edge handling.
- Slower than a single bulk write when most rows change (first run after a long gap); acceptable, or fall back to full rewrite of owned columns when changes exceed a threshold (e.g. >50%).

## Open Questions

1. Missing events: mark "Deleted" and keep the row, or remove the row?
2. Stamp `Last Synced` on unchanged rows ("last seen"), or leave untouched? Stamping costs one column write per run.
3. Should `Update Details` accumulate history or only hold the latest change?
4. Should changes to a venue event linked to a lineup UUID raise a Manual Review decision (via `Engine.Decisions`)? Likely the next step after this plan.

## Estimate

About 100-150 lines of new code plus tests and docs; one session of work.
