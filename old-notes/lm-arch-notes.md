# 🎭 Production Engine (Scheduler v2) - Architecture & Development Notes

This document serves as the **Single Source of Truth** and **Comprehensive Technical Registry** for **Scheduler v2** (codenamed the *Production Engine*). It chronicles the system’s complete evolutionary history, the architectural intentions, developer decisions, and critical technical schemas that govern this state-driven theatrical scheduling platform [cite: 1, 15, 86].

---

## 1. Development Intentions & Core Stated Goals

In the high-stakes, fast-moving world of theatrical production, schedule misalignment leads directly to tech-week chaos, venue double-bookings, and missed crew calls [cite: 24, 25]. The **Production Engine** was designed not just as a script to automate calendar updates, but as a **deterministic, policy-based state processor** that governs the lifecycle of show schedules, tech rehearsals, and crew assignments [cite: 24, 40, 86].

### Core Goals:
1. **Prevent Data Drift:** Ensure that any change on a schedule or call sheet is reliably propagated across all logs, other sheets, and external Google Calendars [cite: 24, 86].
2. **Deterministic Governance:** Move away from hardcoded logic and arbitrary script behavior to a policy-driven model where the spreadsheet itself acts as an interactive persistent database [cite: 40, 85].
3. **Ecosystem Scalability:** Replace the unorganized "script sprawl" (typified by legacy, disorganized `0_` prefixed Google Apps Script files) with a professional, modular architecture [cite: 1, 30, 85].
4. **Robust Error Separation:** Maintain a strict boundary between stateless utility functions (general-use library scripts) and stateful execution engines (project-specific core logic) [cite: 5, 85].
5. **Interactive System Resilience:** Protect the scheduling engine from user error (such as destructive column insertion, deleted headers, or renamed sheets) via automated self-healing mechanisms [cite: 18, 29, 91].

---

## 2. The "Great Cleanup" & Refactoring Decisions

To establish a solid operational foundation, the project underwent a series of rigorous refactoring steps to purge legacy procedural code and replace it with an object-oriented, modular namespace [cite: 85, 1137].

### 2.1 The Namespace Consolidation
A primary source of failure in earlier iterations was **File Load Order** and **Namespace Collisions** within Google Apps Script [cite: 11, 414, 428]. Because Apps Script loads files globally and often out of alphabetical order, declaring separate modules like `Engine.Calendar` across files led to silent failures where objects were overwritten or unrecognized at runtime [cite: 414, 428, 432]. 

The decision was made to consolidate all logic under a unified, global **`Engine` namespace** [cite: 123]:
* **`Engine_Core.gs` (The Heart):** Responsible for bootstrapping the execution context, loading configurations, and assembling sheet column registries dynamically [cite: 20, 89].
* **`Engine_IDService.gs` (The Identity Service):** Manages the global registration of unique identifiers, preventing ID conflicts and verifying sheet references [cite: 30, 286].
* **`Engine_Sync.gs` (The Orchestrator):** Manages the multi-stage sync pipelines, executing sheet-to-sheet data flow and coordinating conflict reconciliations [cite: 21, 90, 127].
* **`Engine_Calendar.gs` (The API Bridge):** Houses low-level Google Calendar API wrappers (pulling events, creating/updating/deleting events), serving as the engine's interface to external calendar endpoints [cite: 21, 28, 90].
* **`Engine_Maintenance.gs` (The Mechanic):** Performs schema self-healing, data validations, and diagnostic system health checks [cite: 21, 91, 130].

### 2.2 The Great Deletion of Sprawl
To prevent code duplication and inconsistent state changes, several legacy procedural logging and row-update functions were deprecated and deleted [cite: 1138]:
* `masterLog()` *(replaced by `Engine.Log.write()`)* [cite: 20, 80, 1138]
* `applyStatus()` & `getStatusTheme()` *(replaced by `Engine.Status.apply()`)* [cite: 21, 80, 1138]
* `logDiscrepancy()` & `logDetailedChange()` *(replaced by `Engine.Log.write()`)* [cite: 1138]
* `postToExecutionLog()` & `postDetailedAudit()` *(replaced by unified logging interfaces)* [cite: 1138]

