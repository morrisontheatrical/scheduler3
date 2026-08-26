# UI Design and Interaction Ideas

This document tracks all user interface, user experience, and interaction-related ideas and requirements for the Scheduler project.

## Future Interaction Features

- **Detailed Inspection Popup:** Clicking on a specific ID or link should trigger a popup or sidebar report containing all associated details for that entity (e.g., all fields from the `Map_Registry` for a specific `parentID`).
- **Custom Sync Scoping:** UI controls to allow users to define a "Custom Sync" context (e.g., selecting specific date ranges, specific venues, or specific roles) to override the default `ControlPanel` settings.
- **Detailed Reporting Mode:** A UI-driven mode that performs a "log-only" verification pass, checking all requested parameters and presenting a summary without mutating any spreadsheet data.
- **Conflict Resolution UI:** A way to handle "Location Conflict" or "Time Conflict" prompts (e.g., when a Load In Call overlaps with a Performance) via a UI choice or manual review flag.
- see HTML and CSS files in events-management-app-backend for some inspiration or as a starting place

## Automation & Integration Ideas

- **Stream/Livestream Integration:**
    - Add a way to associate a "call" with a livestream so that the link can be appended to the map.
    - Explore how `scriptLib` can assist in inventory processes and managing livestreams.
- **Notification Automation:** Automated reminders or notifications based on recent activity (e.g., "last night's stream notes").

## Design Principles

- **Hyperlink-Driven Navigation:** Use `refreshLinks()` to ensure all reviewable items in `decision_log` are easily navigable via direct links to their source/candidate rows.
- **Contextual Clarity:** Ensure all UI-driven decisions or actions are accompanied by enough context (e.g., "before/after" evidence) to allow for confident user interaction.
