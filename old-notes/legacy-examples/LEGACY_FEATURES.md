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

### 1.7 `Show_Staffing_SP25` — role assignment grid
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

I'd lean toward the sidebar long-term (it also becomes the home for
`EventCard`, below), but the sheet-based version is a lower-effort first
cut if you want something working sooner. **Flagging as a decision point.**

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
6. **Doc export (`Engine.Docs`, Option A or B)** — last, since it
   consumes #1–#3 and you'll want the underlying reports stable first.

---

## 4. Open questions for you

- **`PerformanceSpaces`** (the third source stacked into `f`, alongside
  Lineup and Calls) — I don't see an obvious current equivalent. Is this
  the venue calendar pull (`Venue_Cal_Log` / role `VENUECAL`), or a fourth
  thing that hasn't carried forward into the current schema at all?
- **Legacy `Lineup` checkbox columns `J`/`K`/`L`** (referenced as
  "confirmed," quarter-flag, month-flag, and a hide/delete flag in
  `linFilter`/`Thru Next Month`/`Thru Next Q`) — did any of these become
  `SyncStatus` values or `Status`-sheet behaviors in the current system,
  or were they dropped? Matters for whether `Engine.Reports` needs a
  "confirmed only" filter option.
- **Search UI preference** — sidebar (`HtmlService`) vs. a plain
  `Reports` output sheet, as discussed in §2.1/§2.5. Either is buildable;
  picking one avoids building both halfway.
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
