# Scheduler Documentation Index

This file is the entrypoint for scheduler project documentation. The older monolithic intentions document has been split by purpose so architecture, operating instructions, and planning can evolve independently.

## Read First

- [ARCHITECTURE.md](ARCHITECTURE.md): runtime boundaries, metadata contracts, identity relationships, statuses, behaviors, decisions, and data direction.
- [OPERATIONS.md](OPERATIONS.md): menu organization, verification workflow, header operations, decision handling, calendar controls, and recovery instructions.
- [ROADMAP.md](ROADMAP.md): priorities, canonical vocabularies, planned review types, decisions made, and deferred recovery work.

## Related Documentation

- [scriptLib/DEVELOPMENT_INTENTIONS.md](../scriptLib/DEVELOPMENT_INTENTIONS.md): shared-library contract, promotion policy, and library-specific open work.
- [scriptLib/README_scriptLib_changes.md](../scriptLib/README_scriptLib_changes.md): scriptLib migration notes and compatibility guidance.
- [gcalendarsync/README.md](../gcalendarsync/README.md): external reference project used for calendar event comparison and property-level patching patterns.

## Documentation Rules

- Architecture decisions belong in `ARCHITECTURE.md`.
- User-facing procedures belong in `OPERATIONS.md`.
- Priorities, open decisions, and deferred work belong in `ROADMAP.md`.
- Code comments should explain local implementation details, not become a second roadmap.
- Update the relevant focused document when a behavior or schema changes.

## Current Anchor

The immediate implementation focus is the decision/reconciliation pipeline: normalize status and behavior vocabulary, preserve Parent IDs across legitimate import changes, make duplicate and drift decisions understandable, and apply reviewed actions safely across downstream relationships.
