# Legacy Feature Recovery: Formula-Era Scheduler → Engine

This document reviews the exported sheets and formulas from the earlier,
formula-driven version of the workbook and proposes how each feature could
be rebuilt on top of the current `Engine.*` / `SheetRole` / `Map_Registry`
architecture, rather than as spreadsheet formulas.

Source material reviewed:
- `Scheduling_25-26 - Lineup2.csv` (the exploded Lineup sheet, with parse-status columns)
- `Scheduling_25-26 - Calls.csv`
- `Scheduling_25-26 - Crew_Calendar_Log.csv`
- `Show_Staffing_SP25 - Sheet1.csv` + screenshot (role-based staffing grid)
- `Call times.md` (a Google Doc with linked-cell tables, exported to Markdown)
- `cell-formulas.md` (the live formulas behind search/filter sheets)
- `Scheduling 25-26.pdf` — a full export of the live workbook (all tabs:
  `f`, `Crew_Calendar_Log`, `Thru Next Month`, `Thru Next Q`, `linFilter`,
  `Piano Tuning`, `Lineup`, `Lineup2`, `Condensed Lineup`, `Calls`,
  `CallsFilter`, `Filtered Calls Only`, `Biweekly Calls Only`,
  `Master Biweekly Call Times`, `Event Card`, `Schedule Searchv2`, `sync`).
  This confirmed several things §1's first pass could only infer from
  formulas alone — see the callouts marked **(confirmed by PDF)** below.

No code from those formulas is reusable as-is (it's spreadsheet-native
FILTER/REGEXMATCH/SORT, not Apps Script), but the **behavior** each formula
encodes is a legitimate feature spec. That's what this doc extracts.

---

## 1. What the legacy sheet actually did

Reading `cell-formulas.md` in order, a picture emerges of five cooperating
pieces:

### 1.1 `f` — a unified, normalized event feed
```
=SORT(VSTACK(
  linFilter (from Lineup, tagged "Lineup"),
  Calls (tagged "Calls"),
  PerformanceSpaces (tagged "PerfCalendars")
), 2, TRUE)
```
Three different sources — parsed performance dates, crew calls, and venue
calendar pulls — were stacked into one table with a `Source` tag column,
**and venue names were normalized** through a hardcoded `SWITCH()` (raw
Google Calendar resource names like `"166-1-Black box (100)"` → friendly
names like `"Theatre 166"`). This normalized, tagged, unioned feed is what
every other search/filter sheet in the workbook actually queried.

**(confirmed by PDF)** The live `f` tab has columns `Event Name, Date,
Time, Type, Description, Venue, End Time, Source, Remove from Filter,
Event ID` — and rows tagged `PerfCalendars` already carry normalized venue
names (`Main Stage`, `Theatre 166`, `Ballroom`, ...) plus a real Google
Calendar `Event ID`. That answers the open question from the first pass
of this doc: **`PerformanceSpaces` is your venue calendar pull** — the
direct ancestor of `VENUECAL` / `Venue_Cal_Log`, not a fourth,
unaccounted-for source. `Engine.Search.buildFeed` in §2.1 can treat it as
such with no gap to fill.

The `Remove from Filter` column is the row-level exclusion flag
referenced as `L:L<>True` in the search/report formulas. It's a *data*
flag (hide this specific row from search), distinct from the `isHidden`
*column*-visibility idea already in `seth's notes.md` — worth keeping
those two concepts separate when you build them. In the current engine
this one doesn't need new plumbing at all: it's functionally the same
thing `Bypassed`/behavior-based status filtering already does in
`Engine.Status.blocksWrite`, so `Engine.Search.query` can just skip rows
whose status behavior includes `BYPASS`, the same way sync does.

### 1.2 `ScheduleSearchv2` — faceted live search
A single `FILTER()` over `f` with independently-optional criteria:
- date range toggle (rolling "today → next month" **or** exact date match)
- staff name, regex word-boundary match against a comma list
- venue, call type, series — each optional, each `REGEXMATCH`
- excluded a `Hidden`/delete checkbox column (`L`)

This is a general-purpose "find events matching any combination of these
filters" search — not tied to one report.

