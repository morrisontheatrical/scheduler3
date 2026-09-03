# seth's notes

## Future Prompts
- Review and update ## Immediate Priorities in ROADMAP.md
- Consider additional modes to add to Mode_Config (IN PROGRESS RE: agent-notes/COPILOT_AGENT_INSTRUCTIONS_RoleSweep.md)
- Review ARCHITECTURE.md against 'Sheet_Settings.csv', 'ref.csv', 'Status.csv', 'Mode_Config.csv'
- Add isHidden option to Map_Registry
    - hideColumn(sheet, indentifier)
    - showColumn(sheet, identifier)
- agent-notes/legacy-plan.md
- merge DEVELOPMENT_INTENTIONS.md with agent instructions
- agent-notes/review normalize0829.md and compare with scriptLib normalize utility
- agent-notes/COPILOT_AGENT_INSTRUCTIONS_RoleSweep.md
- Compare these plan documents with ROADMAP.md. 
    - What is actually complete?
    - What is in progress?
    - Which issues are intertwined or overlapping?
    - List any open questions or decisions I need to make. 

## TO DO
- create diagram to represnt data flow
- Consistent implementation of "Row Actions" across sheets
- Spreadsheet based metadata > JSON for code? Use Serialize Data and getColumn helpers
- Do I need to pass ctx through function parameters or can I just call it within the functions?
    - **Decision**: Pass `ctx` as a parameter to maintain testability and transparency (avoiding hidden global state).

- review code in recordings project. it also has legacy functions and some new ones, but potentially the first 'parsedatesandtimes's

- **Phase 3 — Behavior tokens (ties to #11)**
    7. Interpreter for all 7 ref tokens. Current state: LOCKED/BYPASS implemented (blocksWrite, the skip checks at engine_sync.js:168, engine_ingest.js:923); SYNC_ALLOWED only honored via Mode allowlist, never read from the status row; RECONCILE_ONLY, PREFER_SOURCE, PREFER_DESTINATION, MANUAL_REVIEW are dead tokens — nothing in the engine reads them.
    8. Rule: Status sheet = settings (which tokens per status, editable without code); ref = vocabulary; Mode AllowedBehaviors = which behaviors the mode honors. Engine reads the token from the row and acts per the interpreter — no status-name hardcoding.
    9. Healing (issue #7): engine may reset only engine-set diagnostic statuses (Data Drift Detected → Synced) + markSuperseded on the matching IMPORT_PARENT decision. Never auto-clear user-intent statuses. Explicit allowlist in code.

- Find the helpers (message?) from legacy code and replicate. It helped keep things accessible by ensuring anything that is logged in audit_log is also logged in the console, and vice versa. Also, make sure runHealthCheck logs the health check results. 
    ```js
        message(type, text) {
            Engine.Log(params); //abbreviated
            console.Log(text);
        }
    ```