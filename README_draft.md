### Scheduler Theatrical Sync Engine: Comprehensive Technical Documentation

#### 1\. Project Overview & Mission Statement

The Scheduler Sync Engine is a deterministic, policy-based synchronization system architected to manage the unique complexities of theatrical production scheduling. It represents a paradigm shift from traditional procedural scripting toward a centralized, state-driven metadata engine. By treating the spreadsheet not merely as a data store but as a logic-rich control environment, the engine governs the flow of data between Google Sheets and external Google Calendars with mathematical precision.**Mission Statement**  The engine’s primary mission is to establish an immutable "Source of Truth" for theatrical scheduling, effectively eliminating "Data Drift"—the hazardous mismatch between schedule versions—and preventing physical venue double-bookings. By implementing a rigorous reconciliation pipeline, the system ensures that every production call is validated, synchronized, and governed by established organizational policies.

#### 2\. Core Architecture: The "ctx" (Context) Brain

The "ctx" object is the engine's centralized brain, initialized once per execution via the buildContext() flow. This architecture ensures high performance by minimizing redundant Google Sheets API calls and providing a single reference for all metadata.

##### The Bootstrap Phase

To solve the "circular dependency" problem—where the engine requires the spreadsheet to define the mappings it needs to read the spreadsheet—the system utilizes a hardcoded  **Bootstrap Phase** . This phase anchors the system using specific S\_SYS constants:

* S\_SYS.CONTROL: Points to the ControlPanel for global operational variables.  
* S\_SYS.REGISTRY: Points to the Map\_Registry for dynamic column mapping.  
* S\_SYS.SETTINGS: Points to Sheet\_Settings for sheet-level governance.  
* S\_SYS.IDLOG: Points to the master UUID registration table.

##### The ctx Structure (ContextSchema)

The ctx object follows a strictly nested hierarchy to enable O(1) lookups during execution:

* **config** : Operational settings derived from the ControlPanel.  
* mode: The current operational state (e.g., "Draft 26-27").  
* syncWindow: A critical optimization object containing startDays and endDays to prevent scanning years of historical data.  
* defaultDuration: Fallback duration for parsed events.  
* **sheets** : A dictionary of sheet-level governance, keyed by physical sheet names.  
* idKey: The unique identifier field (e.g., UUID).  
* role: The logical purpose (e.g., "LINEUP\_PROD") accessed via the getRole() abstraction.  
* behavior: The high-level policy (SOURCE, MIRROR, PULL, or REFERENCE).  
* syncMode: Logic permissions (OVERWRITE\_ALLOWED, READ\_ONLY, or SYNC).  
* isProtected: Boolean flag for high-stakes validation logic.  
* map: A nested field-to-column index and header map.  
* **rules** : The decision-making logic brain.  
* Status: Maps names to hex colors and specific engine behaviors.  
* Lookup: Vertical lists for Venues, Staff, and Call Types.  
* **runtime** : Temporary state for the current execution.  
* bypassList: A "No-Fly List" of UUIDs identified for skipping during batch operations.

#### 3\. The Data Pipeline: From Import to Calendar

The transformation pipeline converts messy human-inputted strings into valid, synchronized calendar objects through four distinct stages:

* **Import** : Ingestion of raw source data from external ranges or manual entries.  
* **Parent Lineup** : Establishing the primary "Source of Truth" by assigning P- prefix UUIDs.  
* **Lineup** : The engine executes the  **Theatrical Parser**  (SL.TheatricalParser) to parse complex strings such as "Monday, June 16 at 8:30am–11:30am." The parser is hardened for theatrical nuance, handling edge cases like:  
* **"TBD" Entries** : Assigning a default duration while flagging the row for MANUAL\_REVIEW.  
* **"Performance:" Prefixes** : Automatically stripping theatrical prefixes to isolate date/time data.  
* **Crew/Venue Logs** : The final staging area where individual child events (C- IDs) and personnel calls (CALL- IDs) are prepared for synchronization.

#### 4\. Sync Logic: The "Pull, Reconcile, Push" Sequence

The engine adheres to an immutable three-stage sync philosophy to maintain data integrity and prevent venue conflicts.

##### The Sequence

* **PULL** : The engine fetches the current state of external venue and crew calendars. This state is mirrored into the logs to provide a "Current Reality" snapshot.  
* **RECONCILE** : The "Missing Link" where the engine compares the Sheet "Source of Truth" against the external state. It uses the  **Sync Window**  (defined in ctx.config) to limit the scope of reconciliation, optimizing execution time.  
* **PUSH** : Final calendar updates are executed only if the specific Mode, Sheet Policy, and Row Exception permit writing to the external API.

