# **gem-arch-notes.md**

## **1\. Project Intentions & Architecture Overview**

* Primary Objective: Build a robust, scalable event and theatrical production scheduling system in Google Apps Script (GAS) to scan spreadsheets and Google Calendars for changes, flag discrepancies, and synchronize shift schedules across crew and venue calendars.  
* Domain Context: Designed around theatrical/live production workflows where schedule shifts, venue assignments, call times, and crew rosters change frequently.  
* Data-Driven Architecture: Core execution logic is driven dynamically by administrative sheet configurations rather than hardcoded script variables.

## **2\. Core Logic & Control Structure**

The synchronization engine relies on five primary operational tabs to dictate behavior, mapping, and execution states:

* ControlPanel: Serves as the master toggle switchboard for runtime execution modes, batch processing limits, auto-sync triggers, and debug logging.  
* Sheet\_Settings: Houses static configuration keys, destination Google Calendar IDs, Spreadsheet IDs, timezone settings, and API threshold constraints.  
* Map\_Registry: Maps sheet columns directly to calendar event fields and structural target data schemas, shielding execution logic from sheet layout reorders.  
* Lookup: Maintains domain translation tables for venue aliases, job roles, position categories, and rate codes.  
* Status: Tracks the lifecycle state of each entry (e.g., Draft, Pending, Synced, Conflict, Error) to prevent redundant API sync calls and handle operational retries.

## **3\. Discrepancy Detection & Data Flow Logic**

\[Spreadsheet Event/Lineup Data\] \---\> (Map\_Registry Schema Mapping)  
                                          |  
                                          v  
\[Audit & Snapshot Engine\] \<---\> (Compare against CrewLog/Venue Snapshots)  
                                          |  
                                    \[Delta Detected\]  
                                          |  
                                          v  
\[Calendar Sync Engine\]    \<---\> (Google Calendar API & ID Log Audit)

* Delta Scanning: Compares real-time sheet rows against historic snapshots (CrewLog\_Snapshot, Audit\_Log) to calculate modified fields (start/end times, venue changes, crew drops) before invoking API writes.  
* Event ID Tracking: Idempotency is maintained by recording Google Calendar Event IDs directly in idLog and Sync\_Audit\_Log.

## **4\. Maintenance & Governance Recommendations**

When to Update Map\_Registry & Lookup

* Update Map\_Registry whenever columns are added, renamed, or moved in source tabs (Lineup, Calls, Parent\_Lineup) to avoid script breaks.  
* Update Lookup whenever new production venues, job positions, or status workflows are introduced to prevent field mapping failures during parsing.

When to Refactor Code into scriptLib (Universal Library)

* Move functions to scriptLib if they are independent of sheet layout, such as Google Calendar CRUD wrappers, timezone/date formatting routines, or batch sheet reading methods.  
* Keep sheet-specific triggers (onEdit, custom UI menu builds) and local state validation in the sheet-level script to maintain modularity and avoid code sprawl.

To ensure no existing functions are duplicated or broken, please share your current .gs codebase files (specifically your sync engine or calendar wrapper functions). What specific calendar sync mode (e.g., one-way Sheet-to-Calendar vs. full two-way scanning) are you currently testing?