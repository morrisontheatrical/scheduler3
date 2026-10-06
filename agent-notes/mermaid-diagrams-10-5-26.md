```mermaid
flowchart LR
    subgraph Intake["1. Raw Intake (season-routed)"]
        I["import / draft_import"]
    end

    subgraph Catalog["2. Master Catalog (season-routed)"]
        P["Parent Lineup / draft_Parent<br/>parentID"]
    end

    subgraph Execution["3. Performance, Logs & Calendars"]
        direction TB
        L["Lineup / draft_Lineup<br/>UUID + parentID"]
        C["Crew_Calendar_Log"]
        D["Draft_Season_Log"]
        V["Venue_Cal_Log"]
        Calls["Calls<br/>(not integrated in Engine sync pipeline)"]
    end

    subgraph Governance["4. Review, Identity & Audit"]
        Verify["Read-only verification"]
        DecLog["decision_log<br/>active review queue"]
        Apply["applyPending()<br/>dispatches approved actions"]
        Merge["mergeParentDuplicate()"]
        IDLog["idLog<br/>identity registry, aliases, snapshots"]
        AuditLog["Audit_Log"]
    end

    I -->|"goParent(): direct add/update"| P
    I -->|"verifyImportToParent(): detect drift only"| Verify
    P -->|"verifyParentToLineup(): detect drift only"| Verify
    Verify -->|"flags rows and queues review"| DecLog
    DecLog -->|"reviewer records a decision"| Apply

    Apply -->|"ACCEPT_IMPORT: apply selected import changes"| P
    Apply -->|"MERGE_PARENT"| Merge
    Merge -->|"survivor / duplicate state"| P
    Merge -->|"repoint downstream parentID references"| L
    Merge -->|"repoint downstream parentID references"| Calls
    Merge -->|"update merged-ID alias"| IDLog
    Merge -->|"repoint active decisions"| DecLog

    P -->|"goLineup(): parse dates into performance instances"| L
    Apply -->|"EXPLODE_LINEUP invokes goLineup()"| L
    Apply -.->|"SYNC_PARENT_TO_LINEUP marks Synced only;<br/>does not copy Parent fields"| L

    L -->|"goCrewLog() / syncLineupToLog()<br/>TargetSeason routes destination"| C
    L -->|"goCrewLog() / syncLineupToLog()<br/>TargetSeason routes destination"| D

    ExternalVenue["Venue Google Calendars"] -->|"mirrorVenues(): pull"| V
    C -->|"reconcileLogs(): compare date/location/title;<br/>flag adoption or conflict"| Reconcile["Reconciliation"]
    V --> Reconcile
    C -->|"syncCrewCalendar(): policy-gated push/update/delete"| CrewCalendar["Crew Google Calendar"]

    C -.->|"IDService.syncAll(): register / refresh identities"| IDLog
    D -.->|"IDService.syncAll(): register / refresh identities"| IDLog
    V -.->|"IDService.syncAll(): register / refresh identities"| IDLog
    Merge -->|"merge and decision audit entries"| AuditLog
    Apply -->|"applied decision logged, then queue row removed;<br/>failed decision remains FAILED"| AuditLog

    Calls -.->|"deprecated shim redirects to runMasterSync();<br/>Calls-to-log sync is not active"| EngineSync["Engine master sync"]
```

```mermaid
erDiagram
    PARENT_LINEUP ||--o{ LINEUP : "parentID associates event"
    LINEUP ||--o{ CREW_CAL_LOG : "UUID associates Lineup-sourced rows"
    LINEUP ||--o{ DRAFT_SEASON_LOG : "UUID associates Lineup-sourced rows"
    LINEUP ||--o{ CALLS : "UUID may associate a call with a performance"
    PARENT_LINEUP ||--o{ CALLS : "parentID associates call with a show"
    LINEUP o|--o{ VENUE_CAL_LOG : "optional UUID association"

    PARENT_LINEUP {
        string parentID "event identity"
        string EventName
        string DatesAndTimes
        string Venue
    }
    LINEUP {
        string UUID "performance identity"
        string parentID "associated Parent event"
        datetime Date
        datetime Time
    }
    CREW_CAL_LOG {
        string UUID "Lineup association when Source is Lineup"
        string parentID "associated Parent event when present"
        string EventID "Google Calendar event ID; may be absent"
        string Source
    }
    DRAFT_SEASON_LOG {
        string UUID "Lineup association when Source is Lineup"
        string parentID "associated Parent event when present"
        string EventID "calendar event ID; may be absent"
        string Source
    }
    VENUE_CAL_LOG {
        string EventID "venue calendar event ID"
        string Associated_UUID "optional Lineup association"
    }
    CALLS {
        string callID "call-row identity"
        string UUID "associated performance; legacy field"
        string parentID "associated Parent event"
        string eventID "calendar event ID when populated"
    }
    ID_LOG {
        string UniqueID "mixed-form registry key"
        string RecordType
        string ParentID
        string SheetLocation
        string Fingerprint "serialized row snapshot"
        string MergedIDs "merged-ID aliases"
    }
```