##### Sync Decision Matrix

Scenario,Engine Action,Status Result  
Match Found,Perform Field-Level Reconcile; link UUIDs.,Synced or Adopted  
Mismatch/Overlap,Block Push; flag for user intervention.,Location Conflict  
No Match,Create new event (if policy allows).,Pushed to Calendar

#### 5\. Governance: Policies vs. Exceptions

The system utilizes a  **Hierarchy of Logic**  to ensure that automated operations never override human intent where it matters most.

##### The Logic Keys

The engine evaluates the SyncStatus of every row against five specific logic keys:

1. SYNC\_ALLOWED: Normal automated processing.  
2. BYPASS: The engine skips the row entirely.  
3. MANUAL\_REVIEW: The engine stops and flags the row for user intervention.  
4. PREFER\_SOURCE: If data drift is detected, the spreadsheet overwrites the calendar.  
5. PREFER\_EXTERNAL: If data drift is detected, the calendar overwrites the spreadsheet.**The Hierarchy** : A specific  **Row Exception**  (e.g., BYPASS) always overrides a general  **Sheet Policy**  (e.g., SOURCE). During buildContext(), the engine pre-scans for these exceptions and populates runtime.bypassList, enabling O(1) performance during batch loops.

#### 6\. Maintenance & Self-Healing Tools

The Engine\_Maintenance module ensures the system remains resilient against user-driven structural changes and accidental data corruption.

* **repairMapRegistry()** : This self-healing function scans physical headers and updates indices. If a user moves a column, the engine realigns its "GPS" to point to the new column location.  
* **repairHeaders()** : Compares headers against the registry to restore missing titles. Crucially, it re-applies  **Data Validation (dropdowns)**  to ensure users cannot enter "Theatre166" instead of "Theatre 166."  
* **Ghost Sheet Protection** : The engine includes logic to prevent role strings (e.g., "VENUECAL") from being injected as primary keys in ctx.sheets, ensuring only valid physical sheet names are used for data operations.

#### 7\. System Infrastructure: scriptLib & Development Workflow

The scriptLib acts as a stateless "Universal Toolbox," housing high-performance utilities and cryptographic functions.

##### The "Object Trap" & The Data/Logic Split

A core architectural friction exists in Google Workspace: Google Sheets requires  **Arrays**  for performance (setValues()), but business logic is significantly safer and more readable when using  **Objects** . To solve this  **Object Trap** , the engine uses "Bridge" functions:

* rowToObject(): Converts sheet arrays into readable objects for logic processing.  
* objectToRow(): Flattens logic objects back into arrays for batch writing, ensuring data lands in the correct column regardless of index shifts.

##### Integrity & Change Detection

The engine utilizes two distinct layers of change detection:

* **Fingerprints** : Human-meaningful strings (e.g., Title|Date|Time|Location) used to detect if an event has  **moved**  in space or time.  
* **MD5 Hashes** : Cryptographic digests of the  **entire row**  used to detect  **silent edits**  (e.g., changes to "Show Notes") that do not affect the fingerprint.

#### 8\. Feature Registry & Advanced Utilities

* **ID Management** : Centralized management of P-, C-, and CALL- UUIDs via the idLog.  
* **Adoption Logic** : "Child" events can adopt existing Venue Calendar IDs. The engine performs a  **Field-Level Reconcile** , ensuring that "User-Owned" fields (like manually entered Show Notes) are never overwritten by automated venue updates.  
* **getRole() Abstraction** : This pattern separates  *what a sheet does*  from  *what it is named* . Users can rename the "Lineup" tab to "Main Schedule 2026," and the engine will continue to function by looking up the sheet assigned to the LINEUP role.  
* **Status Management** : Automated row color-coding and timestamping based on Status sheet configurations.

#### 9\. Roadmap & Future Governance

* **UI-Driven Environment** : Transitioning all setup/maintenance to custom dialogs to prevent direct interaction with "System" sheets.  
* **Stealth Mode** : Automatically hiding Map\_Registry and Sheet\_Settings during standard operations.  
* **Reporting Mode** : Implementing goSync("report") to generate discrepancy logs without altering data, allowing for "Dry Run" validations.  
* **Role-Based Access** : Restricting configuration access based on user credentials defined in the ControlPanel.

