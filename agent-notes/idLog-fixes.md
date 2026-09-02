# Plan: idLog Cluster (#28 → #23/#27 → #4 → #8)
- drafted: 09/01/2026
- last updated: 09/01/2026

**REVIEW ME**

TL;DR — One idlog-cluster branch, four phases in dependency order. Phase 1 fixes the Sync ID Registry crash (your #28) by resolving the SyncHash/Fingerprint naming split in favor of Fingerprint (the registry's current field name — the 2026-08-28 revert direction). Phases 2–4 layer on: idLog hyperlinks (#23/#27), the Merged-IDs alias + cascading re-point (#4), and the Fingerprint row-snapshot (#8).

## Root cause of #28 (concrete)
Engine.IDService.syncAll (engine_IDService.js) does Engine.getColumnIndex(idLogMap, "SyncHash") → -1 → getRange(row, 0) → GAS "The starting column of the range is too small." The registry's field for that column is Fingerprint, not SyncHash (health check 08-29 confirms the header mismatch; ROADMAP item 242 confirms the deliberate revert). upsert() and runMasterSync() (engine_sync.js) carry the same latent bug; loadRegistry() (engine_core.js) only survives because it reads the physical header.

## Steps

### Phase 1 — fix #28 (blocker; parallel edits)

1. engine_IDService.js upsert() + syncAll() — swap every "SyncHash" idLog lookup for "Fingerprint"; rename the local var to fingerprintCol.
2. engine_sync.js runMasterSync() — getCol("ID_LOG","SyncHash") → "Fingerprint"; either keep the in-memory key SyncHash or rename to Fingerprint and update the one reader in reconcileLogs (~line 281).
3. engine_core.js loadRegistry() — physical-header lookup "SyncHash" → "Fingerprint".
4. Repo-wide grep for "SyncHash" in idLog context — fix or comment. Do not rename SyncHash on the data sheets (Lineup/Parent/Lineup/Crew_Log/Venue_Log).

### Phase 2 — #23 + #27 idLog hyperlinks
5. New Engine.IDService.applyLinks(ctx) in engine_IDService.js, modeled on Engine.Decisions.refreshLinks (engine_decisions.js:187) and _setLinkedValue (engine_decisions.js:178).
6. Per idLog row: UniqueID → Engine.makeSheetRowLink(ctx, sheetName, row, label) (engine_core.js:209) parsed out of SheetLocation ("SheetName!R123"); ParentID (when not N/A) → link to the survivor's row resolved via the registry; Title stays plain.
7. Write via setFormula; guard: only when SheetLocation parses and the target sheet exists in ctx.sheets.
8. Menu item Refresh ID Registry Links under Diagnostics in 0_OnOpen.js → new test_RefreshIDRegistryLinks(); also call applyLinks at the end of syncAll.

### Phase 3 — #4 Merged IDs alias + cascade
9. Add MergedIDs column to idLog (Map_Registry row + physical header). Run previewMapRegistryRepair first (registry mutation — agent-instructions require a preview path).
10. In Engine.Ingest.mergeParentDuplicate (engine_ingest.js:553), alongside the existing Merged write, append the duplicate ID to the survivor's MergedIDs (comma-separated, dedup).
11. Verify the existing cascade (engine_ingest.js:590-602) covers Lineup (draft+current), Crew_Calendar_Log, Venue_Cal_Log, Calls.
12. In Engine.Decisions.refreshParentDuplicateDecisions, add a pass that looks up ExistingParentID in idLog; if SyncStatus == "Merged", re-point to the survivor and log DECISION_REPOINTED. This is the fix for the four "stuck IMPORT_PARENT" rows from #4's comments (P-EE42C06B → P-B28326D8).

### Phase 4 — #8 Fingerprint snapshot (largest; do last)
13. At syncAll write time, compute the source row's full-row JSON via scanSheet + Engine.IO.serializeRow (engine_IO.js:7) and store in the Fingerprint column. The hash stays on the data sheets as SyncHash.
14. At merge/delete time (step 10), snapshot the doomed row into Fingerprint for post-merge recovery.
15. Add a deserializeRow + field-diff helper (ROADMAP item 6) for drift comparison.

## Relevant files

- engine_IDService.js — upsert(), syncAll() (Phase 1, 2, 4)
- engine_core.js — makeSheetRowLink(), loadRegistry() (Phase 1, 2)
- engine_sync.js — runMasterSync(), reconcileLogs() (Phase 1)
- engine_decisions.js — refreshLinks(), _setLinkedValue(), refreshParentDuplicateDecisions() (Phase 2 template, Phase 3)
- engine_ingest.js — mergeParentDuplicate() (Phase 3)
- engine_IO.js — serializeRow, deserializeRow, scanSheet (Phase 4)
- 0_OnOpen.js — Diagnostics menu (Phase 2)
- Map_Registry (sheet) + Sheet_Settings (sheet) — MergedIDs column (Phase 3)
- OPERATIONS.md / ROADMAP.md — update per agent-instructions doc rules (each phase)

## Verification (agent cannot run GAS — all manual checklists)

🧪 Dev / Test → Sync Tests → Sync ID Registry → no exception; Audit_Log Registry Sync: N new IDs added.
Run Health Check → idLog header-mismatch warning resolved.
Click a UniqueID in idLog → jumps to source row. Click a non-N/A ParentID → jumps to parent's source row.
Run a PARENT_DUPLICATE apply (use the #4 fixture P-EE42C06B / P-B28326D8). Confirm: survivor's MergedIDs = old ID; all child sheets re-pointed; previously-stuck decision rows re-pointed or SUPERSEDED.
List Pending Decisions → no more "row not found" on those IDs.
After a merge, idLog row for the deleted ID has a parseable JSON Fingerprint; the new diff helper returns the correct changed-field list on two snapshots.
Decisions

Naming direction: code → Fingerprint (registry wins). Data-sheet SyncHash stays.
One branch, four phases, each independently verifiable before the next.
scriptLib extraction of a universal link helper (raised in #27) is deliberately deferred until the local implementation is proven.
The "sticky decision fingerprint" design question from #4's comments is a separate concern from #8's Fingerprint — do not let idLog become the decision-audit system.

## Further considerations

1. Before Phase 1, confirm the physical idLog header on your live workbook is Fingerprint (not SyncHash). If it's still SyncHash, we need a one-time Read Sheet Headers into Registry re-sync first — which is itself a registry mutation and should be previewed.
2. Phase 3 step 12 (stale-decision re-point) has an alternative: mark SUPERSEDED instead of re-pointing. Recommendation: re-point (preserves the decision's intent); SUPERSEDE only when the survivor itself has drifted.
3. Phase 4 step 13 changes Fingerprint semantics from "hash" to "JSON snapshot". If you'd rather keep the hash in that column too, I can split into two columns (Fingerprint + SyncHash) — but that's the "two columns" option you didn't pick. Flagging so we can revisit if it becomes a problem.


Anything to adjust? In particular: (a) is Title OK to leave as plain text in idLog, or do you want it linked too? (b) confirm the physical header is already Fingerprint so Phase 1 doesn't need a re-sync step.
