# Normalize and Normalize Title

**These may have already been partially addressed**
**There is a normalize function in scriptLib.Utils**

## What the data shows

Looking at your `Audit_Log.csv`, the 8/29 16:46 run of **Verify Import vs Parent Lineup** reports:

```
checked: 57, flagged: 57, renamedCandidate: 57, importOnly: 0, parentOnly: 12
```

**Every single checked row** fell through to the rename-candidate fallback path — none matched by exact title. But when I check the actual `Parent Lineup` rows the audit log names (e.g. parentID `P-7A4A3B3C`), the `EventName` is literally `"RYOT: Summer Show (TBA)"` — the same text the log prints for the import side. These titles *are* the same event, but `goVerifyImportToParent()` isn't recognizing that, so it routes every one of them through the "possible rename" branch and stamps `Possible Duplicate`, generating a decision for something that isn't actually ambiguous.

There are two separate problems layered here:

**1. The exact-title match (`pByName`) is failing for titles that look identical.** Since Opening/Range/Venue still match 1:1 for every row (that's *why* it falls back to the rename path instead of `importOnly`), the titles are almost certainly differing by something invisible to the eye — smart quotes vs straight quotes, en/em dashes vs hyphens, or a stray zero-width character picked up somewhere in the IMPORTRANGE → Parent Lineup round trip. `normalize()` only collapses whitespace; it doesn't fold that kind of typographic noise.

**2. Even for a genuinely clean match, `verifyImportToParent()` currently does nothing.** If `drifted` is false and `isRenameCandidate` is false, there's no `else` — no status write, no log entry, no clearing of a status left over from a prior run. So once a row gets stamped `Possible Duplicate`, it stays that way forever unless a human resolves the decision, even after the data lines back up. That's the concrete "should say they're in sync" gap you flagged.

Here's a patch for `engine_ingest.js` that fixes both, inside `Engine.Ingest.verifyImportToParent`:

**1. Add a title-aware normalize and use it for the name match:**Here's the patch, as text diffs for your Copilot agent to apply to `engine_ingest.js`:

**Change 1 — replace the `normalize`/`pByName` setup near the top of `verifyImportToParent`:**

```js
// BEFORE
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });
```

```js
// AFTER
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  // Titles that round-trip through IMPORTRANGE or get manually retyped commonly
  // pick up "smart" punctuation (curly quotes, en/em dashes) or a stray
  // zero-width character that plain normalize() won't catch. That mismatch was
  // sending clean title matches down the rename-candidate path and mislabeling
  // them "Possible Duplicate." normalizeTitle() folds that noise away for title
  // comparisons specifically; Opening/Range/Venue/Pricing still use normalize().
  const normalizeTitle = value => normalize(value)
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalizeTitle(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });
```

**Change 2 — use `normalizeTitle` for the lookup, and re-check the title before calling it a rename:**

```js
// BEFORE
    let match = pByName[normalize(name)];
    let isRenameCandidate = false;

    if (!match) {
      const candidates = pData
        .map((row, rowIdx) => ({ row: row, rowIdx: rowIdx + 2 }))
        .filter(candidate => ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iRow[iIdx]) === normalize(candidate.row[pIdx]);
        }));
      if (candidates.length === 1) {
        match = candidates[0];
        isRenameCandidate = true;
        renamedCandidate++;
      } else {
```

```js
// AFTER
    let match = pByName[normalizeTitle(name)];
    let isRenameCandidate = false;

    if (!match) {
      const candidates = pData
        .map((row, rowIdx) => ({ row: row, rowIdx: rowIdx + 2 }))
        .filter(candidate => ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iRow[iIdx]) === normalize(candidate.row[pIdx]);
        }));
      if (candidates.length === 1) {
        match = candidates[0];
        // Same Opening/Range/Venue, and once typographic noise is folded out the
        // title matches too — this isn't a rename, it's the same plain-normalize()
        // match that the pByName lookup missed. Treat it like a direct hit.
        const titleReallyMatches = normalizeTitle(name) === normalizeTitle(match.row[pCol("EventName")]);
        if (!titleReallyMatches) {
          isRenameCandidate = true;
          renamedCandidate++;
        }
      } else {
```

**Change 3 — heal a stale review status when a row turns out to be a clean match.** Find the `if (drifted || isRenameCandidate) { ... }` block later in the same function (the one that calls `applyReviewStatus(...)`) and add an `else`:

```js
// AFTER the existing closing brace of `if (drifted || isRenameCandidate) { ... }`, add:
    } else {
      // Clean match: Opening/Range/Venue/Pricing agree and the title matches.
      // If a prior run left this row in a review status, clear it — this is
      // the "should say they're in sync" case instead of staying flagged forever.
      const currentStatus = pSheet.getRange(match.rowIdx, pCol("SyncStatus") + 1).getValue();
      const reviewStatuses = ["Manual Review", "Possible Duplicate", "Data Drift Detected"];
      if (reviewStatuses.includes(currentStatus) && !Engine.Status.blocksWrite(ctx, currentStatus)) {
        Engine.Status.apply(ctx, "Parent Lineup", match.rowIdx, "Active", {
          stage: "VERIFY_IMPORT",
          id: match.row[pCol("parentID")],
          details: `Confirmed in sync with import "${name}"; cleared "${currentStatus}".`
        });
        if (Engine.Decisions && typeof Engine.Decisions.markSuperseded === "function") {
          Engine.Decisions.markSuperseded(
            ctx,
            `IMPORT_PARENT_${index + 2}_${match.row[pCol("parentID")] || "NO_PARENT_ID"}`,
            `Row now matches import "${name}"; no drift detected.`
          );
        }
      } else if (pCol("LastSynced") >= 0) {
        pSheet.getRange(match.rowIdx, pCol("LastSynced") + 1).setValue(new Date());
      }
    }
```

Note that block also needs the original `if (drifted || isRenameCandidate) {` — I'm not repeating the unchanged interior, just showing where the new `else` attaches.

**Before you run this broadly:** I'm inferring the typographic-mismatch cause from the exported CSVs alone — I don't have the `import` sheet's raw values to confirm it directly. Worth a quick sanity check first: pick one flagged pair (e.g. `P-7A4A3B3C` / "RYOT: Summer Show (TBA)"), and in the script editor log `[...name].map(c => c.charCodeAt(0))` for both the import and Parent Lineup title, to see exactly where they diverge before trusting the fix at scale.

One more thing worth flagging: this only touches `verifyImportToParent` (import↔Parent). It doesn't touch Parent-to-Parent duplicate suggestions, or the future Lineup-to-Lineup / Crew-to-Crew comparisons — but the "heal status back to Active + supersede the stale decision when a clean match is confirmed" pattern here is one you'll likely want to replicate there, since the same "flag never clears itself" gap will show up in any of those checks.