### 2.3 `scriptLib` vs. Internal Helpers
To enforce clean separation of concerns, the system maintains a strict guideline for code placement [cite: 203, 1132, 1133]:
* **`scriptLib` (The Universal Toolbelt):** Houses purely functional, context-agnostic scripts copy-pastable into any spreadsheet project [cite: 19, 203, 1114]. This includes `SL.DB` (database class operations) [cite: 465], normalized string parsing, Date mergers, and general-use UI toasts [cite: 204, 1114].
* **`Helpers.gs` (Project Specifics):** Houses contextual functions that rely directly on the `ctx` object or specific theatrical logic, such as `createFingerprint()` and `getValidEventTimes()` [cite: 21, 1204, 1222].

---

## 3. Context Object (`ctx`) & Metadata-Driven Architecture

The core innovation of Scheduler v2 is the transition from hardcoded column indexes to a **metadata-driven database** [cite: 134, 1118]. The entire system runs on a highly structured, in-memory JSON **`ctx` (Context) object** assembled once per execution [cite: 20, 47, 89].

### 3.1 The Context Object Structure
```json
{
  "ss": "SpreadsheetApp.ActiveSpreadsheet",
  "config": {
    "mode": "String (e.g., 'Draft 26-27')",
    "syncWindow": {
      "startDays": 14,
      "endDays": 400
    },
    "defaultDuration": 2
  },
  "sheets": {
    "Lineup": {
      "idKey": "UUID",
      "behavior": "SOURCE",
      "syncMode": "OVERWRITE_ALLOWED",
      "isProtected": false,
      "map": {
        "EventName": 0,
        "UUID": 9,
        "Date": 12,
        "SyncHash": 22
      }
    }
  },
  "status": {
    "Synced": {
      "color": "#d9ead3",
      "behavior": "SYNC_ALLOWED"
    }
  },
  "lookup": {
    "calendars": [
      { "id": "cal_id@group.calendar.google.com", "venueName": "Theatre 166", "displayName": "166-1-Black box" }
    ],
    "lists": {
      "CrewStaff": ["Nik", "Ethan", "Jason"],
      "CallType": ["Load In", "Crew Call", "Show Time"]
    }
  },
  "runtime": {
    "bypassList": [],
    "isCustom": false,
    "reportOnly": false
  }
}
```

### 3.2 The Bootstrap Map & Circular Dependency Mitigation
A major structural challenge arose: *If the script relies entirely on Sheet settings to know where its Map Registry resides, how does it locate the settings sheet itself?* [cite: 53]
To solve this "chicken-and-egg" dilemma, the engine utilizes a hardcoded **`BOOTSTRAP_MAP`** (defined via global constant `S_SYS`) to locate the administrative core sheets [cite: 53, 54]:
```javascript
const S_SYS = {
  CONTROL: "ControlPanel",
  REGISTRY: "Map_Registry",
  SETTINGS: "Sheet_Settings",
  STATUS: "Status",
  AUDIT: "Audit_Log",
  LOOKUP: "Lookup",
  ID_LOG: "idLog"
};
```
During initialization, `Engine_Core` uses these fixed anchors to safely build the registry, load settings, and only *then* dynamically map the user sheets [cite: 54, 57, 165].

### 3.3 The Role-Based Abstraction Layer
Instead of hardcoding physical sheet tab names, the logic communicates using abstract **Roles** (e.g., `IMPORTCURRENT`, `PARENTCURRENT`, `LINEUPCURRENT`, `CREWCAL`, `VENUECAL`) [cite: 13, 209, 1341]:
* The `Sheet_Settings` sheet maps these Roles to physical Sheet Tab Names [cite: 1341].
* At boot, `getContext()` hydrates these associations [cite: 20].
* If a Stage Manager renames the physical tab "Lineup" to "2026 Live Schedule", the user only updates `Sheet_Settings` [cite: 209]. The underlying execution code (which calls `ctx.getRole("LINEUPCURRENT")`) remains completely untouched [cite: 209, 210, 241].

### 3.4 Resolving the "Object vs. Array" structural schism
A crucial refactoring decision involved how the column mappings were stored in memory [cite: 185, 1324]. 
* **The Failure:** Initially, `assembleSheetMap` stored columns as rich metadata objects (e.g., `iMap.EventName = { index: 0, header: "Event Name" }`) [cite: 185, 1318]. This required developers to write `row[iMap.EventName.index]`, leading to continuous syntax bugs and `TypeError: Cannot read properties of undefined (reading 'index')` when casing or naming mismatched [cite: 2, 1318, 1320].
* **The Decision:** The developer chose to simplify/flatten the mapping. In the updated `assembleSheetMap` loop, columns are dynamically simplified into raw integer indices (e.g., `sheetConfig.map[fieldName] = colIndex`) [cite: 1325]. This restored the clean, traditional hardcoded syntax (e.g., `row[iMap.EventName]`) while maintaining dynamic structural lookup [cite: 1325, 1326].
* **The "Space" Cleaner:** To handle spaces gracefully, a `.replace(/\s+/g, '')` routine was added to `assembleSheetMap`, transforming the Map_Registry column label "Event Name" into the clean, accessible code key `EventName` [cite: 4, 1335, 1337].

