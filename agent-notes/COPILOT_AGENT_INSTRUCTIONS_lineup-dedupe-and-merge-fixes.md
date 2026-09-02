# Agent Instructions: Lineup Dedupe Key + Merge Selection + ReviewType Fixes

Branch: `#Status-Color` (or a new branch off it — these are unrelated to the status
coloring work, so a separate branch like `fix/lineup-dedupe-merge` is fine if preferred).

## Context

Investigation of `Explode Dates` producing duplicate rows in `Lineup` traced to three
separate, independently-fixable bugs. Apply all three patches below. Do not run
`goLineup()`, `repairMapRegistry()`, or any merge/apply-decisions command as part of
this task — code changes only. Data cleanup is a separate, manual step described at
the bottom of this document.

---

## Fix 1 — `goLineup()` de-dupe key uses an unreliable field

**File:** `engine_ingest.js`
**Function:** `goLineup()`

**Problem:** The existing-row lookup key is built from `row[lCol("RawDateStr")]`, and
the new-row lookup key is built from a freshly formatted `dateStr`
(`"MM/dd/yyyy HH:mm"`). On every real run so far, the physical column mapped to the
`RawDateStr` field has held the original raw import text (e.g.
`"Friday, June 5, 2026 at 7:30pm"`), not the `"MM/dd/yyyy HH:mm"` string the code
computes. The two never match, so every run treats all dates as new and appends a
full duplicate set of rows instead of updating in place. The `Date` column (a real
parsed date, not raw text) is reliably populated on every existing row regardless of
this mismatch, so switch the key to that instead.

**Before:**
```javascript
  const existingRecords = {};
  lData.forEach((row, idx) => {
    const key = `${row[lCol("parentID")]}|${row[lCol("RawDateStr")]}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lCol("UUID")] };
  });
```

**After:**
```javascript
  const existingRecords = {};
  lData.forEach((row, idx) => {
    const existingDate = new Date(row[lCol("Date")]);
    if (isNaN(existingDate.getTime())) return; // can't key an unparseable existing row; leave it alone
    const key = `${row[lCol("parentID")]}|${existingDate.getTime()}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lCol("UUID")] };
  });
```

**Before:**
```javascript
    entries.forEach((entry, index) => {
      const dateStr = Utilities.formatDate(entry.date, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${dateStr}`;
      const record = existingRecords[lookupKey];
```

**After:**
```javascript
    entries.forEach((entry, index) => {
      const dateStr = Utilities.formatDate(entry.date, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${entry.date.getTime()}`;
      const record = existingRecords[lookupKey];
```

`dateStr` is still computed and still written into `RawDateStr` further down
(`rowArray[lCol("RawDateStr")] = dateStr;`) — leave that line as-is. This patch only
changes what the *matching* is keyed on, not what gets written to the sheet.

---

## Fix 2 — `resolveMergeSelection()` ignores the reviewer's `KeepParentID` for `KEEP_OTHER`

**File:** `engine_decisions.js`
**Function:** `Engine.Decisions.resolveMergeSelection`

**Problem:** When a reviewer sets `KeepChoice = KEEP_OTHER` and fills in
`KeepParentID` with a specific parent ID they've chosen, the branch below discards it
and falls back to `SuggestedKeepID` first. If `SuggestedKeepID` happens to equal
`ExistingParentID` (true for every `PARENT_ONLY`-style decision, since there's no real
candidate pair), `resolvedKeepID` collapses to the same value as `resolvedDuplicateID`
and `mergeParentDuplicate()` throws `"requires two different parent IDs"`. This is the
recurring `DECISION_FAILED` seen across multiple `Apply Reviewed Decisions` runs.

**Before:**
```javascript
    } else if (keepChoice === "KEEP_OTHER") {
      resolvedKeepID = suggestedKeep || keepID || existingID;
      resolvedDuplicateID = decision.DuplicateParentID || fallbackCandidate || "";
    }
```

**After:**
```javascript
    } else if (keepChoice === "KEEP_OTHER") {
      resolvedKeepID = keepID || suggestedKeep || existingID;
      resolvedDuplicateID = decision.DuplicateParentID || fallbackCandidate || "";
    }
```

`keepID` is already defined earlier in this function as
`String(decision.KeepParentID || decision.ExistingParentID || "").trim()` — this
change just lets the reviewer's explicit `KeepParentID` win over the engine's
suggestion, which is the whole point of `KEEP_OTHER`.

---

## Fix 3 — `PARENT_ONLY` decisions are mislabeled `ReviewType: IMPORT_PARENT`

**File:** `engine_ingest.js`
**Function:** `Engine.Ingest.verifyImportToParent` (the `pData.forEach` block that
generates Parent-only review items)

**Problem:** `addDecision()` inside `verifyImportToParent` defaults every decision to
`ReviewType: "IMPORT_PARENT"` unless the caller's `values` object supplies its own
`ReviewType`. The drift/rename branch (`iData.forEach`) is correctly an
import-vs-parent comparison, so the default is right there. The Parent-only branch
(`pData.forEach`) never sets `ReviewType`, so every `PARENT_ONLY_*` row silently gets
labeled `IMPORT_PARENT` even though its own `ReviewID` says otherwise. This doesn't
currently break `refreshParentOnlyDecisions()` (it filters on `ReviewID` prefix, not
`ReviewType`), but it's misleading when reviewing the queue and worth correcting at
the source.

**Before:**
```javascript
    const decisionValues = {
      ReviewID: `PARENT_ONLY_${pRow[pCol("parentID")] || rowIdx}`,
      SourceSheet: hasExactSourceMatch ? "import" : "",
```

**After:**
```javascript
    const decisionValues = {
      ReviewID: `PARENT_ONLY_${pRow[pCol("parentID")] || rowIdx}`,
      ReviewType: "PARENT_ONLY",
      SourceSheet: hasExactSourceMatch ? "import" : "",
```

---

## Verification steps (for the agent to run after patching, read-only)

1. Confirm `goLineup` and `Engine.Ingest.verifyImportToParent` still parse/lint
   cleanly — no other logic in either function references `RawDateStr` for matching
   purposes (a plain-text search for `RawDateStr` in `engine_ingest.js` should only
   show the `dateStr` write line after this patch).
2. Confirm `resolveMergeSelection`'s other three branches (`KEEP_EXISTING`,
   `KEEP_CANDIDATE`, `KEEP_SOURCE`) are unchanged.
3. Do not run `test_DiagnosticDump`, `goLineup`, or `Apply Reviewed Decisions` as part
   of this task — leave verification of runtime behavior to Seth.

---

## Not included in this patch — manual data cleanup still needed

These fixes stop the problem from recurring but do **not** retroactively clean up the
duplicates already created:

- `Lineup` currently has 122 rows with composite-format identifiers
  (`P-XXXXXXXX-Cxx`, blank `EventOfTotal`, `SyncStatus = Manual Review`) sitting
  alongside 140 rows with proper GUID `UUID`s and populated `EventOfTotal` — a
  duplicate pair for the same `parentID` + date in 53 cases.
- `idLog` has zero entries in the GUID `UUID` format at all — none of the 140 current
  rows are registered. Only 1 of the 262 total `Lineup` rows has any `idLog` entry.
- Recommended order once these code fixes are merged: reconcile/delete the old
  composite-ID rows in `Lineup` (keep the GUID-format rows, which are the ones your
  current pipeline and `Crew_Calendar_Log` sync actually expect), then run
  `Engine.IDService.syncAll()` once to register the survivors in `idLog`.
- This cleanup touches live data and should be done deliberately by Seth, not as part
  of an automated agent pass.