The ER links above describe spreadsheet ID associations, not database-enforced
foreign keys. `idLog` is a registry/alias and snapshot store rather than a
parent table in the event relationship chain. Calls-to-calendar-log sync is
deprecated and is not integrated into the current `Engine.*` sync pipeline.

```mermaid
sequenceDiagram
    autonumber
    actor Reviewer
    participant Intake as Import / Draft Import
    participant Parent as Parent Lineup / draft_Parent
    participant Lineup as Lineup / draft_Lineup
    participant DecLog as decision_log
    participant Apply as applyPending()
    participant IDLog as idLog
    participant Audit as Audit_Log
    participant Calls
    participant CrewLog as Crew_Calendar_Log
    participant DraftLog as Draft_Season_Log
    participant VenueLog as Venue_Cal_Log
    participant Calendar as Google Calendars
    participant EngineSync as Engine.Sync

    Intake->>Parent: goParent() directly adds/updates rows
    Intake->>DecLog: verifyImportToParent() detects drift; queues review
    Parent->>DecLog: verifyParentToLineup() detects drift; queues review
    Note over Intake,DecLog: Both verification functions flag/log differences; neither applies data changes.

    Parent->>Lineup: goLineup() parses dates and reconciles performance instances
    Reviewer->>DecLog: Record decision and requested action
    opt Apply reviewed decisions is invoked
        Apply->>DecLog: Read pending / failed decisions
        alt ACCEPT_IMPORT
            Apply->>Parent: acceptImportDrift(force: true)
        else MERGE_PARENT
            Apply->>Parent: mergeParentDuplicate(keepID, duplicateID)
            Apply->>Lineup: Repoint matching downstream parentID references
            Apply->>Calls: Repoint matching downstream parentID references
            Apply->>CrewLog: Repoint matching downstream parentID references
            Apply->>DraftLog: Repoint matching downstream parentID references
            Apply->>IDLog: Mark duplicate merged; update survivor MergedIDs alias
            Apply->>DecLog: Repoint references in active decisions
        else EXPLODE_LINEUP
            Apply->>Lineup: Invoke goLineup()
        else SYNC_PARENT_TO_LINEUP
            Apply->>Lineup: Mark matching row Synced; no field copy
        end
        Apply->>Audit: Write DECISION_APPLIED; remove queue row
        Note over Apply,DecLog: On failure, write DECISION_FAILED and retain the row as FAILED.
    end

    Lineup->>CrewLog: syncLineupToLog() when TargetSeason is Current
    Lineup->>DraftLog: syncLineupToLog() when TargetSeason is Draft
    CrewLog->>IDLog: IDService.syncAll() refreshes registered identities
    DraftLog->>IDLog: IDService.syncAll() refreshes registered identities
    Note over CrewLog,DraftLog: New log rows are Manual Review; locked/bypassed rows are not overwritten.

    opt Engine.Sync.runMasterSync() phases not skipped
        Calendar->>VenueLog: mirrorVenues() pulls venue calendar events
        CrewLog->>VenueLog: reconcileLogs() compares date/location/title
        Note over CrewLog,VenueLog: Reconciliation flags possible adoption or location conflict; it does not sync Lineup into a log.
        CrewLog->>Calendar: syncCrewCalendar() pushes, updates, or deletes when mode permits
        EngineSync->>IDLog: IDService.syncAll() scans registered identity-bearing sheets
    end
```