---

## 4. Data Sync Architecture & Reconciliation Logic

The Production Engine operates strictly on a chronological **"Pull -> Reconcile -> Push"** pipeline designed to enforce venue and labor coordination [cite: 79, 86, 87].

### 4.1 The Sync Pipeline Flow:
1. **PULL (Mirroring Facility Reality):** `Engine_Sync.mirrorVenues()` queries the shared Google Calendars [cite: 107]. It writes the raw external dates directly to the read-only `Venue_Cal_Log` [cite: 107, 109, 1341]. This sheet serves as the absolute "physical reality" of the buildings [cite: 28, 43].
2. **RECONCILE (The Negotiator):** `Engine_Sync.reconcileLogs()` compares the `Crew_Calendar_Log` (our plan) against the `Venue_Cal_Log` (facility reality) [cite: 110]. 
   * **Fuzzy Title Match:** Checks space fingerprints. If an event matches both space and time, it performs a fuzzy title match (e.g., "Häxan Tech" matching "Häxan") to automatically establish a link [cite: 113, 804].
   * **Adoption Check:** If the match is valid and our sheet row lacks a GCal ID, it "adopts" the external event's ID and updates our status to `Adopted from Venue` [cite: 113, 805].
   * **Location Conflict:** If a time/space overlap occurs with a mismatching title, it flags a `Location Conflict` and blocks further automation [cite: 114, 806].
3. **PUSH (The Executioner):** `Engine_Sync.syncCrewCalendar()` reads our writeable schedule and pushes valid changes back to Google Calendar [cite: 316, 317].

### 4.2 The Logic Hierarchy (Decision Tree):
When determining if an automation write can occur, the Engine follows an exact, top-down logic checklist [cite: 87, 88]:
1. **Global Mode (Modes sheet):** Is `writeToCalendar` set to `FALSE`? (If so, block all calendar alterations globally, such as in `LOG_ONLY` mode) [cite: 79, 106, 1344].
2. **Row Exception (Status sheet behavior):** Is the individual row set to `BYPASS` or `LOCKED`? (If so, instantly skip processing for this record) [cite: 26, 88].
3. **Local Sheet Policy (Sheet_Settings):** Is the sheet set to `READ_ONLY`? (If so, block any write back to the sheet, protecting the log integrity) [cite: 101, 118].

### 4.3 Policy-Driven Logging: Verbose vs. Exception
To prevent log bloat, the developer designed the logger to be highly configurable via a multi-selection dropdown in the `ControlPanel` under the `Log Types` setting [cite: 129, 294, 1340]. The `smartLog` wrapper checks the active Mode's log types (such as `SYS_INIT`, `INGEST_CREATE`, `CONFLICT_VENUE`, or `ERR_SYNC`) before writing to the `Audit_Log` [cite: 298, 1119]. 

Additionally:
* **Macro Actions** (such as "Sync Started", "183 events mirrored") write to the global `Audit_Log` sheet [cite: 1111, 1356].
* **Micro Drift Details** (such as "Time changed from 7:00 PM to 7:30 PM") write directly to that specific row’s `UpdateDetails` column [cite: 1111, 1356]. This keeps the historical thread attached to the actual event, rather than cluttering a generic text file [cite: 1111].

### 4.4 Dual-Tracking Identity Strategy:
The system tracks changes using two separate mechanisms to optimize speed and transparency [cite: 291]:
* **SyncHash (MD5):** An 8-character hashed digest generated via `SL.Identity.generate()` across core event properties (Title + Date + Start + Location) [cite: 25, 824, 827]. It is used for computer O(1) comparison to detect if a row has changed [cite: 291].
* **Fingerprint:** A human-readable pipe-delimited string (e.g., `Häxan | 2026-06-05 | 19:30 | Theatre 166`) used for logging and visually debugging exactly what data drifted [cite: 291, 808].

---

## 5. Google Sheets as Interactive Persistent Memory

Google Sheets is treated as the persistent memory storage layer of the Production Engine [cite: 23, 85]. The sheet design utilizes advanced relational validation [cite: 968]:

