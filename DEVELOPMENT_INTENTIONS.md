# Scheduler Documentation Index

This file is the entrypoint for scheduler project documentation. The older monolithic intentions document has been split by purpose so architecture, operating instructions, and planning can evolve independently.

## Read First

- [ARCHITECTURE.md](ARCHITECTURE.md): runtime boundaries, metadata contracts, identity relationships, statuses, behaviors, decisions, and data direction.
- [OPERATIONS.md](OPERATIONS.md): menu organization, verification workflow, header operations, decision handling, calendar controls, and recovery instructions.
- [ROADMAP.md](ROADMAP.md): priorities, canonical vocabularies, planned review types, decisions made, and deferred recovery work.
- [UI-Design.md](UI-Design.md): UX/UI interaction ideas, modal inspection popups, custom sync scoping, and frontend design.
## Related Documentation

- [scriptLib/DEVELOPMENT_INTENTIONS.md](../scriptLib/DEVELOPMENT_INTENTIONS.md): shared-library contract, promotion policy, and library-specific open work.
- [scriptLib/README_scriptLib_changes.md](../scriptLib/README_scriptLib_changes.md): scriptLib migration notes and compatibility guidance.
- [gcalendarsync/README.md](../gcalendarsync/README.md): external reference project used for calendar event comparison and property-level patching patterns.

## Documentation Rules

- Architecture decisions belong in `ARCHITECTURE.md`.
- User-facing procedures belong in `OPERATIONS.md`.

- Notes related to future User-Interface goals belong in 'UI-Design.md'.
- Priorities, open decisions, and deferred work belong in `ROADMAP.md`.
- Code comments should explain local implementation details, not become a second roadmap.
- Update the relevant focused document when a behavior or schema changes.

## Current Anchor

The immediate implementation focus is refining the decision queue lifecycle, establishing identity lineage, and decoupling sheet lookup:
- Abstracting all sheet access behind `SheetRole` in `Sheet_Settings`.
- Generating universal cell hyperlinks across all `decision_log` review types.
- Persisting pending manual reviews while automatically purging superseded items to `Audit_Log`.
- Implementing `idLog` "Merged IDs" alias mapping with cascading `parentID` updates across child `Lineup` records.
- Enforcing manual user action flags (`Bypassed`, `Delete Pending`, `Possible Duplicate`) during `ingest` and `verify` runs.

A parallel, recently-started workstream is a `Map_Registry` / `Field_Names.csv` integrity pass: filling in blank `Data Type`/`Sync Behavior` cells, resolving duplicate/colliding `Field Name` rows (which silently break `assembleSheetMap()`'s column resolution), and reconciling `Field_Names.csv` back into sync with the live registry. See `ROADMAP.md`'s 2026-08-28 entries in Immediate Priorities and Decisions Made for the specifics found so far.
