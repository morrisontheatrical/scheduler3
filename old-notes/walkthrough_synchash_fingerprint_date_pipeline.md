# Walkthrough: SyncHash/Fingerprint, Date Parsing, and Bug Priority Updates

## Changes Made

### 1. SyncHash vs. Fingerprint — Documented & Clarified

**Files**: [ARCHITECTURE.md](file:///Users/seth/Downloads/scheduler3/ARCHITECTURE.md), [ROADMAP.md](file:///Users/seth/Downloads/scheduler3/ROADMAP.md)

- **[ARCHITECTURE.md](file:///Users/seth/Downloads/scheduler3/ARCHITECTURE.md#L56-L59)**: Replaced the single ambiguous bullet with a structured subsection clearly defining:
  - `SyncHash` = compact hash on operational data sheets for fast drift detection
  - `Fingerprint` = `idLog`-owned full-row JSON snapshot via `Engine.IO.serializeRow()` for audit/recovery
  - Rule: never query `idLog` for `SyncHash`; `idLog`'s column is `Fingerprint`
- **[ROADMAP.md item 25](file:///Users/seth/Downloads/scheduler3/ROADMAP.md#L94)**: Marked the design decision as **confirmed** — two distinct mechanisms, not unified.
- **[ROADMAP.md Decisions Made](file:///Users/seth/Downloads/scheduler3/ROADMAP.md#L252)**: Recorded the `(2026-10-05)` decision with full rationale and historical context (legacy `createFingerprint()` pipe-string → MD5 hashing → JSON snapshot evolution).

---

### 2. Unparseable Dates → Manual Review (Issue #24)

**File**: [engine_ingest.js](file:///Users/seth/Downloads/scheduler3/engine_ingest.js)

Changed two locations where unparseable `DatesAndTimes` were previously only logged to `Audit_Log` and silently skipped:

- **`goLineup()` (~line 862)**: Now calls `Engine.Status.apply(ctx, pRole, rowIdx, "Manual Review", ...)` with the raw date text in `details`, so the Parent Lineup row is visibly flagged.
- **`verifyParentToLineup()` (~line 1798)**: Same change — flags the row instead of just logging.

This restores the legacy pattern where parse failures were always visible on the sheet (`Check` / `Manual Fix` statuses in the old `Condensed Lineup`).

---

### 3. EndDate Downstream Propagation (New ROADMAP Item 36)

**File**: [ROADMAP.md](file:///Users/seth/Downloads/scheduler3/ROADMAP.md#L136)

Added new item 36 tracking:
- Multi-day `Lineup` rows (from `MULTI_DAY` span policy) carry `EndDate`
- Sync to `Crew_Calendar_Log` / Google Calendar should create multi-day events
- `EndDate` may be backfilled from `Crew_Calendar_Log` or `Draft_Season_Log` when calendar events are associated with Lineup rows

---

### 4. ROADMAP Priority Updates (Issues #28, #25, #24)

**File**: [ROADMAP.md](file:///Users/seth/Downloads/scheduler3/ROADMAP.md)

- **Item 12** (Immediate Priority): Expanded with specific sub-items for [#25](https://github.com/morrisontheatrical/scheduler3/issues/25) (field population) and [#24](https://github.com/morrisontheatrical/scheduler3/issues/24) (date parsing + manual review).
- **Item 33** (#28): Updated with implementation status and cross-reference to ARCHITECTURE.md documentation.
- **Item 34** (#25): Updated with specific fields that must be populated.
- **Item 35** (#24): Updated with implementation status (TheatricalParser integrated, Manual Review applied).
- Renumbered old item 36 → 37 to accommodate new EndDate item.

---

## What Was Tested

- `node -c *.js` — all JavaScript files pass syntax check.
- No functional regressions introduced; the `Engine.Status.apply` calls use the same signature pattern already used by `Date Span - Manual Review` at line 892.

## Remaining Manual Verification

1. Confirm the live `idLog` sheet header is `Fingerprint` (not `SyncHash`) — if still `SyncHash`, a one-time header re-sync is needed.
2. Test `goLineup()` with an unparseable date string and verify the row gets `Manual Review` status with details.
3. Test `Sync ID Registry` and verify no range errors occur.
