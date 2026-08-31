# Legacy Features Integration Plan
- this file was compiled from a failed agent run. It likely belongs somewhat in ROADMAP.md, LEGACY_FEATURE.md, and potentially other locations. 

Plan: Restore Lost v1 Features (sched-1 → scheduler3) — v2
TL;DR — Six gaps confirmed by diffing sched-1 against the current engine. Ordered per your direction: status/row colors first, then the triage list in order. Reconciled against the updated LEGACY_FEATURES.md: its new §2.5/§3/§4 content is a separate build track, and two of its notes are now folded in (Phase 1 as the Staffing-sheet foundation; the formatting-preservation rule in Phase 6).

## Phase 1 — Status / row color system (first)
- see https://github.com/morrisontheatrical/scheduler3/issues/22
Clear-color path in Engine.Status.apply (engine_core.js): blank/"-" hex → setBackground(null) instead of painting white
Registry rows (Status sheet, not code): add "Manually Edited / Pending Push" (replaces v1's yellow-checkbox nudge concept); verify Bypassed / Delete Pending / To Delete on calendar all have hex + behavior rows
Sweep hardcoded hexes in live code (#f9cb9c in verifyCallsAndCrewLog) → route through Engine.Status
New (reconciliation): LEGACY_FEATURES §2.7 plans the Staffing sheet's color coding on top of Engine.Status.apply() — Phase 1 is its foundation; keep apply() generic, don't build Staffing here
Verify: paint + clear round-trip on a test row; blocksWrite correct per status; goHealthCheck passes
## Phase 2 — Calendar event colors by venue
CalendarColor column on Calendars sheet (seed from v1's map; default 10)
loadLookups reads it by header name (fixes the pre-existing row[1]/row[2] position hardcoding as a side effect)
Engine.Calendar.createEvent/updateEvent call event.setColor(...)
Restore "Update Crew Colors" menu → Engine.Calendar.recolorAll(ctx) (calendar ID from ctx.calendars, not v1's literal)
## Phase 3 — Rich-text link preservation
goLineup explode loop: capture getRichTextValues() from Parent Lineup, re-apply per child row in both the update and append branches (v1 processAdvancedSheet as pattern)
Check syncLineupToLog for the same flattening risk
Verify: hyperlink survives both fresh explode and re-explode over existing children
## Phase 4 — onEdit "pending push" flag
onEdit scoped to CREWCAL role's content columns (resolved via Engine.getColumnIndex), action = ## Phase-1 status via Engine.Status.apply
e.source === "user" guard — essential, or every engine sync self-flags rows
## Phase 5 — ID self-heal by fingerprint
reconcileLogs: unambiguous fingerprint match → rebind EventID + Engine.IDService.upsert + "Adopted from Venue"; ambiguous → Manual Review + pending Engine.Decisions entry (never guess)
Restore "Recover Missing IDs" menu item
## Phase 6 — Reports + menu restorations
Engine.Reports (engine_reports.js): byDateWindow + byFlag, written to a Reports sheet via Engine.IO.batchWrite — create the module so the LEGACY_FEATURES track's later methods (pullUpcomingForEdit, writePaperworkLayout) extend it rather than duplicate it
Map_Registry.isHidden + hideColumn/showColumn (your notes TO DO)
Menu: Mirror Venues → Scheduler menu; add "Reset Log"
New (reconciliation): all report writers use clearContent(), never touch header formatting, never force bold/gray — per §2.5's rule and the known resetHeaders bug (which stays its own issue, not fixed here)
Scope boundaries (updated): the LEGACY_FEATURES build order — CALLS SheetRole registration, Engine.Venues, Engine.Search + feed schema, getEventDetail, Staffing, pullUpcomingForEdit, writePaperworkLayout + PAPERWORK_* roles, Engine.Docs, sidebar UI — is a separate track. One carried-in open question: whether legacy Lineup's "confirmed" checkbox (col J/K/L, §4) became a SyncStatus value — if so, byFlag can power a "confirmed only" report.

# Response (errored)

Corrections vs. the old plan
1. CALLS IS a registered role — you were right. Sheet_Settings.csv has a full row: Calls, callID, MIRROR, OVERWRITE_ALLOWED, …, CALLS, gid 1104329532, and Map_Registry.csv has all 18 columns typed (including parentID, childID, callID, eventID chain). LEGACY_FEATURES.md's "prerequisite" claim is stale — scanSheet("CALLS", ctx) already works. The real state is just: the sheet has headers only because the import→Parent→Lineup focus left it unpopulated (your note, and confirmed by the empty Calls.csv).

2. isHidden already exists in Map_Registry — the column is present (all rows currently FALSE). So Phase 6's item isn't "add the registry option" — it's purely the hideColumn/showColumn code wiring. seth's notes.md TO DO is half-done already.

3. Phase 1's new status is redundant — Status.csv already has "Field AutoUpdated" (#fff2cc, SYNC_ALLOWED, note: "value changed for a field in this row") — that is the "edited, pending push" status. I was about to invent a duplicate. The real gap is just that nothing sets it (which is Phase 4's onEdit — it just needs a target, and one already exists).

4. The Calendars sheet has more columns than I knew — CalendarRole (Venue / draft_season / crew_calls) and allowCalendarWrites exist. This is better for Phase 2: the crew calendar should be identified by CalendarRole = "crew_calls" (and it's the exact same c_0ef07… ID that v1 hardcoded) instead of me adding yet another ad-hoc mechanism. Only CalendarColor is genuinely new.

5. Lineup still carries the window-flag columns — AfterToday, WithinQuarter, WithinMonth exist in both Map_Registry and the live sheet (currently blank, and I found zero code that computes them). So Phase 6's byFlag has ready-made flag fields, and someone's job is to populate them (or byDateWindow computes the same thing on the fly).

6. Phase 5 overlaps ROADMAP vocabulary — the decision vocab already includes ADOPT_VENUE_EVENT as a RequestedAction. The self-heal should emit/reuse that action type rather than inventing a new path.

7. Backburners confirmed — Staffing and the Paperwork_* sheets explicitly deferred per your direction (and Roadmap items 18/19/20 — Custom Sync, Detailed Reporting, Detailed Inspection — are the proper homes for the adjacent work, so I'll mark them as linkages, not scope).

Let me rewrite the plan file with these corrections baked in.