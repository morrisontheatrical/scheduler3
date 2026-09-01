---
description: Coding conventions, sheet-access rules, and documentation practices for the scheduler3 Google Apps Script project. Load for any code generation, review, or issue work.
applyTo: '**/*.js'
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

# Project Context

scheduler3 is a Google Apps Script + Google Sheets theatrical production scheduling
system built around an `Engine.*` / `ctx` architecture (see `ARCHITECTURE.md`). It
is mid-migration from an older flat-global-function style. Always write new code in
the `Engine.*`/`ctx` pattern — never extend the legacy pattern, even if the nearest
existing code in the file uses it. If a legacy function needs a change, prefer
migrating it over patching it in place, unless the task explicitly says otherwise.

# Sheet & Data Access — read before editing anything that touches a sheet

- Never hardcode a literal sheet name inside `Engine.*` functions
  (`ss.getSheetByName("Parent Lineup")`, `ctx.getMap("Lineup")`, etc.). Resolve
  through `SheetRole` instead:
  - Season-paired layers (Import / Parent / Lineup — sheets that exist as both a
    "Current" and "Draft" version): `Engine.getSeasonSheet(ctx, "PARENT")` or
    `Engine.Roles.resolve(ctx, "BASE")` + `ctx.getMap(role)`.
  - Any other managed sheet (Lookup, decision_log, idLog, Audit_Log, etc.):
    `Engine.getSheetByRole(ctx, "ROLE")`.
  - See `Sheet_Settings.csv` for the Sheet Name ↔ SheetRole association and
    `ref.csv` for the full list of roles.
- `CREWCAL` / `DRAFTCAL` / `VENUECAL` are purpose-distinct destinations, not a
  season pair of one sheet — route between them explicitly (see
  `Engine.Ingest.syncLineupToLog()` for the pattern). Do not run them through
  `Engine.Roles.resolve()`.
- Acceptable exceptions: functions that run before the role map exists, or that
  build/repair the role map itself (`assembleSheetMap`, `loadModeConfig`,
  `repairMapRegistry`, etc.). If unsure whether a function qualifies, ask rather
  than assume — don't silently add a new hardcoded exception.
- All column access goes through `Engine.getColumnIndex(map, fieldName)` — never
  a literal index or a raw `row[N]`.
- `Field Name` (in `Map_Registry`) is the stable cross-sheet identity key. Never
  match, sort, or key on `Header DisplayName` — that's user-facing label only.

# Mode & Season Awareness

- `ctx.mode.targetSeason` (`"Draft"` | `"Current"`) determines which physical
  sheet a season-paired role resolves to. Any new or modified ingest/sync/decision
  function that reads or writes Import/Parent/Lineup data must be season-aware
  from the start — don't write current-season-only behavior and defer draft
  support as a follow-up ticket.
- When touching a function that currently hardcodes a current-season sheet name,
  fix the season-awareness in the same change rather than leaving a comment about
  it — this codebase already has several TODOs of that shape; don't add another.

# Documentation Rules

- Architecture decisions go in `ARCHITECTURE.md`. User-facing procedures go in
  `OPERATIONS.md`. Priorities and open decisions go in `ROADMAP.md`. Don't blend
  these — a PR that changes behavior should update the doc that describes that
  behavior, not append a note to whichever file is easiest to find.
- Don't invent documented features that aren't implemented yet, and don't
  present planned/aspirational behavior as current architecture.

# Testing & Verification

- The agent cannot execute Apps Script. Never state or imply that a change was
  tested. Every non-trivial change ends with an explicit, numbered testing
  checklist the human can run manually — which menu item(s), in which mode(s),
  and what to check in `Audit_Log` or the affected sheet afterward.
- Destructive or registry-mutating operations (`repairMapRegistry`, header
  resets, bulk merges/deletes) must have a dry-run/diagnostic-preview path.
  Never propose one of these as the first or only step in a fix — if a task
  seems to require a destructive op and no preview path exists yet, say so
  instead of proceeding.

# Change Format

- When delivering changes as instructions rather than a direct commit, use exact
  `Find:` / `Replace with:` code blocks copied verbatim from the current file
  content — no paraphrasing, no "make a similar change here" shorthand.
- Reference the GitHub issue number a change addresses, both in the commit
  message and in the instructions doc's header.

# Issue Workflow

- When an issue is resolved, offer a closing comment summarizing what changed,
  which files/functions were touched, and any follow-up spun out into new
  issues — not just "done."
- Before proposing to close an issue, state explicitly whether the change fully
  covers the issue's original scope or only part of it (e.g., a bug fix vs. the
  broader audit the issue actually asked for).