### 1.3 `EventCard` — detail lookup
```
=FILTER(Calls!A:F, Calls!A:A=C6)
```
Given an event title in a cell, pull every associated Calls row. This is
the "click an ID, see everything about it" pattern already on your radar —
`UI-Design.md` calls it out directly as **Detailed Inspection Popup**.

**(confirmed by PDF, and bigger than I first thought)** The live `Event
Card` tab isn't just the one `FILTER`. It has individual fields — `Title`,
`Guests`, `Start time`, `End time`, `Location`, `Description` — plus an
`Event Schedule` section, and **two buttons wired to real Apps Script**:
- *"Press to recall row info from lineup"*
- *"Press to pull the next (15 days)? from lineup (to then be able to
  edit)"*

The same two buttons/captions also appear on the `Calls` tab. So this
wasn't a pure-formula system after all — there was already a thin script
layer doing two things formulas can't: (1) populating the Event Card's
individual fields from a selected row (a "load this record" action,
distinct from `FILTER`'s live array), and (2) pulling a rolling 15-day
window of upcoming Lineup events into an **editable** staging area —
presumably so calls could be drafted/adjusted before being finalized,
without those edits fighting a live formula. That second one is a real,
previously-undocumented feature: a manual "snapshot the next N days for
editing" action, separate from anything in my first pass of this doc.
**I don't have the actual script source for these two buttons** — only
their button captions, from the PDF. If you still have that script
(check the old Apps Script project attached to this legacy sheet, or
`Tools > Script editor` if the legacy sheet is still reachable), it's
worth pulling — it'll tell me exactly what "row info" and "editable pull"
meant, instead of me inferring it from a button label.

### 1.4 Windowed/flagged reports
Several near-duplicate formulas (`Calls Filter`, `Master biweekly call
times`, `Thru Next Month`, `Thru Next Q`, `Piano Tuning`) all do the same
shape of thing: filter a sheet by a **date window** (today → EOMONTH+N) or
by a **boolean flag column** (`Piano Tuning?`, a "confirmed" checkbox,
etc.), sometimes combined. `Lineup` computed three of these windows as
per-row boolean helper columns (`afterToday`, `Within Next Quarter`,
`Within Next Month`) that downstream filters then referenced.

### 1.5 `Condensed Lineup` → parse pipeline
Columns A–G were literally `=Import!A:A` through `=Import!G:G` — a **live
formula reference**, not a copy — with parse-status columns appended
(`Parsed Date`, `Parsed Time`, `Status` = `Success` / `Check` / blank, plus
`Manual Fix` sentinel values). This is the direct ancestor of your
`SL.TheatricalParser` + `Date Span - Manual Review` work — the *pattern*
(parse, flag failures distinctly, let a human fix in place) is one you've
already carried forward. The one thing that *didn't* carry forward is
surfacing parse status as a queryable, visible column rather than only an
audit-log entry.

### 1.6 Linked-cell Google Doc (`Call times.md`)
A Doc with tables whose cells are linked to Sheet ranges (Docs' native
"linked table" feature — updates via a manual "Update" click in the Doc,
no Apps Script involved). Four sections, each a distinct query:
- **Linked Call Times**: day-grouped roster for the *current* biweekly window
- **Next Month's Events**: one row per show, opening date + parsed
  date/time + a hyperlink to that show's run-of-show Doc
- **Full Month Schedule**: everything (calls + shows) for the month, flat
- **Next Q's Events**: like "Next Month" but wider window, plus a `Venue`
  and `Staff` column

Each event name is a hyperlink to a per-show Google Doc (run-of-show /
tech rider), and some rows link to a Drive folder of related documents.
This is a **letterhead-formatted, printable schedule** — the audience is
the venue's House Managers and outside stakeholders, not just crew.

### 1.7 `sync` — the actual calendar-write staging sheet, and a data lineage note

**(new from PDF)** There's a `sync` tab with generic `Column 1`...`Column
7` headers, holding what looks like the same shape of data as `f`. Cross-
referencing this against `Crew_Calendar_Log.Source` values — which are
`"Sheet 8"`, `"Calls"`, or `"Lineup"` — `sync` is almost certainly the
renamed/former `"Sheet 8"`: a staging table that got pushed to the actual
Crew Calendar. That's useful **lineage** context even though it's not a
feature to rebuild on its own — it confirms the three-source tagging
pattern (`Lineup` / `Calls` / venue-or-staging) survived all the way to
the final synced log, and your current `Crew_Calendar_Log.Source` field
is a direct continuation of that same idea. No action needed here beyond
noting it, in case old `Source="Sheet 8"` values ever show up during a
historical data import and need explaining.

### 1.8 `Schedule Searchv2` — the search UI was a plain sheet, not a sidebar

**(confirmed by PDF)** The live tab shows the actual input layout: a row
of labeled cells — `Select Date` / `Multiple Selection`, `Select Venue:`,
`Select Series:`, `Select Staff:`, a `This Month` toggle, `Select Type:`,
`Select Event:` — sitting above the `FILTER` results table. So this was a
plain sheet with a handful of named input cells feeding one formula, not
a custom dialog or sidebar. That's a useful data point for the "sidebar
vs. plain sheet" decision raised in §2.1/§2.5 below — the sheet-based
approach isn't a hypothetical fallback, it's exactly the workflow you
already used and trusted for a season.

### 1.9 `Show_Staffing_SP25` — role assignment grid
This one has no formula equivalent in `cell-formulas.md` — it looks
hand-maintained. One row **per show** (not per performance instance — note
`2/28 - 3/7` as a single row), with named-role columns: `House Manager`,
`Stage Manager/Tech Lead`, `Lights`, `Sound`, `Deck Chief`, `Fly Rail`,
`Spot 1`, `Spot 2`, plus `Notes`. Color coding: yellow = block/placeholder
range, orange/red = date rows needing attention, solid black = role not
applicable to that venue/show. This is meaningfully different from
`Crew_Calendar_Log` (which tracks *when crew are called*) — it tracks
**who is assigned to which named production role**, independent of call
times.

---

## 2. Mapping each feature onto the current Engine

None of these need to come back as spreadsheet formulas — your own
architecture principle ("spreadsheet metadata governs runtime behavior,"
`Map_Registry`/`SheetRole`-driven, no hardcoded columns) is a *better* fit
for all five than `REGEXMATCH` chains were. Below is a proposed new
module per feature, using your existing naming conventions.

### 2.1 `Engine.Search` — replaces `f` + `ScheduleSearchv2`

```javascript
Engine.Search = {
  // Builds the unified, tagged, venue-normalized feed on demand.
  // Sources come from SheetRole, not hardcoded sheet names:
  // LINEUPCURRENT/LINEUPDRAFT, CREWCAL, VENUECAL.
  buildFeed: function(ctx, options) {
    const roles = options.roles || ["LINEUPCURRENT", "CREWCAL", "VENUECAL"];
    let feed = [];
    roles.forEach(role => {
      scanSheet(role, ctx).forEach(row => {
        feed.push(Object.assign({}, row, {
          _source: role,
          _venue: Engine.Venues.normalize(ctx, row.Venue || row.Location)
        }));
      });
    });
    return feed;
  },

  // criteria: { dateFrom, dateTo, exactDate, staff, venue, callType, series, title }
  query: function(ctx, criteria, options) {
    const feed = this.buildFeed(ctx, options || {});
    return feed.filter(row => Engine.Search._matches(row, criteria));
  }
};
```

Why this is better than the formula version, not just a port:
- Column positions never leak into filter logic — everything goes through
  `Engine.getColumnIndex`/`scanSheet`, so it survives header moves.
- It's mode-aware for free: pass `roles: ["LINEUPDRAFT", ...]` to search
  the draft season instead of duplicating every formula sheet.
- `Engine.Status.blocksWrite`/behavior checks can filter out
  `Bypassed`/`Delete Pending` rows the same way sync already does, instead
  of one hardcoded `L:L<>True` checkbox.
- Regex-per-field logic (staff, venue, type) becomes a small, testable JS
  function instead of five near-identical nested `IF(...,REGEXMATCH(...))`
  clauses that have to be copy-pasted into every new report sheet.

**Where does the UI live?** Two options, not mutually exclusive:
- A sidebar (`HtmlService`) calling `Engine.Search.query` via
  `google.script.run` — matches the "Detailed Inspection Popup" /
  "Custom Sync Scoping" ideas already in `UI-Design.md`.
- A `Search Results` sheet where a menu item (`Engine.Search.query` +
  `batchWrite`) writes results into a plain range — closer to the old
  feel, no HTML service needed, but not live/reactive like `FILTER()` was.

The PDF export confirms `Schedule Searchv2` really was the second
option: a row of labeled input cells (date/venue/series/staff/type/event)
above a results table, no custom UI at all (see §1.8). That's a real
precedent, not just a lower-effort fallback — you ran a full season on
exactly this pattern. I'd still lean toward a sidebar as the long-term
home (it also fits `EventCard`'s "load a record" button below more
naturally than a sheet does), but given the precedent, **the plain-sheet
version is a legitimate first cut, not just a stopgap.** Flagging as a
decision point either way.

### 2.2 `Engine.Venues` — replaces the hardcoded `SWITCH()`

The venue-name normalization table shouldn't live inside a formula (or
inside Apps Script code) — it's exactly the kind of thing your
`ARCHITECTURE.md` principle says belongs in a sheet:

```
New sheet or Lookup columns: "Venue Aliases"
| RawCalendarResourceName            | FriendlyVenueName |
|-------------------------------------|--------------------|
| Main-1-Onstage (1400)               | Main Stage         |
| 166-1-Black box (100)               | Theatre 166        |
| Main-2-Ballroom (80)                | Ballroom           |
| ...                                  | ...                |
```

```javascript
Engine.Venues = {
  normalize: function(ctx, rawName) {
    const alias = (ctx.lookup.venueAliases || {})[String(rawName || "").trim()];
    return alias || rawName;
  }
};
```
Loaded in `Engine.loadLookups` alongside the existing `Calendars`/`Lookup`
processing. This also means adding a new venue alias later is a sheet
edit, not a code deploy — consistent with how `Calendars` already works.

### 2.3 `Engine.Search.getEventDetail()` — replaces `EventCard`

The legacy version matched on event **title text** (`Calls!A:A=C6`),
which is exactly the fragility your `parentID`/`UUID` identity chain was
built to eliminate. The Engine version should walk the real chain instead:

```javascript
Engine.Search.getEventDetail = function(ctx, parentID) {
  return {
    parent: /* Parent Lineup row for parentID */,
    lineupRows: /* Lineup rows where row.parentID === parentID */,
    crewCalls: /* Crew_Calendar_Log / Calls rows whose UUID ties to a lineupRow */,
    pendingDecisions: Engine.Decisions.pending(ctx).filter(d =>
      d.ExistingParentID === parentID || d.CandidateID === parentID)
  };
};
```
This single call gives a sidebar (or a future popup) everything
`UI-Design.md`'s "Detailed Inspection Popup" describes — including
pending review items, which the legacy `EventCard` had no concept of.

This is also the natural home for the legacy Event Card's *"Press to
recall row info from lineup"* button (§1.3) — a button/menu item that
calls `getEventDetail` and writes the result into the individual
Title/Guests/Start/End/Location/Description fields, the same shape the
old card used.

The second legacy button — *"pull the next (15 days) from lineup, to
then be able to edit"* — is a different, genuinely new-to-this-doc
feature: a **rolling editable snapshot**, not a live query. Proposed
equivalent:

```javascript
Engine.Reports.pullUpcomingForEdit = function(ctx, options) {
  const days = (options && options.days) || 15;
  const rows = Engine.Reports.byDateWindow(ctx, "LINEUPCURRENT",
    { start: new Date(), end: /* +days */ });
  batchWrite("STAGING_ROLE_OR_SHEET", rows, ctx); // plain cells, not a formula
};
```
Writing plain values (via `batchWrite`, like everything else in
`engine_IO.js`) rather than a live `FILTER()` is what makes the result
editable without fighting the formula — matching what the legacy button
was clearly for. Where the output lands (a dedicated staging sheet vs. a
sidebar-editable list) is an open question in §4, since I don't have the
original script to confirm intent.

### 2.4 `Engine.Reports` — replaces the windowed/flagged filter sheets

Instead of six near-duplicate FILTER formulas, one parametrized function:

```javascript
Engine.Reports = {
  // windowType: "TODAY_TO_MONTH" | "TODAY_TO_QUARTER" | "EXACT_DATE" | custom {start,end}
  byDateWindow: function(ctx, role, windowType, options) { ... },

  // Generalizes the "Piano Tuning?" one-off filter to any boolean field.
  byFlag: function(ctx, role, fieldName, value) {
    return scanSheet(role, ctx).filter(row => row[fieldName] === value);
  }
};
```

`byFlag` is worth calling out because it directly satisfies an item
already sitting in `seth's notes.md`:

> Add `isHidden` option to `Map_Registry` — `hideColumn`/`showColumn`

The same registry-driven-boolean-field idea generalizes cleanly: any
Yes/No column in `Map_Registry` (Piano Tuning, Needs Follow-up, whatever
comes next) becomes reportable with zero new code, the same way adding a
`Venue Aliases` row needs zero new code. This is a good argument for
building `byFlag` and the `isHidden` column feature together rather than
as two separate efforts.

### 2.5 `Engine.Docs` — replaces the linked-cell Google Doc

Two real options here, genuinely different trade-offs — **this is the
biggest open decision in this whole doc**, so I'm laying out both rather
than picking one:

**Option A — keep native Docs linked-ranges (no script).**
Recreate `Call times.md`'s tables as linked ranges pointing at
`Engine.Reports` output written to a plain sheet (e.g. a `Reports` sheet
with named ranges `CurrentBiweekly`, `NextMonthEvents`,
`FullMonthSchedule`, `NextQuarterEvents`). You run the report functions
from the menu, then click "Update" in the Doc same as before.
- *Pro:* zero Apps Script maintenance for the Doc itself; you already know
  this workflow.
- *Con:* still a manual two-step (run report → click Update in Doc);
  per-show hyperlinks to run-of-show Docs still have to be maintained
  somewhere (see below).

**Option B — `DocumentApp`-generated Doc.**
```javascript
Engine.Docs.generateCallTimesReport = function(ctx, options) {
  const doc = DocumentApp.create(...); // or open a template
  const biweekly = Engine.Reports.byDateWindow(ctx, "CREWCAL", "CURRENT_PAY_PERIOD");
  const nextMonth = Engine.Reports.byDateWindow(ctx, "PARENTCURRENT", "TODAY_TO_MONTH");
  // ...build tables via doc.getBody().appendTable(...)
};
```
- *Pro:* one menu click, fully regenerated, letterhead/branding baked into
  a template; per-show links can pull straight from a new `RunOfShowDocURL`
  field you add to `Parent Lineup`'s `Map_Registry` entry, so the link
  lives with the event data instead of being hand-typed into a Doc.
- *Con:* real implementation work; Doc formatting via `DocumentApp` API is
  more fiddly than "build a table in Docs by hand."

My instinct is **Option A first** (fast, reuses a workflow you already
trust, and `Engine.Reports` is useful either way), with Option B as a
later upgrade once `Engine.Reports` is stable — same "finish fixes in the
current project first" philosophy you're already applying elsewhere.

### 2.6 New sheet/role: `Staffing` (or similar) — replaces `Show_Staffing`

This is the one legacy feature with **no current equivalent at all** —
worth being explicit about that rather than folding it into
`Crew_Calendar_Log`, which answers a different question ("when is crew
called") than staffing does ("who owns Lights/Sound/Deck for this show").

Proposed shape, consistent with your existing layers:
- New `SheetRole`: `STAFFINGCURRENT` / `STAFFINGDRAFT` (mirrors the
  `PARENTCURRENT`/`PARENTDRAFT` pattern)
- **Keyed by `parentID`**, not `UUID` — one row per *show*, matching the
  screenshot's `2/28 - 3/7` single-row-per-run behavior, not per
  performance instance. This makes it a sibling of `Parent Lineup` rather
  than a child of `Lineup`.
- Role columns (`HouseManager`, `StageManagerTechLead`, `Lights`, `Sound`,
  `DeckChief`, `FlyRail`, `Spot1`, `Spot2`, ...) defined in `Map_Registry`
  like every other sheet — new roles are a registry row, not a code
  change.
- Color coding: rather than hand-painted cells, this maps naturally onto
  your existing `Engine.Status.apply()` machinery — e.g. a `TBD` status
  per assignment behaves like any other status with a `Status` sheet hex
  color, instead of being manually maintained.
- Crew name values should validate against the same `Lookup.CrewStaff`
  list `Engine.Maintenance.applyDropdowns` already drives — so a typo'd
  name here shows up the same way it would anywhere else.

---

## 3. Suggested build order

Roughly cheapest/most-reusable first, each one unblocking the next:

1. **`Engine.Venues`** — small, self-contained, and `Engine.Search`,
   `Engine.Reports`, and the eventual Doc export all depend on
   normalized venue names.
2. **`Map_Registry.isHidden` + `Engine.Reports.byFlag`** — already on
   your TO DO list; do it alongside this since `Engine.Reports` needs it
   anyway.
3. **`Engine.Search` (query + feed-building)** — the load-bearing piece;
   ship it as a `Reports` sheet output first, sidebar later.
4. **`Engine.Search.getEventDetail`** — small once #3 exists; delivers
   the "Detailed Inspection Popup" from `UI-Design.md` almost for free.
5. **`Staffing` sheet/role** — independent of the above; can be started
   any time once you're ready to define its `Map_Registry` rows.
6. **`Engine.Reports.pullUpcomingForEdit`** — small, depends only on
   `Engine.Reports`; worth confirming against the original button script
   first if you can find it (§4).
7. **Doc export (`Engine.Docs`, Option A or B)** — last, since it
   consumes #1–#3 and you'll want the underlying reports stable first.

---

## 4. Open questions for you

- ~~`PerformanceSpaces` mapping~~ — **resolved**: it's the venue calendar
  pull, i.e. `VENUECAL` / `Venue_Cal_Log` (see §1.1).
- **The two Event Card / Calls buttons' actual script** (§1.3) — I only
  have their captions from the PDF, not the code behind them. If that
  Apps Script project is still reachable (old sheet's `Extensions >
  Apps Script`, or a `.gs` export), it would tell me exactly what "recall
  row info" and "pull the next 15 days for editing" did, rather than me
  inferring behavior from a button label. This directly affects how
  faithfully `Engine.Search.getEventDetail` and the proposed
  `Engine.Reports.pullUpcomingForEdit` (§2.3) should be built.
- **Where should `pullUpcomingForEdit`'s output land?** A dedicated
  staging sheet (closest to the legacy feel — plain cells you edit
  directly), or a sidebar list that writes back through
  `Engine.Ingest`/`batchWrite` on save? Depends partly on the answer
  above.
- **Legacy `Lineup` checkbox columns `J`/`K`/`L`** (referenced as
  "confirmed," quarter-flag, month-flag, and a hide/delete flag in
  `linFilter`/`Thru Next Month`/`Thru Next Q`) — did any of these become
  `SyncStatus` values or `Status`-sheet behaviors in the current system,
  or were they dropped? Matters for whether `Engine.Reports` needs a
  "confirmed only" filter option. (The `Remove from Filter` flag on `f`
  itself is resolved — see §1.1 — but these three on `Lineup` are still
  open.)
- **Search UI preference** — sidebar (`HtmlService`) vs. a plain
  `Reports`/`Search Results` sheet with labeled input cells, as
  discussed in §2.1/§1.8. Both are proven workable now (the PDF confirms
  the sheet version is exactly what you ran before); picking one avoids
  building both halfway.
- **Doc export** — Option A (native linked ranges, low effort) vs.
  Option B (fully scripted `DocumentApp` generation, higher effort but
  one-click and ties run-of-show links to `Map_Registry` data) from
  §2.5. Also: do you still want the per-show hyperlinks to individual
  run-of-show Docs, and if so, should `RunOfShowDocURL` become a real
  `Parent Lineup` field?
- **Staffing sheet timing** — is this urgent enough to build alongside
  the current Engine/ctx migration work, or should it wait until the
  ingest/date-parsing/role-resolution items already in `ROADMAP.md` are
  settled? It's architecturally independent, so it can slot in anywhere.