### 5.1 idLog (The Identity Service)
The `idLog` is the master registry for tracking the lifecycle of all entities (Shows, Child dates, Tech Calls) [cite: 15, 272, 282].
* **Relational Keying:** Ensures Parent Lineup IDs (`P-xxxx`) map cleanly to Lineup Children (`P-xxxx-C01`) and Calls (`CALL-xxxx`) [cite: 136, 1354].
* **Google Calendar "Self-Healing":** If a venue manager deletes and recreates an event on the calendar, its `eventID` changes [cite: 250]. The ID Service can search the `idLog` by the show’s unique data fingerprint, match the historic signature, and "heal" the connection by updating the row to the new calendar ID [cite: 250, 272].

### 5.2 Lookup and Status Sheets
* **Status Sheet:** Drives row colors and exception mapping. If a Stage Manager applies a status like "Manual Review" in a dropdown, the row is dynamically colored orange based on the Hex column, and the code immediately locks the row from sync based on the `BYPASS` behavior mapped to that status row [cite: 21, 51, 80].
* **Maintenance Auto-Repair:** The `repairMapRegistry()` function automatically scans the physical headers of all sheets at runtime, updating their indices in the `Map_Registry` tab [cite: 91, 130]. This guarantees that even if columns are moved, the engine maps correctly and continues executing [cite: 91].

---

## 6. Documented Historical Failures & Safe Workarounds

### 6.1 The Javascript Closure Trap
* **The Failure:** Initially, `getContext().getRole` was declared as an arrow function: `ctx.getRole = (roleName) => { ... }` [cite: 10, 11]. When the context was modified or roles reassigned, the arrow function locked in the initial empty scope of `ctx` at the millisecond of creation, returning `undefined` for dynamically generated tabs [cite: 11, 12].
* **The Fix:** Redesigned as standard anonymous function expressions utilizing `this`: `ctx.getRole = function(roleName) { ... }` [cite: 13]. This forced the execution environment to look at the object's current state in global memory [cite: 13, 18].

### 6.2 The GCal "Undefined" Namespace Collision
* **The Failure:** Loading multiple files with `var Engine = Engine || {};` caused alphabetical order collisions [cite: 414, 428]. When alphabetical sorting loaded `Engine_Sync.gs` before `Engine_Calendar.gs` finished registering its calendar sub-objects, calling `Engine.Calendar.pullCalendarEvents` crashed with `TypeError: Cannot read properties of undefined` [cite: 388, 414, 428].
* **The Workaround:** Implemented a global function bridge in `Engine_Calendar.gs` (`function global_pullCalendarEvents(...)`) outside the namespace [cite: 437, 440]. Google Apps Script registers top-level global functions during compilation, ensuring availability regardless of file load order [cite: 437].

### 6.3 Alternating alternating-color row locks
* **The Failure:** Direct cell formatting inside loops throttled write speeds, hitting Google’s execution timeouts [cite: 25, 1005].
* **The Fix:** Implemented standard dynamic range formatting `sheet.getRange(rowIdx, 1, 1, lastCol).setBackground(color)` wrapped inside batch executors [cite: 955, 956]. Alt formatting schemes are handled dynamically inside `Engine.Maintenance.applyDropdowns()` [cite: 403].

---

## 7. The Modular File Structure Checklist

To maintain system integrity, any new features, sheets, or calendars must strictly match this structural blueprint [cite: 85]:

```
/workspace/
├── Engine_Core.gs             ← Boots context, loads config settings, and compiles maps [cite: 20, 89]
├── Engine_IDService.gs        ← Audits, registers, and tracks system-wide UUID keys [cite: 30, 286]
├── Engine_Sync.gs             ← Orchestrates Pull -> Reconcile -> Push execution [cite: 21, 90, 127]
├── Engine_Calendar.gs         ← Houses low-level Google Calendar API adapters [cite: 21, 28, 90]
├── Engine_Maintenance.gs      ← Automatic header resetting, registry repair, and validation [cite: 21, 91, 130]
├── Helpers.gs                 ← Houses fingerprints and other sheet-specific helper math [cite: 21, 1204, 1222]
└── Config.gs                  ← Hydrates global variables and parses modes [cite: 21, 205, 1205]
```

### Map Registry Dynamic Schema Check
Any database field required by a script must be registered in `Map_Registry` [cite: 169]. To preserve the operational syntax, ensure column headers are correctly placed on **Row 1** with 0-based column indices [cite: 188, 1304].

*Notes compiled and finalized for Scheduler v2.* [cite: 1]
