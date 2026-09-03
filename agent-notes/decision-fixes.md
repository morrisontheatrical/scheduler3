# Plan: Improve the decision system (issue #7)

**TL;DR** — The purge rule (applied = deleted, SUPERSEDED = retained, removed via `Archive Superseded Decisions`) is *already mostly live*. The real gaps are identity, healing, evidence/links/history, and coverage. Three independently-verifiable phases: **A** lifecycle/identity, **B** evidence/links/history, **C** new coverage. A & B parallel; C depends on A's stable-ID helper.

## Phase A — Lifecycle & sticky decisions
1. **Content-derived, stable `ReviewID`** — new `Engine.Decisions.stableReviewID(type, parentID, evidenceKey)` using the canonical `SL.Identity._hashString` (no new hash). Replaces `IMPORT_PARENT_${index+2}_…` (engine_ingest.js:1348) and `IMPORT_DRIFT_${parentID}` (engine_ingest.js:1764). Same drift ⇒ same ID across IMPORTRANGE reflows.
2. **Unify `IMPORT_PARENT` / `IMPORT_DRIFT`** — they describe the *same* import→parent drift but dedupe independently, so one drift can spawn two queue rows. Pick one canonical type, one ID scheme.
3. **Clean-match healing in `verifyImportToParent`** — when a matched parent is `comparison.equal` and its status is an *engine-set* diagnostic (allowlist, e.g. `Data Drift Detected`), reset to `Synced` + `markSuperseded`. **Never** touches user-intent statuses; `blocksWrite` still wins.
4. **Enforce purge rule** — every resolved path deletes (applied/rejected) or supersedes (healed); SUPERSEDED leaves only via `archiveSuperseded`. Re-verify on an accepted, now-clean row must not re-queue.

## Phase B — Evidence, links & history
5. **Canonical evidence** — `Engine.Decisions.formatEvidence(comparison)` from `Engine.IO.compare().changed[]`, applied at all generators (roadmap #8).
6. **`refreshLinks` for import rows** — add `resolveImportRow` + import↔parent branches (currently only `PARENT_DUPLICATE` handled).
7. **decision ↔ Audit_Log cross-link** — join by **`ReviewID`** (Audit_Log inserts at row 2, so row numbers are unstable).
8. **"Refresh Stale Reviews"** — consolidate `refreshParentOnlyDecisions` + `refreshParentDuplicateDecisions` into one `refreshRelevantDecisions` menu action (the "is this still relevant?" surface).

## Phase C — New coverage (depends on A1)
9. **Decisions from `goLineup` (Explode Dates) + Parent-vs-Lineup verify** — keyed on `parentID` + parsed date/time + `UUID`.
10. **Lineup/Draft duplicate suggestions** — port `buildParentDuplicateSuggestions` to the Lineup layer.
11. **Read-only candidate report + explicit keeper selection** — user sets `KeepChoice`, `applyPending` executes (existing `resolveMergeSelection` already honors it).

## Relevant files
- `scheduler3/engine_decisions.js` — `addPending`, `markSuperseded`, `applyPending`, `refreshLinks`; **add** `stableReviewID`, `formatEvidence`, `refreshRelevantDecisions`
- `scheduler3/engine_ingest.js` — `verifyImportToParent`, `acceptImportDrift`, `goLineup`, the two `refreshParent*` functions
- `scriptLib/SL_Identity.js` — `_hashString` (canonical hash)
- `scheduler3/engine_core.js` — `Engine.Status.apply`/`blocksWrite`, `Engine.Log.write`
- `scheduler3/0_OnOpen.js`, `0_temp.js` (contract harness), `ARCHITECTURE.md`/`ROADMAP.md`

## Verification
- `0_temp.js` harness: assert `stableReviewID` stable across two synthetic reflows, changes when a value changes.
- Draft + Live manual: drift → Verify → accept → re-Verify (no spurious re-queue); user-status rows untouched; links resolve; archive works.
- `clasp push` after each phase.

## Decisions & your `idLog` question
- **Identity:** content-derived ID via `SL.Identity` (your choice). **Healing:** auto in Verify, allowlist-only (your choice).
- **History storage — "could it live in idLog?"** My recommendation: *no, keep the current model* — `decision_log` retains SUPERSEDED rows, applied rows are deleted, and **`Audit_Log` is the durable history** (joined by `ReviewID`). `idLog` is identity-centric (UniqueID registry + Merged-IDs aliases); forcing temporal decision fields in there would conflate two domains the docs deliberately keep separate. If the goal is per-ID *lineage* (which decisions touched a `parentID`), the complement is a light provenance pointer in idLog — but full history stays in Audit_Log. I've left this as a follow-up, out of scope for this round.

## Open for you (before I'd consider this ready to execute)
1. **History:** accept Audit_Log-as-history, or add a per-`parentID` provenance pointer in idLog?
2. **Phase C scope:** which lineup-level actions raise decisions (orphan row, date-span drift, both)?
3. **Stable-ID hash:** changed-field *names* only, or names **+ values** (so a different change on the same field is a new decision)? I lean names+values.

Want me to lock these three and refine the plan, or leave C's scope as a TBD to revisit after A/B land?