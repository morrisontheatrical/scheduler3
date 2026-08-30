# seth's notes

## Future Prompts
- Review and update ## Immediate Priorities in ROADMAP.md
- Consider additional modes to add to Mode_Config
- Review ARCHITECTURE.md against 'Sheet_Settings.csv', 'ref.csv', 'Status.csv', 'Mode_Config.csv'
- Add isHidden option to Map_Registry
    - hideColumn(sheet, indentifier)
    - showColumn(sheet, identifier)
- legacy-plan.md
- merge DEVELOPMENT_INTENTIONS.md with agent instructions
- review normalize0829.md and compare with scriptLib normalize utility


## TO DO
- create diagram to represnt data flow
- Consistent implementation of "Row Actions" across sheets
- Spreadsheet based metadata > JSON for code? Use Serialize Data and getColumn helpers
- Do I need to pass ctx through function parameters or can I just call it within the functions?
    - **Decision**: Pass `ctx` as a parameter to maintain testability and transparency (avoiding hidden global state).