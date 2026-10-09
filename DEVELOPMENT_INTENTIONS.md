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

The current gate is operational validation, not further implementation of features already reported complete:
- Run the Draft/Current routing and reconciliation checklist in `OPERATIONS.md` using a disposable workbook copy and with calendar writes disabled. Record results before closing issues #1, #4, #7, #8, #10, #13, #24, #25, or #28.
- `decision_log` review links, queue lifecycle, stable review IDs/evidence, idLog snapshots/merged aliases, and role-based routing are implemented in the code. Distinguish those code-complete items from their remaining live workbook verification.
- `Engine.loadLookups()` now reads `LOOKUP` and `REFRULES` using roles. The **Lookup List Diagnostics** action reports each loaded list's source and count; dropdown refresh skips empty lists. Verify the live registry and rules before closing #9; broader Status/behavior/mode vocabulary normalization remains open.
- Hyperlink scope is split: Import→Parent, Parent-only, and Parent-duplicate decision links (#6) and idLog links (#23) are implemented; newer Lineup/Crew review links, Audit_Log-to-decision links (#26), and the wider Calls/calendar-log associations (#27) remain to be defined and completed.
- Once the validation gates pass, prioritize registry/reference integrity and the remaining Parent → Lineup → Crew Calendar gaps before sync-mode/reporting features. Keep UI and lower-risk maintenance work deferred unless operational needs change.
