# ContextSchema.md

# **ContextSchema.md**

## **Purpose**

The `ctx` (Context) object is the primary data structure passed between all engines (`core`, `ingest`, `sync`, `calendar`, `maintenance`). It is initialized once per execution by `engine_core.buildContext()`. It translates spreadsheet-based settings into a machine-readable format to ensure consistent decision-making.

---

## **1\. The `ctx` Structure (JSON)**

JavaScript

```
//early revision, likely incomplete and containing syntax errors. 
{
  "config": {
    "mode": "String (e.g., 'Draft 26-27')", //dropdown or UI dropdown
    "syncWindow": {
      "startDays": "Number", //add ability to do this by specific date while keeping this functionality. something to translate for scriptLib
      "endDays": "Number"
    },
    "autoUpdate": "Boolean", //this seems outdated? Now we have sheet.behavior and row.exception
    "defaultDuration": "Number (Hours)"
  },
  "sheets": {
    "SheetName": {
      "idKey": "String (e.g., 'UUID')",
      "sheet.behavior": "String (SOURCE | MIRROR | PULL | REFERENCE)",
	  "map": {
    	"Field Name": { 
        		"Column Index": "Number (0-based)", //sheet.map.field.index?? 
        		"Header Display Name": "String" 
      						}
    			}
  				},
		"sheet.status": "String",
      "syncMode": "String (OVERWRITE_ALLOWED | READ_ONLY | SYNC)",
      "isProtected": "Boolean",
	  "Sheet Description": "String",
	 "Development Notes": "String"
    }
  },
  "Status": {
    "Name": "String"
	"Behaviors": {
     //lookup.behaviors? dynamic reference for 
    },
    "statusColors": {
      "Status Name": "HexCode"
    },
	
 "lookups": {
      "venues": ["Array of Strings"],
      "callTypes": ["Array of Strings"],
      "staff": ["Array of Strings"], //CrewStaff
	"CallType":["Array of Strings"],
	"Series":["Array of Strings"],
	"Options":["Array of Strings"],
	"Behaviors":["Array of Strings"],
	"Log Types":["Array of Strings"]
},
"Calendar": {
displayName: "string"
Calendar.ID: "string"
Venue.Name: 	"string"
    }
  },
  "runtime": {
    "isCustom": "Boolean", //do we need something for mode here? or does mode just set custome runtime conditions
    "targetID": "String | null",
    "reportOnly": "Boolean"
  }
}

```

---

## **2\. Property Definitions & Sources**

### **2.1 `ctx.config`**

* **Source:** `ControlPanel` tab.  
* **Role:** Defines the "Scope" of the current goSync. Think goSync(context)   
* **Logic:** If `autoUpdate` is false, engines should log proposed changes to `Audit_Log` but not call `setValues()` or `CalendarApp`.  
* To Do:   
  * Add “Log Types” multiple selection dropdown referencing the lookup sheet  
  * 

### **2.2 `ctx.maps`**

* **Moved to ctx.sheets.map**

### **2.3 `ctx.sheets`**

* **Source:** `Sheet_Settings` tab.  
* **Role:** Defines Sheet Properties and Behaviors  
* **Behaviors:**   
  * `SOURCE`: This sheet is the master. Push data *out* from here.  
  * `PULL`: This sheet is a consumer. Pull data *into* here.  
  * `MIRROR`: Bi-directional/Synchronized.  
    * Mirror.options  
    *   
* Map:  
  * **Source:** `Map_Registry` tab.  
  * **Role:** Decouples code from column order.  
  * **Usage:** Instead of `row[5]`, use `row[ctx.maps.Lineup.Venue.index]`.  
    * ..Lineup(row /ID)  
  * **Maintenance:** If a user moves a column, `engine_maintenance.runMasterHeaderReset()` updates this map.  
* To Do:  
  * I would like to eventually have behaviors be user configurable such as with statuses and configuring highlight color and associated behaviors. Currently we have a behavior lookup.   
  * Helper: ID to associated range

### **2.4 `ctx.rules`**

* **Source:** `Status,` `Lookup, Modes,` tabs.  
* **Role:** The "Decision Brain."  
* **Logic Keys (from Status tab): Behaviors/Row Exceptions to assign when a corresponding status is applied**   
  * `SYNC_ALLOWED`: Normal operation.  
  * `BYPASS`: Ignore this row entirely.  
  * `MANUAL_REVIEW`: Stop and flag for user; do not automate.  
  * `PREFER_SOURCE`: If data drifts, overwrite sheet with source data.  
  * `PREFER_EXTERNAL`: If data drifts, overwrite sheet with Calendar data.  
* To Do:   
  * Update 2.4 based on current version of status and lookup sheets  
  * Prepare a function to backfill hardcoded statuses and lookups into the sheet

---

## **3\. Usage Examples**

### **Fetching a Value Safely**

JavaScript

```
// Get the Venue from a Lineup row
const lineupMap = ctx.sheets.map.Lineup;
const venueValue = row[lineupMap.Venue.index];
```

### **Checking Permission to Sync**

JavaScript

```
const rowStatus = row[ctx.maps.Lineup.SyncStatus.index];
const behavior = ctx.rules.statusBehaviors[rowStatus];

if (behavior === "BYPASS") {
  return; // Skip this row
}
```

---

## 4\. Initialization Workflow

1. **Trigger:** User clicks menu or `onEdit` fires. Nearly every script action will need to reference context somehow  
2. **Core Call:** `engine_core.gs` calls `buildContext()`.  
3. **Loading:** \* `Config.getGlobalConfig()` (ControlPanel)  
   * `Config.getMapRegistry()` (Map\_Registry)  
   * `Config.getSheetSettings()` (Sheet\_Settings)  
   * `Config.getRules()` (Status & Lookup)  
4. **Validation:** If `ctx.maps` is missing critical fields (like `UUID`), throw error immediately before any data is processed.

## 5\. Reference Files

1. scriptLib.md: early revisions. Major work needs to be done to organize this library.   
2. engine.md: early revisions. Document was just split into several smaller documents for organization  
3. TesterSheet.md: early revisions. Document intended to explain the sheets and purposes 

# scriptLib.md

# scriptLib.md

1. Library: scriptLib  
   1. General use Helper functions not specific to any one spreadsheet  
   2. It is linked to our working script by script id (Head)  
   3. Organize functions by type. Maybe helper “classes” and create scriptLib.md as we organize   
   4. This whole library is utilities and helpers that can be applied in the future.   
   5. Recommendations:  
      1. SL.DataSync: Create a generic reconcileRows(sourceArray, targetArray, mapping) that uses the hashes to find drifts. It shouldn't care if the data is a "Show Time" or a "Staff Member."  
      2. SL.TheatricalParser: Move all logic for handling "8:30am–11:30am" or "TBD" here. This is a common pain point in production. It should return a standardized JSON object: {start: Date, end: Date, isTBD: Boolean, duration: Number}.  
      3. SL.Validation: A universal checkID(id, type) that references your idLog pattern.  
      4. SL.ColorProvider: A function that fetches Hex codes based on a status key, used for both sheet formatting and future UI elements.  
2. Crud4Sheets.gs  
   1. Purpose:   
      1. db class for Google Apps Script  
      2. Provides methods for Create, Read, Update, and Delete operations on Google Sheets  
      3. Use CRUD for all idLog and Audit\_Log operations. These sheets are "Append Only" or "Lookup Only," which is exactly what the db class excels at.  
      4. Use standard array batching for the "Ingests," but use CRUD for the "Maintenance" of single-record updates  
   2. Notes: feels way under-utilized currently? Do we need CRUDforSheets.md?  
   3. Optimization: When engine\_sync finds a change, it should send the "Before" and "After" state to scriptLib.appendAudit(ctx, oldRow, newRow). This keeps the logging logic out of your main sync loop.  
   4. \[ \] CRUD Integration: Map CrudForSheets.js methods to scriptLib wrappers to simplify calls like SL.DB.append('Audit\_Log', data).

```javascript
/**
 * db class for Google Apps Script
 * Provides methods for Create, Read, Update, and Delete operations on Google Sheets
 */

class DB {
  /**
   * @param {string} dbName - The name of the Google Spreadsheet to create and operate on.
   * @param {string} dbId - The id of the Google Spreadsheet if already created.
   */
  constructor(dbName, dbId = null) {
    try {
      let ssId;
      if (!dbId) {
        let ss = SpreadsheetApp.create(dbName);
        ssId = ss.getId();
      } else {
        ssId = dbId;
      }
      this.spreadsheet = SpreadsheetApp.openById(ssId);
      this.cache = CacheService.getScriptCache();
      this.tables = {};
      this.creationResult = {
        status: 200,
        message: "database initialized successfully",
      };
      //script lock
      this.lockService = LockService.getScriptLock();
      //userlock
      this.userLockService = LockService.getUserLock();
      this.lockTimeout = 100;
      this.readLockTimeout = 30000;
    } catch (err) {
      console.error(
        `Something went wrong initializing the DB: ${err.message}`,
        err.stack
      );
      this.creationResult = {
        status: 500,
        error: err.message,
      };
    }
  }

  _acquireLock(tableName, recordId, lockType) {
    try {
      // create the lock key
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      console.log(
        `[LOCK] Attempting to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
      );

      let lock = false;

      if (lockType === "write") {
        lock = this.lockService.tryLock(this.lockTimeout);
      } else if (lockType === "read") {
        lock = this.lockService.tryLock(this.readLockTimeout);
      }

      if (lock) {
        console.log(
          `[LOCK] Acquired ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return true;
      } else {
        console.warn(
          `[LOCK] Failed to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return false;
      }
    } catch (err) {
      console.error(`[LOCK] Error acquiring lock: ${err.stack}`);
      return false;
    }
  }

  _releaseLock(tableName, recordId, lockType) {
    try {
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      Utilities.sleep(400);
      this.lockService.releaseLock();
      console.log(
        `[LOCK] Released ${lockType} lock for record ${recordId} in table ${tableName}`
      );
    } catch (err) {
      console.error(`[LOCK] Error releasing lock: ${err.stack}`);
    }
  }

  releaseLocks() {
    try {
      this.lockService.releaseLock();
      console.log("[LOCK] Released all locks");
    } catch (err) {
      console.error(`[LOCK] Error in releaseLocks: ${err.stack}`);
    }
  }

  /**
   * Sanitizes cell values to prevent CSV injection attacks (CVE-2023-XXXXX)
   * Prevents formula injection by escaping dangerous characters
   * @param {*} value - The value to sanitize
   * @returns {*} Sanitized value safe for spreadsheet insertion
   * @private
   */
  _sanitizeForCSV(value) {
    // Only sanitize string values
    if (typeof value !== "string") {
      return value;
    }

    // Empty strings are safe
    if (value.length === 0) {
      return value;
    }

    // Check if the string starts with dangerous characters
    // These can trigger formula execution in spreadsheet applications:
    // = (formula), + (formula), - (formula), @ (formula),
    // \t (tab), \r (carriage return)
    const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
    const firstChar = value.charAt(0);

    if (dangerousChars.includes(firstChar)) {
      // Prepend with double quote to prevent formula execution
      // This makes the cell text-only in Google Sheets/Excel
      return "''" + value;
    }

    // Also check for pipe character followed by potentially dangerous patterns
    // This prevents DDE attacks: =cmd|'/c calc'!A1
    if (
      value.includes("|") &&
      (value.includes("cmd") || value.includes("powershell"))
    ) {
      return "''" + value;
    }

    return value;
  }

  /**
   * Sanitizes an entire row of values before writing to sheet
   * @param {Array} row - Array of values to sanitize
   * @returns {Array} Sanitized row
   * @private
   */
  _sanitizeRow(row) {
    return row.map((value) => this._sanitizeForCSV(value));
  }

  getCreationResult() {
    return this.creationResult;
  }

  /**
   * Creates a new table in the spreadsheet with an optional history table.
   * @param {Object} config - Configuration for creating the table.
   * @param {string} config.tableName - Name of the main table.
   * @param {string} [config.historyTableName] - Name of the history table.
   * @param {Object<columnName, type>} config.fields - Fields of the table.
   */
  createTable(config) {
    try {
      const { tableName, historyTableName, fields } = config;

      let mainTable = this.spreadsheet.getSheetByName(tableName);
      if (!mainTable) {
        mainTable = this.spreadsheet.insertSheet(tableName);
      }
      let historyTable;
      if (historyTableName) {
        historyTable = this.spreadsheet.getSheetByName(historyTableName);
        if (!historyTable) {
          historyTable = this.spreadsheet.insertSheet(historyTableName);
        }
      } else {
        historyTable = this.spreadsheet.getSheetByName(`DELETED_${tableName}`);
        if (!historyTable)
          historyTable = this.spreadsheet.insertSheet(`DELETED_${tableName}`);
      }

      const headers = [
        "ID",
        "DATE",
        ...Object.keys(fields).map((field) => field.toUpperCase()),
      ];

      // Sanitize headers to prevent CSV injection
      const sanitizedHeaders = this._sanitizeRow(headers);
      mainTable
        .getRange(1, 1, 1, sanitizedHeaders.length)
        .setValues([sanitizedHeaders]);
      historyTable
        .getRange(1, 1, 1, sanitizedHeaders.length)
        .setValues([sanitizedHeaders]);

      this.tables[tableName] = this._normalizeSchemaFields(fields);
      return {
        status: 200,
        message: "table created successfully",
      };
    } catch (err) {
      console.error(`Error when trying to init the database: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Creates configuration for a many-to-many junction table
   * @param {Object} config Configuration object
   * @param {string} config.tableName Name of the junction table
   * @param {string} config.historyTableName Name of the history table
   * @param {string} config.entity1TableName Name of the first entity table
   * @param {string} config.entity2TableName Name of the second entity table
   * @param {Object} [config.fieldsRelatedToBothEntities] Additional fields that describe the relationship
   * @returns {Object} Table configuration object
   */
  createManyToManyTableConfig(config) {
    try {
      const {
        entity1TableName,
        entity2TableName,
        fieldsRelatedToBothEntities,
      } = config;

      if (!entity1TableName || !entity2TableName) {
        throw new Error(
          "Required fields missing: tableName, entity1TableName, and entity2TableName are required"
        );
      }

      //check if the 2 entities are in schema context
      if (!this.tables[entity1TableName] || !this.tables[entity2TableName]) {
        throw new Error(
          `Tables must be in schema context before creating relation. ` +
            `${entity1TableName} exists: ${!!this.tables[entity1TableName]}, ` +
            `${entity2TableName} exists: ${!!this.tables[entity2TableName]}`
        );
      }

      //check if the parent tables actually exist as sheets
      const entity1Sheet = this._getSheet(entity1TableName);
      const entity2Sheet = this._getSheet(entity2TableName);
      if (!entity1Sheet || !entity2Sheet) {
        throw new Error(
          `Parent tables must exist as sheets before creating junction table. ` +
            `${entity1TableName} sheet exists: ${!!entity1Sheet}, ` +
            `${entity2TableName} sheet exists: ${!!entity2Sheet}`
        );
      }

      this._checkValidCreationTypes(fieldsRelatedToBothEntities);

      return {
        status: 200,
        data: {
          tableName: `${entity1TableName}_${entity2TableName}_RELATION`,
          historyTableName: `DELETED_${entity1TableName}_${entity2TableName}_RELATION`,
          fields: {
            created_at: "date",
            [`${entity1TableName.toLocaleLowerCase()}_id`]: "number",
            [`${entity2TableName.toLocaleLowerCase()}_id`]: "number",
            ...fieldsRelatedToBothEntities,
          },
        },
        message: `config object for Junction table ${entity1TableName}_${entity2TableName}_RELATION, dont forget to put the tableConfig into schema context`,
      };
    } catch (err) {
      console.error(`Error in createManyToManyTableConfig: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Adds a table to the database context
   * @param {Object} config - Table configuration object
   * @param {string} config.tableName - Name of the table
   * @param {Object} config.fields - Field definitions for the table
   * @returns {Object} Status of the operation
   */
  putTableIntoDbContext(config) {
    const { tableName, historyTableName, fields } = config;

    if (this.tables[tableName]) {
      console.error(
        `Error when trying to put table in context of the database: Already in context`
      );
      return {
        status: 500,
        error:
          "Error when trying to put table in context of the database: Already in context",
      };
    } else {
      this.tables[tableName] = this._normalizeSchemaFields(fields);
      return {
        status: 200,
        message: "Table added to the schema",
      };
    }
  }

  /**
   * Create a new record in the specified table or update an existing one based on addUpdatePolicy
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} data - Data to be inserted or updated
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @param {Object} [addUpdatePolicy] - Policy for updating existing records
   * @param {string} addUpdatePolicy.key - The key to search for existing records
   * @param {*} addUpdatePolicy.value - The value to match for the key
   * @returns {Object} Status and ID of the created or updated record
   */

  create(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      const sheet = this._getSheet(tableName);
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }
      // Apply defaults before validation and type checking
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during create:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      let typesChecked = false;
      if (this.tables[tableName]) {
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
      }

      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "data has matched on the additional update policy:  " +
            dataWithDefaults[addUpdatePolicy.key]
        );
        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          const searchResult = column
            .createTextFinder(addUpdatePolicy.value.toString())
            .matchEntireCell(true)
            .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
          }
        }
      }

      const now = new Date();

      if (existingRowIndex > -1) {
        //acquiring lock!!
        if (!this._acquireLock(tableName, id, "write")) {
          throw new Error("Could not acquire lock for update operation");
        }
        try {
          const updateResult = this.update(
            tableName,
            id,
            dataWithDefaults,
            keyOrder,
            typesChecked
          );
          updateResult.action = "updated";
          return updateResult;
        } finally {
          this._releaseLock(tableName, id, "write");
        }
      } else {
        const id = this._getNextId(sheet);
        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
            return value;
          }),
        ];
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(row);
        sheet.appendRow(sanitizedRow);

        this._clearCache(tableName);
        return {
          status: 200,
          id: id,
          action: "created",
        };
      }
    } catch (err) {
      console.error(`Error in create: ${err.message}`);
      return {
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
        error: err.message,
      };
    }
  }

  /**
   * Creates a record in a junction table for many-to-many relationships
   * @param {string} junctionTableName - Name of the junction table
   * @param {Object} data - Data containing the foreign keys and additional fields
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @returns {Object} Status and ID of the created junction record
   */
  createJunctionRecord(junctionTableName, data, keyOrder) {
    try {
      // Validate required parameters
      if (!data || Object.keys(data).length === 0) {
        throw new Error("Data parameter is required for createJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found`);
      }

      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          `Junction table must have exactly two foreign key fields, got ${
            Object.keys(data).filter((key) => key.includes("_id")).length
          } for table ${junctionTableName} , keys received: ${Object.keys(
            data
          ).join(", ")}`
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));
      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();
      const existingRecords = [];
      entityFkIndices.forEach((colIndex) =>
        existingRecords.push(
          table.getRange(2, colIndex + 1, lastRow - 1).getValues()
        )
      );

      // console.log("existing records:", existingRecords)
      // console.log("existing records length:", existingRecords[0].length)
      // console.log("fks length:", fksIds.length)
      // console.log("existing records first element:", existingRecords[0][0][0])
      let isDuplicate = false;

      for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
        let isMatch = true;
        for (let j = 0; j < existingRecords.length && isMatch; j++) {
          if (existingRecords[j][i][0] !== fksIds[j]) {
            isMatch = false;
          }
        }
        if (isMatch) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(", ")}`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.create(junctionTableName, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error in createJunctionRecord:", err.stack);
      const isValidationError =
        err.message.includes("Data parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder");
      return {
        status: isValidationError ? 400 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Gets records from a junction table along with related data
   * @param {string} junctionTableName - Name of the junction table
   * @param {string} sourceTableName - Name of the source table
   * @param {string} targetTableName - Name of the target table
   * @param {number} sourceId - ID from the source table
   * @param {Object} options - Options for pagination and sorting
   * @returns {Object} Status and array of related records with their relationships
   */
  getJunctionRecords(
    junctionTableName,
    sourceTableName,
    targetTableName,
    sourceId,
    options
  ) {
    try {
      console.log("[JUNCTION] Starting junction record retrieval:", {
        junctionTable: junctionTableName,
        sourceTable: sourceTableName,
        targetTable: targetTableName,
        sourceId,
        options,
      });
      const foreignKeyField = `${sourceTableName.toLowerCase()}_id`;
      const targetKeyField = `${targetTableName.toLowerCase()}_id`;
      const fieldIndex = this._getFieldIndex(
        junctionTableName,
        foreignKeyField
      );

      if (fieldIndex === -1) {
        throw new Error(
          `Foreign key field '${foreignKeyField}' not found in junction table`
        );
      }

      const junctionResult = this.getRelatedRecords(
        sourceId,
        junctionTableName,
        foreignKeyField,
        fieldIndex,
        options
      );

      if (junctionResult.status !== 200) {
        return junctionResult;
      }

      if (junctionResult.data.length === 0) {
        return {
          status: 200,
          data: [],
          message: `No relations found for ${sourceTableName} ID ${sourceId}`,
        };
      }

      const targetsIds = [];

      for (let i = 0; i < junctionResult.data.length; i++) {
        targetsIds.push(junctionResult.data[i][targetKeyField]);
      }
      console.log("[JUNCTION] Found target IDs:", targetsIds);

      const targetRecords = this.readIdList(targetTableName, targetsIds);

      if (targetRecords.status !== 200) {
        return targetRecords;
      }

      const combinedData = [];

      const targetMap = new Map(
        targetRecords.data.map((record) => [record.id, record])
      );

      for (let i = 0; i < junctionResult.data.length; i++) {
        const targetRecord = targetMap.get(
          junctionResult.data[i][targetKeyField]
        );
        if (targetRecord) {
          combinedData.push({
            ...targetRecord,
            relationship: junctionResult.data[i],
          });
        }
      }

      return {
        status: 200,
        data: combinedData,
        message: `Retrieved ${combinedData.length} related records from ${targetTableName}`,
        metadata: {
          totalJunctionRecords: junctionResult.data.length,
          totalTargetRecords: targetRecords.data.length,
          missingTargets: targetsIds.length - combinedData.length,
        },
      };
    } catch (err) {
      console.error(`Error in getJunctionRecords: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  createWithLogs(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      console.log("\n[CREATE] Starting create operation:", {
        tableName,
        data,
        keyOrder,
        addUpdatePolicy,
      });

      // Get sheet and validate existence
      const sheet = this._getSheet(tableName);
      console.log("[SHEET] Retrieved sheet:", sheet ? sheet.getName() : "null");
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }

      // Apply defaults then validate
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during createWithLogs:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      console.log("[VALIDATION] Starting data validation");
      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      console.log("[VALIDATION] Result:", validation);
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      // Type checking
      let typesChecked = false;
      if (this.tables[tableName]) {
        console.log(
          "[TYPES] Starting type validation for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("[TYPES] Checking field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
        console.log("[TYPES] All type checks passed");
      } else {
        console.log(
          "[TYPES] No type definitions found for table, skipping type checks"
        );
      }

      // Check for existing record
      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "[UPDATE POLICY] Checking for existing record with policy:",
          {
            key: addUpdatePolicy.key,
            value: addUpdatePolicy.value,
            matchValue: dataWithDefaults[addUpdatePolicy.key],
          }
        );

        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        console.log("[UPDATE POLICY] Calculated column index:", columnIndex);

        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          console.log("[UPDATE POLICY] Searching in range:", {
            startRow: 2,
            column: columnIndex,
            numRows: sheet.getLastRow() - 1,
          });

          const searchResult = column
            .createTextFinder(addUpdatePolicy.value.toString())
            .matchEntireCell(true)
            .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
            console.log("[UPDATE POLICY] Found existing record:", {
              row: existingRowIndex,
              id: id,
            });
          } else {
            console.log("[UPDATE POLICY] No existing record found");
          }
        }
      }

      const now = new Date();
      console.log("[TIMESTAMP] Using timestamp:", now);

      if (existingRowIndex > -1) {
        // Update existing Record
        console.log("[UPDATE] Updating existing record:", {
          tableName,
          id,
          existingRowIndex,
        });

        const updateResult = this.update(
          tableName,
          id,
          dataWithDefaults,
          keyOrder,
          typesChecked
        );
        updateResult.action = "updated";
        console.log("[UPDATE] Update complete:", updateResult);
        return updateResult;
      } else {
        // Create new record
        console.log("[CREATE] Creating new record");
        const id = this._getNextId(sheet);
        console.log("[CREATE] Generated new ID:", id);

        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            console.log("[CREATE] Processing field:", {
              key,
              value,
              type: typeof value,
              isUndefined: value === undefined,
              isBoolean: this._getExpectedType(tableName, key) === "boolean",
            });

            if (value === undefined) return "";
            if (this._getExpectedType(tableName, key) === "boolean")
              return value.toString();
            return value;
          }),
        ];

        console.log("[CREATE] Final row data to append:", row);
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(row);
        sheet.appendRow(sanitizedRow);

        const dataView = sheet
          .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
          .getValues()
          .slice(10);
        console.log("[CREATE CHECK] Final sheet data ", dataView);

        console.log("[CACHE] Clearing cache for table:", tableName);
        this._clearCache(tableName);

        const result = {
          status: 200,
          id: id,
          action: "created",
        };
        console.log("[CREATE] Operation complete:", result);
        return result;
      }
    } catch (err) {
      console.error("[ERROR] Error in create operation:", {
        error: err.message,
        stack: err.stack,
        tableName,
        data,
      });
      return {
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
        error: err.message,
      };
    }
  }
  /**
   * Update a record in the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to update
   * @param {Object} data - New data for the record
   * @param {string[]} keyOrder - Order of keys to be updated
   * @param typesChecked - Flag indicating if the types of the data are already checked
   * @param addUpdatePolicy
   * @returns {Object} Status and updated data
   */
  update(
    tableName,
    id,
    data,
    keyOrder,
    typesChecked = false,
    addUpdatePolicy = null
  ) {
    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table ${tableName} not found`);

        let rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        // Apply defaults before validation
        const defaultsApplication = this._applyDefaults(
          tableName,
          data,
          keyOrder
        );
        const dataWithDefaults = defaultsApplication.data;
        if (defaultsApplication.appliedDefaults.length > 0) {
          console.warn("[DEFAULTS] Applied during update:", {
            tableName,
            id,
            applied: defaultsApplication.appliedDefaults,
          });
        }

        const validation = this._validateData(
          tableName,
          dataWithDefaults,
          keyOrder,
          `in table "${tableName}"`
        );
        if (!validation.isValid) {
          throw new Error(
            `Missing required fields: ${validation.missingKeys.join(
              ", "
            )} in table "${tableName}"`
          );
        }

        if (!typesChecked) {
          if (this.tables[tableName]) {
            for (const [key, val] of Object.entries(dataWithDefaults)) {
              const expectedType = this._getExpectedType(tableName, key);
              if (expectedType && !this._checkType(val, expectedType)) {
                throw new Error(
                  `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
                );
              }
            }
          }
        }

        if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
          console.log(
            "data has matched on the additional update policy:  " +
              dataWithDefaults[addUpdatePolicy.key]
          );
          const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
          if (columnIndex > 2) {
            const column = sheet.getRange(
              2,
              columnIndex,
              sheet.getLastRow() - 1
            );
            const searchResult = column
              .createTextFinder(addUpdatePolicy.value.toString())
              .matchEntireCell(true)
              .findNext();

            if (searchResult) {
              rowIndex = searchResult.getRow();
              id = sheet.getRange(rowIndex, 1).getValue();
            }
          }
        }

        const now = new Date();
        const updatedRow = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
            return value;
          }),
        ];
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(updatedRow);
        sheet
          .getRange(rowIndex, 1, 1, sanitizedRow.length)
          .setValues([sanitizedRow]);

        this._clearCache(tableName);
        console.log(updatedRow);
        return {
          status: 200,
          id: id,
          data: { id: id, date: now, ...dataWithDefaults }, // includes defaults used
          action: "updated",
        };
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in update: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
        error: err.message,
      };
    }
  }

  updateWithLogs(
    tableName,
    id,
    data,
    keyOrder,
    typesChecked = false,
    addUpdatePolicy = null
  ) {
    try {
      console.log("Update Method Input:", {
        tableName,
        id,
        data,
        keyOrder,
        typesChecked,
        addUpdatePolicy,
      });

      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      let rowIndex = this._findRowById(sheet, id);
      console.log("Found row index:", rowIndex);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      // Apply defaults and validate
      const defaultsApplicationUW = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaultsUW = defaultsApplicationUW.data;
      if (defaultsApplicationUW.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during updateWithLogs:", {
          tableName,
          id,
          applied: defaultsApplicationUW.appliedDefaults,
        });
      }
      const validation = this._validateData(
        tableName,
        dataWithDefaultsUW,
        keyOrder,
        `in table "${tableName}"`
      );
      console.log("Validation result:", validation);

      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} in table "${tableName}"`
        );
      }

      // Type checking
      if (!typesChecked && this.tables[tableName]) {
        console.log(
          "Performing type checks for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaultsUW)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("Checking type for field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkTypeWithLogs(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
            );
          }
        }
      }

      // Build updated row data
      const now = new Date();
      const updatedRow = [id, now];

      console.log("Building row data with keyOrder:", keyOrder);

      keyOrder.forEach((key) => {
        const value = dataWithDefaultsUW[key];
        console.log("Processing field:", {
          key,
          value,
          type: typeof value,
          fieldType: this._getExpectedType(tableName, key),
        });

        if (value === undefined) {
          updatedRow.push("");
        } else if (this._getExpectedType(tableName, key) === "boolean") {
          updatedRow.push(Boolean(value).toString());
        } else if (value === null) {
          updatedRow.push("");
        } else {
          updatedRow.push(value);
        }
      });

      console.log("Final row data to write:", updatedRow);

      // Update the sheet
      // Sanitize row to prevent CSV injection
      const sanitizedRow = this._sanitizeRow(updatedRow);
      const range = sheet.getRange(rowIndex, 1, 1, sanitizedRow.length);
      console.log("Updating range:", {
        row: rowIndex,
        columns: sanitizedRow.length,
        values: sanitizedRow,
      });

      range.setValues([sanitizedRow]);

      this._clearCache(tableName);

      return {
        status: 200,
        id: id,
        data: dataWithDefaultsUW,
        action: "updated",
      };
    } catch (err) {
      console.error("Update error details:", {
        error: err.message,
        stack: err.stack,
      });
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
        error: err.message,
      };
    }
  }
  /**
   * Read a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to read
   * @returns {Object} Status and data of the read record
   */
  read(tableName, id) {
    try {
      if (!this._acquireLock(tableName, id, "read")) {
        throw new Error("Could not acquire read lock");
      }

      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table "${tableName}" not found`);

        const rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        const row = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];

        let headers_caps = this._getHeaders(sheet);

        const headers = [];
        headers_caps.forEach((s) => headers.push(s.toLowerCase()));

        const record = headers.reduce((acc, header, index) => {
          acc[header] = row[index];
          return acc;
        }, {});

        return {
          status: 200,
          data: record,
        };
      } finally {
        this._releaseLock(tableName, id, "read");
      }
    } catch (err) {
      console.error(`Error in read: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Reads a list of records by their IDs
   * @param {string} tableName - Name of the table to read from
   * @param {number[]} ids - Array of record IDs to retrieve
   * @returns {Object} Status and array of found records, with list of any IDs not found
   */
  readIdList(tableName, ids) {
    try {
      console.log("[READ LIST] Starting batch read operation:", {
        tableName,
        numberOfIds: ids.length,
        ids,
      });

      const MAX_IDS = 1000;
      if (ids.length > MAX_IDS) {
        return {
          status: 400,
          error: {
            message: `Cannot request more than ${MAX_IDS} records at once, try getAll()`,
          },
        };
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: 400,
          error: {
            message: "IDs must be a non-empty array",
          },
        };
      }
      if (!ids.every((id) => typeof id === "number")) {
        return {
          status: 400,
          error: {
            message: "All IDs must be numbers",
          },
        };
      }

      const table = this._getSheet(tableName);
      if (!table) throw new Error(`Table "${tableName}" not found`);

      const headers = this._getHeaders(table);
      console.log("[READ LIST] Retrieved headers:", headers);

      const idsSet = new Set(ids);
      const idsFound = new Map(ids.map((id) => [id, false]));
      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();

      const records = [];

      for (let i = 0; i < data.length; i++) {
        if (idsSet.has(data[i][0])) {
          const record = headers.reduce((acc, header, index) => {
            acc[header.toLowerCase()] = data[i][index];
            return acc;
          }, {});
          records.push(record);
          idsFound.set(data[i][0], true);
        }
      }

      const notFoundIds = Array.from(idsFound.entries())
        .filter(([_, found]) => !found)
        .map(([id, _]) => id);

      console.log("[READ LIST] Retrieved records:", {
        found: records.length,
        notFound: notFoundIds,
      });

      return {
        status: 200,
        data: records,
        notFound: notFoundIds,
        message:
          notFoundIds.size > 0
            ? `Retrieved ${
                records.length
              } records. IDs not found: ${notFoundIds.join(", ")}`
            : `Retrieved ${records.length} records successfully`,
      };
    } catch (err) {
      console.error("[READ LIST] Error: ", err.stack);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Delete a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {string} historyTableName - Name of the history sheet/table
   * @param {number} id - ID of the record to delete
   * @returns {Object} Status of the operation
   */
  remove(tableName, historyTableName, id) {
    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        const sheet = this._getSheet(tableName);
        const historySheet = this._getSheet(historyTableName);
        if (!sheet) throw new Error(`Table "${tableName}" not found`);
        if (!historySheet)
          throw new Error(`History Table "${tableName}" not found`);

        const rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        const deletedRow = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];
        sheet.deleteRow(rowIndex);

        const historyId = this._getNextId(historySheet);
        // Sanitize row to prevent CSV injection
        const historyRow = this._sanitizeRow([
          historyId,
          new Date(),
          ...deletedRow.slice(2),
        ]);
        historySheet.appendRow(historyRow);

        this._clearCache(tableName);
        this._clearCache(historyTableName);

        return {
          status: 200,
          message: "Record removed succesfully",
        };
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in remove: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Removes a record and its related junction records
   * @param {string} tableName - Name of the table
   * @param {string} historyTableName - Name of the history table
   * @param {number} id - ID of the record to remove
   * @returns {Object} Status of the cascade delete operation
   */
  removeWithCascade(tableName, historyTableName, id) {
    try {
      const sheet = this._getSheet(tableName);
      const historySheet = this._getSheet(historyTableName);
      if (!tableName) throw new Error(`Table name is required`); //see if this breaks the test suite
      if (!historyTableName) throw new Error(`History table name is required`); //see if this breaks the test suite
      if (!id) throw new Error(`ID is required`); //see if this breaks the test suite
      if (!sheet) throw new Error(`Table "${tableName}" not found`);
      if (!historySheet)
        throw new Error(`History Table "${historyTableName}" not found`);

      const rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      this._handleCascadeDelete(tableName, id); // aca no se si esto debe ser un response o un try catch

      const deletedRow = sheet
        .getRange(rowIndex, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      sheet.deleteRow(rowIndex);

      const historyId = this._getNextId(historySheet);
      // Sanitize row to prevent CSV injection
      const historyRow = this._sanitizeRow([
        historyId,
        new Date(),
        ...deletedRow.slice(2),
      ]);
      historySheet.appendRow(historyRow);

      this._clearCache(tableName);
      this._clearCache(historyTableName);

      return {
        status: 200,
        message: "Record removed succesfully",
      };
    } catch (err) {
      console.error(`Error in remove: ${err.stack}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Validates the integrity of a junction table
   * @param {string} junctionTableName - Name of the junction table to check
   * @param {string} junctionHistoryTableName - Name of the history table
   * @returns {Object} Status and count of invalid records removed
   */
  checkTableIntegrity(junctionTableName, junctionHistoryTableName) {
    try {
      const table = this._getSheet(junctionTableName);
      const historyTable = this._getSheet(junctionHistoryTableName);

      if (!table || !historyTable) {
        console.error("[SHEETS] Sheet reference check failed:", {
          mainTableExists: !!table,
          historyTableExists: !!historyTable,
        });
        throw new Error(
          !table
            ? `Table '${tableName}' not found when trying to delete related junction records`
            : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
        );
      }

      const headers = this._getHeaders(table);
      const fkColumns = headers.filter((h) => h.toLowerCase().endsWith("_id"));

      if (fkColumns.length !== 2) {
        throw new Error("Invalid junction table structure");
      }

      if (table.getLastRow() === 1)
        return {
          status: 204,
          message: "No records to check integrity of.",
          count: 0,
        };

      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();
      const invalidRows = [];
      const rowsToRemove = [];

      const historyId = this._getNextId(historyTable);

      for (let i = 0; i < data.length; i++) {
        let isValid = true;
        for (let j = 0; j < fkColumns.length; j++) {
          const colIndex = headers.indexOf(fkColumns[j]);
          const fkValue = data[i][colIndex];
          const parentTable = fkColumns[j].replace(/_id$/i, "").toUpperCase();

          const response = this.read(parentTable, fkValue);
          if (response.status !== 200) {
            isValid = false;
          }
        }
        if (!isValid) {
          invalidRows.unshift(i + 2);
          rowsToRemove.push([
            historyId + invalidRows.length,
            new Date(),
            ...data[i].slice(2),
          ]);
        }
      }

      if (invalidRows.length > 0) {
        console.log("[DELETE] Starting row deletion process");
        invalidRows.forEach((rowIdx, index) => {
          console.log(
            `[DELETE] Removing row ${rowIdx} (${index + 1}/${
              invalidRows.length
            })`
          );
          table.deleteRow(rowIdx);
        });
        console.log("[DELETE] Row deletion completed");

        // Add to history
        console.log("[HISTORY] Adding records to history table");
        // Sanitize rows to prevent CSV injection
        const sanitizedRowsToRemove = rowsToRemove.map((row) =>
          this._sanitizeRow(row)
        );
        const historyRange = historyTable.getRange(
          historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
          1,
          sanitizedRowsToRemove.length,
          sanitizedRowsToRemove[0].length
        );
        historyRange.setValues(sanitizedRowsToRemove);
        console.log("[HISTORY] History records added successfully");

        // Clear cache
        console.log("[CACHE] Clearing cache for affected tables");
        this._clearCache(junctionTableName);
        this._clearCache(junctionHistoryTableName);
        console.log("[CACHE] Cache cleared successfully");
      } else {
        console.log("[NO_ACTION] No matching records found to delete");
      }

      const result = {
        status: 200,
        count: rowsToRemove.length,
        message: "Record(s) removed successfully",
      };
      console.log("[COMPLETE] Operation finished successfully:", result);
      return result;
    } catch (err) {
      console.error(`Error in checkTableIntegrity: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Deletes related records from a junction table
   * @param {string} tableName - Name of the junction table
   * @param {string} junctionHistoryTableName - Name of the history table
   * @param {number} fkIndex - Index of the foreign key column
   * @param {number} id - ID to match in the foreign key column
   * @returns {Object} Status and count of deleted records
   */
  deleteRelatedJunctionRecords(
    tableName,
    junctionHistoryTableName,
    fkIndex,
    id
  ) {
    console.log("\n[DELETE_JUNCTION] Starting deletion process:", {
      tableName,
      historyTable: junctionHistoryTableName,
      fkIndex,
      targetId: id,
    });

    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        // Get and validate table references
        console.log("[SHEETS] Attempting to get sheet references");
        const table = this._getSheet(tableName);
        const historyTable = this._getSheet(junctionHistoryTableName);

        if (!table || !historyTable) {
          console.error("[SHEETS] Sheet reference check failed:", {
            mainTableExists: !!table,
            historyTableExists: !!historyTable,
          });
          throw new Error(
            !table
              ? `Table '${tableName}' not found when trying to delete related junction records`
              : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
          );
        }
        console.log("[SHEETS] Successfully retrieved both sheets");

        // Check for existing data
        const lastRow = table.getLastRow();
        console.log("[ROWS] Last row in table:", lastRow);

        if (lastRow < 1) {
          console.log("[EMPTY] Table is empty, no records to delete");
          return {
            status: 204,
            message: "No content to delete",
          };
        }

        // Get data range for processing
        console.log("[DATA] Retrieving data range:", {
          startRow: 2,
          targetColumn: fkIndex + 1,
          numRows: lastRow - 1,
          numCols: table.getLastColumn(),
        });

        const idCol = table.getRange(2, fkIndex + 1, lastRow - 1).getValues();
        const fullData = table
          .getRange(2, 1, lastRow - 1, table.getLastColumn())
          .getValues();
        console.log("[DATA] Retrieved rows:", idCol.length);

        // Prepare for deletion
        const historyId = this._getNextId(historyTable);
        console.log("[HISTORY] Generated new history ID:", historyId);

        // Find records to remove
        console.log("[PROCESS] Starting record identification");
        let idxToRemove = [];
        let rowsToRemove = [];

        for (let i = 0; i < idCol.length; i++) {
          if (idCol[i][0] === id) {
            idxToRemove.unshift(i + 2);
            rowsToRemove.push([
              historyId + idxToRemove.length,
              new Date(),
              ...fullData[i].slice(2),
            ]);
            console.log(
              `[MATCH] Found matching record at row ${i + 2}, ${fullData[i]}`
            );
          }
        }

        console.log("[SUMMARY] Records found:", {
          totalMatches: rowsToRemove.length,
          idxToDelete: idxToRemove,
          rowsToDelete: rowsToRemove,
          historyRecordsToCreate: rowsToRemove.length,
        });

        // Perform deletions
        if (idxToRemove.length > 0) {
          console.log("[DELETE] Starting row deletion process");
          idxToRemove.forEach((rowIdx, index) => {
            console.log(
              `[DELETE] Removing row ${rowIdx} (${index + 1}/${
                idxToRemove.length
              })`
            );
            table.deleteRow(rowIdx);
          });
          console.log("[DELETE] Row deletion completed");

          // Add to history
          console.log("[HISTORY] Adding records to history table");
          // Sanitize rows to prevent CSV injection
          const sanitizedRowsToRemove = rowsToRemove.map((row) =>
            this._sanitizeRow(row)
          );
          const historyRange = historyTable.getRange(
            historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
            1,
            sanitizedRowsToRemove.length,
            sanitizedRowsToRemove[0].length
          );
          historyRange.setValues(sanitizedRowsToRemove);
          console.log("[HISTORY] History records added successfully");

          // Clear cache
          console.log("[CACHE] Clearing cache for affected tables");
          this._clearCache(tableName);
          this._clearCache(junctionHistoryTableName);
          console.log("[CACHE] Cache cleared successfully");
        } else {
          console.log("[NO_ACTION] No matching records found to delete");
        }

        const result = {
          status: 200,
          count: rowsToRemove.length,
          message: "Record(s) removed successfully",
        };
        console.log("[COMPLETE] Operation finished successfully:", result);
        return result;
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error("[ERROR] Failed to remove related junction records:", {
        error: err.message,
        stack: err.stack,
        context: {
          tableName,
          historyTable: junctionHistoryTableName,
          fkIndex,
          targetId: id,
        },
      });

      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Get all records from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} options - Options for pagination and sorting
   * @param useCache - Flag that tells the db to use cached records
   * @returns {Object} Status and array of records
   */
  getAll(tableName, options = {}, useCache = true) {
    try {
      let message = "Data retrieved successfully";
      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_all`;
      let data;

      if (useCache) {
        data = this._getCachedData(cacheKey);
      }

      if (!data) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No data in the table "${tableName}"`,
          };
        }

        data = sheet
          .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
          .getValues()
          .map((row) =>
            headers.reduce((acc, header, index) => {
              header = header.toLowerCase();
              acc[header] = row[index];
              return acc;
            }, {})
          );
        if (!(data.length > 1000)) {
          this._setCachedData(cacheKey, data);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);
        if (fieldType) {
          data.sort((a, b) => {
            // console.log(a);
            let compareOperator;
            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }
            return compareOperator * sortOrder;
          });
          message = `Data sorted Succesfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }
        const startIndex = (page - 1) * pageSize;
        data = data.slice(startIndex, startIndex + pageSize);
        message += ` (Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: data,
        message: message,
      };
    } catch (err) {
      console.error(`Error in getAll: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithFilter(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex]);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues()
          .filter((row) => {
            // console.log("row analizada")
            return row[fieldIndex] === foreignKey;
          })
          .map((row) => {
            return headers.reduce((acc, header, index) => {
              header = header.toLowerCase();
              acc[header] = row[index];
              return acc;
            }, {});
          });
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithLogs(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      console.log(`[START] getRelatedRecords with params:`, {
        foreignKey,
        tableName,
        field,
        fieldIndex,
        options,
        useCache,
      });

      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      console.log(`[SHEET] Retrieved sheet:`, sheet ? sheet.getName() : "null");

      // Type checking for foreign key
      if (!(typeof foreignKey === "number")) {
        console.error(`[ERROR] Invalid foreign key type:`, typeof foreignKey);
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);
      }

      // Sheet existence check
      if (!sheet) {
        console.error(`[ERROR] Sheet not found:`, tableName);
        throw new Error(`Table "${tableName}" not found`);
      }

      // Field existence check
      if (!this.tables[tableName][field]) {
        console.error(`[ERROR] Field not found:`, {
          table: tableName,
          field: field,
          availableFields: Object.keys(this.tables[tableName]),
        });
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      // Cache check
      if (useCache) {
        console.log(
          `[CACHE] Attempting to retrieve from cache with key:`,
          cacheKey
        );
        relatedData = this._getCachedData(cacheKey);
        if (relatedData) {
          console.log(
            `[CACHE] Data found in cache, length:`,
            relatedData.length
          );
        } else {
          console.log(`[CACHE] No cached data found`);
        }
      }

      if (!relatedData) {
        console.log(`[PROCESS] Starting data retrieval from sheet`);
        const headers = this._getHeaders(sheet);
        console.log(`[HEADERS] Retrieved headers:`, headers);

        const lastRow = sheet.getLastRow();
        console.log(`[ROWS] Last row:`, lastRow);

        if (sheet.getLastRow() === 1) {
          console.log(`[EMPTY] Table is empty (only headers)`);
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        console.log(`[DATA] Retrieving data range from sheet`);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        console.log(`[DATA] Retrieved ${relatedData.length} rows of raw data`);

        let finalData = [];
        console.log(
          `[FILTER] Starting to filter data with fieldIndex:`,
          fieldIndex
        );
        console.log(`[FILTER] Looking for foreignKey:`, foreignKey);

        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          if (i === 0 || i === relatedData.length - 1) {
            console.log(`[ROW ${i}] Sample row data:`, row);
            console.log(`[ROW ${i}] Value at fieldIndex:`, row[fieldIndex]);
          }

          if (row[fieldIndex] === foreignKey) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
          }
        }

        console.log(`[FILTER] Found ${finalData.length} matching records`);
        relatedData = finalData;

        if (relatedData.length <= 1000) {
          console.log(`[CACHE] Caching ${relatedData.length} records`);
          this._setCachedData(cacheKey, relatedData);
        } else {
          console.log(`[CACHE] Data too large to cache:`, relatedData.length);
        }
      }

      // Sorting
      if (options.sortBy) {
        console.log(`[SORT] Attempting to sort by:`, options.sortBy);
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log(`[SORT] Field type:`, fieldType);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;
            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }
            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          console.warn(`[SORT] Field not found in schema:`, sortField);
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      // Pagination
      if (options.page && options.pageSize) {
        console.log(`[PAGE] Applying pagination:`, options);
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);

        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          console.error(`[PAGE] Invalid pagination parameters:`, {
            page,
            pageSize,
          });
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
        console.log(`[PAGE] Applied pagination, results:`, relatedData.length);
      }

      console.log(`[END] Returning ${relatedData.length} records`);
      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`[ERROR] Error in getRelatedRecords:`, err);
      console.error(`[ERROR] Stack trace:`, err.stack);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Gets related records when provided a fk.
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records with detailed logs
   */
  getRelatedRecords(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex]);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        let finalData = [];
        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          let obj = {};
          if (row[fieldIndex] === foreignKey) {
            // console.log("row que si paso", row)
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
          }
        }
        relatedData = finalData;
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Gets related records using text finder
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records found using text finder
   */
  getRelatedRecordsWithTextFinder(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);
        const lastRow = sheet.getLastRow();
        const lastColumn = sheet.getLastColumn();
        relatedData = [];
        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
        const allData = dataRange.getValues();

        const searchColumnRange = sheet.getRange(
          2,
          fieldIndex + 1,
          lastRow - 1,
          1
        );
        const textFinder = searchColumnRange
          .createTextFinder(foreignKey.toString())
          .matchEntireCell(true)
          .matchCase(false);
        const matchedRanges = textFinder.findAll();

        if (matchedRanges.length === 0) {
          return {
            status: 200,
            data: [],
            message: `No related records found for foreign key ${foreignKey}`,
          };
        }

        const rowIndicesSet = new Set();
        matchedRanges.forEach((range) => {
          rowIndicesSet.add(range.getRow());
        });
        // console.log("set of indices",rowIndicesSet)
        const rowIndices = Array.from(rowIndicesSet).sort((a, b) => a - b);
        // console.log("array of indices ordered",rowIndices)

        // const rowIndices = matchedRanges.map((range) => range.getRow()).sort((a, b) => a - b);
        const filteredRows = rowIndices.map((row) => allData[row - 2]);

        relatedData = filteredRows.map((row) => {
          headers.reduce((acc, header, index) => {
            header = header.toLowerCase();
            acc[header] = row[index];
            return acc;
          }, {});
        });

        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * MANY TO MANY LOGIC (create stays the same)
   */

  updateJunctionRecord(junctionTableName, id, data, keyOrder) {
    try {
      // Validate required parameters
      if (!id) {
        throw new Error("ID parameter is required for updateJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found.`);
      }
      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => !key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          "Junction table must have exactly two foreign key fields"
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));

      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations, excluding the current record being updated
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();

      // Find the row index of the current record being updated
      const currentRecordRow = this._findRowById(table, id);
      if (currentRecordRow === -1) {
        throw new Error(
          `Record with ID ${id} not found in junction table ${junctionTableName}`
        );
      }

      const existingRecords = [];
      entityFkIndices.forEach((colIndex) => {
        // Get values from rows 2 to lastRow, excluding the current record row
        const values = [];
        for (let row = 2; row <= lastRow; row++) {
          if (row !== currentRecordRow) {
            values.push(table.getRange(row, colIndex + 1).getValue());
          }
        }
        existingRecords.push(values);
      });

      console.log("existing records (excluding current):", existingRecords);
      console.log("existing records length:", existingRecords[0]?.length || 0);
      console.log("fks length:", fksIds.length);
      console.log("current record row:", currentRecordRow);

      let isDuplicate = false;

      // Only check for duplicates if there are existing records to compare against
      if (existingRecords[0] && existingRecords[0].length > 0) {
        for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
          let isMatch = true;
          for (let j = 0; j < existingRecords.length && isMatch; j++) {
            if (existingRecords[j][i] !== fksIds[j]) {
              isMatch = false;
            }
          }
          if (isMatch) {
            isDuplicate = true;
          }
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(
            ", "
          )} in another record`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.update(junctionTableName, id, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error updating junction record", err.stack);
      const isValidationError =
        err.message.includes("ID parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder") ||
        err.message.includes("Record with ID");
      return {
        status: err.message.includes("Record with ID")
          ? 404
          : isValidationError
          ? 400
          : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  _getHeaders(sheet) {
    const rawHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    // Ensure all headers are strings to prevent issues with .toLowerCase(), .endsWith(), etc.
    return rawHeaders.map((header) => String(header));
  }

  _getSheet(name) {
    return this.spreadsheet.getSheetByName(name);
  }

  _getNextId(sheet) {
    const lastRow = sheet.getLastRow();
    console.log(lastRow);
    if (lastRow <= 1) return 1;

    const idRange = sheet.getRange("A:A");
    const lastId = idRange.getValues()[lastRow - 1][0];

    const nextId = Math.max(lastRow, parseInt(lastId) + 1);
    console.log("next id", nextId);
    if (isNaN(nextId)) {
      throw new Error(
        "Next ID is not a number, please check the ID column in the sheet"
      );
    }
    return nextId;
  }

  _getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  _setCachedData(key, data) {
    console.log(
      "[CACHE] trying to cache",
      data.length,
      " records in",
      key,
      "key"
    );
    try {
      this.cache.put(key, JSON.stringify(data), 600);
    } catch (e) {
      console.log(
        "[CACHE] tried to cache",
        data.length,
        " records in",
        key,
        "key, but got the error: ",
        e.message
      );
      console.log("[WARNING] NO CACHE SET FOR ", key, " key");
    }
  }

  _clearCache(tableName) {
    this.cache.remove(`${tableName}_all`);
  }

  /**
   * Handles cascade deletion of related records
   * @private
   * @param {string} tableName - Name of the parent table
   * @param {number} id - ID of the record being deleted
   * @returns {Object} Status and count of deleted related records
   */
  _handleCascadeDelete(tableName, id) {
    try {
      const sheets = this.spreadsheet.getSheets();
      const tableBaseName = tableName.toLowerCase();

      let deletedRelations = 0; // Track number of affected records
      for (const sheet of sheets) {
        const sheetName = sheet.getName();
        if (!sheetName.includes("DELETED") && sheetName.includes("RELATION")) {
          const junctionTableName = sheetName;
          const junctionHistoryTableName = `DELETED_${sheetName}`;
          const headers = this._getHeaders(sheet);
          const fkFieldName = `${tableBaseName}_id`;

          const fkIndex = headers.indexOf(fkFieldName.toUpperCase());

          if (fkIndex !== -1) {
            const response = this.deleteRelatedJunctionRecords(
              junctionTableName,
              junctionHistoryTableName,
              fkIndex,
              id
            );
            if (response.status === 200) {
              deletedRelations += response.count;
            }
          }
        }
      }
      return {
        status: 200,
        message: `Cascade delete completed. Removed ${deletedRelations} related records`,
      };
    } catch (err) {
      console.error("Cascade delete failed:", err);
      throw err; // Propagate error to main delete operation
    }
  }

  /**
   * Find the row index of a record by its ID
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to search in
   * @param {number|string} id - The ID to search for
   * @returns {number} The row index of the found ID, or -1 if not found
   */
  _findRowById(sheet, id) {
    const idRange = sheet.getRange("A:A");
    const searchResult = idRange
      .createTextFinder(id.toString())
      .matchEntireCell(true)
      .matchCase(false)
      .findNext();
    return searchResult ? searchResult.getRow() : -1;
  }

  // _validateData(data, keyOrder) {
  //   return keyOrder.every((key) => key in data);
  // }

  /**
   * Validates that keyOrder includes all required fields from table schema
   * @param {string} tableName - Name of the table
   * @param {string[]} keyOrder - Array of field names provided
   * @returns {Object} - Validation result with missing required fields
   */
  _validateKeyOrderCompleteness(tableName, keyOrder) {
    const tableSchema = this.tables[tableName];
    if (!tableSchema) {
      return { isValid: true, missingRequiredFields: [] }; // No schema to validate against
    }

    const requiredFields = [];
    for (const [fieldName, fieldDef] of Object.entries(tableSchema)) {
      const hasDefault =
        this._getDefaultValue(tableName, fieldName) !== undefined;
      if (!hasDefault) {
        requiredFields.push(fieldName);
      }
    }

    const missingRequiredFields = requiredFields.filter(
      (field) => !keyOrder.includes(field)
    );
    const isValid = missingRequiredFields.length === 0;

    return { isValid, missingRequiredFields, requiredFields };
  }

  /**
   * Validates that all required keys are present in the data object.
   * @param {Object} data - The data object to validate.
   * @param {string[]} keyOrder - An array of required keys.
   * @param {string} [context] - Optional context for error messages.
   * @returns {Object} - An object containing validation status and missing keys.
   */
  _validateData(tableName, data, keyOrder, context = "") {
    // First validate that keyOrder is complete
    const keyOrderValidation = this._validateKeyOrderCompleteness(
      tableName,
      keyOrder
    );
    if (!keyOrderValidation.isValid) {
      throw new Error(
        `Incomplete keyOrder: Missing required fields [${keyOrderValidation.missingRequiredFields.join(
          ", "
        )}] ${context}. Required fields are: [${keyOrderValidation.requiredFields.join(
          ", "
        )}]`
      );
    }

    // Then validate that data contains all keys from keyOrder
    const missingKeys = keyOrder.filter((key) => {
      const isMissing = !(key in data);
      if (!isMissing) return false;
      const defaultValue = this._getDefaultValue(tableName, key);
      return defaultValue ? false : true; // only flag missing if no default
    });
    const isValid = missingKeys.length === 0;
    return { isValid, missingKeys, context };
  }

  _checkType(value, expectedType) {
    expectedType = expectedType.trim();
    switch (expectedType) {
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "date":
        // console.log("chequeo de tipo date", value instanceof Date)
        console.log(
          "chequeo de que getTime() es un numero",
          !isNaN(value.getTime())
        );
        console.log(
          "chequeo de que es tipo date por otro metodo",
          Object.prototype.toString.call(value) === "[object Date]"
        );
        return (
          Object.prototype.toString.call(value) === "[object Date]" &&
          !isNaN(value.getTime())
        );
      default:
        return false;
    }
  }

  /**
   * Normalize incoming schema field definitions to { type, default? }
   * @param {Object} fields
   * @returns {Object}
   */
  _normalizeSchemaFields(fields) {
    const normalized = {};
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypesList = VALID_TYPES.join(", ");
    for (const [fieldName, definition] of Object.entries(fields || {})) {
      if (typeof definition === "string") {
        const typeValue = definition.trim();
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        normalized[fieldName] = { type: typeValue };
      } else if (definition && typeof definition === "object") {
        const typeValue =
          typeof definition.type === "string" ? definition.type.trim() : "";
        if (!typeValue) {
          throw new Error(
            `Missing required 'type' for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        const norm = { type: typeValue };
        if (Object.prototype.hasOwnProperty.call(definition, "default")) {
          norm.default = definition.default;
        }
        // Optional behavior flags
        if (
          Object.prototype.hasOwnProperty.call(definition, "treatNullAsMissing")
        ) {
          if (typeof definition.treatNullAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatNullAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatNullAsMissing = definition.treatNullAsMissing;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            definition,
            "treatEmptyStringAsMissing"
          )
        ) {
          if (typeof definition.treatEmptyStringAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatEmptyStringAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatEmptyStringAsMissing = definition.treatEmptyStringAsMissing;
        }
        normalized[fieldName] = norm;
      } else {
        throw new Error(
          `Invalid schema definition for field "${fieldName}". Expected string or { type, default? }`
        );
      }
    }
    return normalized;
  }

  _getFieldDefinition(tableName, key) {
    const tableDef = this.tables?.[tableName];
    if (!tableDef) return null;
    const def = tableDef[key];
    if (def == null) return null;
    if (typeof def === "string") return { type: def.trim() };
    if (typeof def === "object") return def;
    return null;
  }

  _getExpectedType(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    return def?.type || null;
  }

  _getDefaultValue(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    if (!def || !Object.prototype.hasOwnProperty.call(def, "default")) {
      return undefined;
    }

    const defaultValue = def.default;

    // Handle special default values
    if (defaultValue === "now") {
      return new Date();
    }

    return defaultValue;
  }

  /**
   * Apply default values to missing fields (undefined only).
   * Does not override explicit null or empty string values.
   * @param {string} tableName
   * @param {Object} data
   * @param {string[]} keyOrder
   * @returns {{ data: Object, appliedDefaults: Array<{key: string, value: any}> }}
   */
  _applyDefaults(tableName, data, keyOrder) {
    const result = { ...data };
    const appliedDefaults = [];
    for (const key of keyOrder) {
      const currentValue = result[key];
      const fieldDef = this._getFieldDefinition(tableName, key) || {};
      const treatNullAsMissing = !!fieldDef.treatNullAsMissing;
      const treatEmptyStringAsMissing = !!fieldDef.treatEmptyStringAsMissing;

      const isConsideredMissing =
        currentValue === undefined ||
        (currentValue === null && treatNullAsMissing) ||
        (currentValue === "" && treatEmptyStringAsMissing);

      if (isConsideredMissing) {
        const defVal = this._getDefaultValue(tableName, key);
        if (defVal !== undefined) {
          // Coalesce null defaults to empty string to preserve prior blank behavior
          result[key] = defVal === null ? "" : defVal;
          appliedDefaults.push({ key, value: defVal });
        }
      }
    }
    return { data: result, appliedDefaults };
  }

  /**
   * Validates type checking with detailed logging
   * @private
   * @param {*} value - Value to check
   * @param {string} expectedType - Expected type of the value
   * @returns {boolean} Whether the value matches the expected type
   */
  _checkTypeWithLogs(value, expectedType) {
    console.log("\n[TYPE CHECK] Starting type check:", {
      value,
      expectedType,
      actualType: typeof value,
      isNull: value === null,
      isUndefined: value === undefined,
    });

    switch (expectedType) {
      case "number":
        const isNumber = typeof value === "number" && !isNaN(value);
        console.log("[NUMBER CHECK]", {
          value,
          isTypeNumber: typeof value === "number",
          isNotNaN: !isNaN(value),
          finalResult: isNumber,
        });
        return isNumber;

      case "string":
        const isString = typeof value === "string";
        console.log("[STRING CHECK]", {
          value,
          isTypeString: isString,
          valueLength: value?.length,
        });
        return isString;

      case "boolean":
        const isBoolean = typeof value === "boolean";
        console.log("[BOOLEAN CHECK]", {
          value,
          isTypeBoolean: isBoolean,
          isTruthy: !!value,
        });
        return isBoolean;

      case "date":
        try {
          console.log("[DATE CHECK] Initial value:", {
            value,
            isDate: value instanceof Date,
            prototype: Object.prototype.toString.call(value),
          });

          // Check if it's a Date object
          const isDateObject =
            Object.prototype.toString.call(value) === "[object Date]";
          console.log("[DATE CHECK] Is Date object:", isDateObject);

          // Try to get timestamp (will throw if not a valid date)
          let hasValidTimestamp = false;
          try {
            hasValidTimestamp = !isNaN(value.getTime());
            console.log("[DATE CHECK] Timestamp check:", {
              timestamp: value.getTime(),
              isValid: hasValidTimestamp,
            });
          } catch (e) {
            console.error("[DATE CHECK] Failed to get timestamp:", e.message);
          }

          const isValidDate = isDateObject && hasValidTimestamp;
          console.log("[DATE CHECK] Final result:", {
            isDateObject,
            hasValidTimestamp,
            isValid: isValidDate,
          });

          return isValidDate;
        } catch (err) {
          console.error("[DATE CHECK] Error during date validation:", {
            error: err.message,
            stack: err.stack,
          });
          return false;
        }

      default:
        console.warn("[TYPE CHECK] Unknown type:", expectedType);
        return false;
    }
  }

  _checkValidCreationTypes(tableFields) {
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypes = VALID_TYPES.join(", ");
    if (tableFields) {
      for (const [field, type] of Object.entries(tableFields)) {
        if (!VALID_TYPES.includes(type)) {
          throw new Error(
            `Invalid type "${type}" for field "${field}". Valid types are: ${validTypes}`
          );
        }
      }
    }
  }

  _getFieldIndex(tableName, fieldName) {
    const table = this._getSheet(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' not found`);
    }

    const headers = this._getHeaders(table);
    const fieldIndex = headers.findIndex(
      (header) => header.toLowerCase() === fieldName.toLowerCase()
    );

    return fieldIndex;
  }

  applyColorScheme(tableName, colorScheme) {
    try {
      const sheet = this.spreadsheet.getSheetByName(tableName);
      const lastRow = sheet.getLastRow() === 1 ? 10 : sheet.getLastRow();

      const lastCol = sheet.getLastColumn();

      // Define multiple color schemes
      const colorSchemes = {
        red: {
          headerColor: "#E53935", // Red header
          color1: "#FFCDD2", // Light Red for alternating rows
          color2: "#FFEBEE", // Lighter Red
        },
        blue: {
          headerColor: "#1E88E5", // Blue header
          color1: "#BBDEFB", // Light Blue for alternating rows
          color2: "#E3F2FD", // Lighter Blue
        },
        green: {
          headerColor: "#43A047", // Green header
          color1: "#C8E6C9", // Light Green for alternating rows
          color2: "#E8F5E9", // Lighter Green
        },
        orange: {
          headerColor: "#FB8C00", // Orange header
          color1: "#FFE0B2", // Light Orange for alternating rows
          color2: "#FFF3E0", // Lighter Orange
        },
        purple: {
          headerColor: "#8E24AA", // Purple header
          color1: "#E1BEE7", // Light Purple for alternating rows
          color2: "#F3E5F5", // Lighter Purple
        },
      };

      // Get the chosen color scheme based on the input
      const scheme = colorSchemes[colorScheme];

      if (!scheme) {
        throw new Error(
          "Color scheme not found. Available schemes: red, blue, green, orange, purple."
        );
      }

      // Apply color to the header row
      const headerRange = sheet.getRange(1, 1, 1, lastCol);
      headerRange.setBackground(scheme.headerColor).setFontColor("#FFFFFF");

      const sampleFromApplyColorScheme = {
        headerColor: scheme.headerColor,
        color1: scheme.color1,
        color2: scheme.color2,
      };

      // Apply alternating colors to the data rows
      for (let row = 2; row <= lastRow; row++) {
        const range = sheet.getRange(row, 1, 1, lastCol);
        if (row % 2 === 0) {
          range.setBackground(scheme.color2); // Even rows
        } else {
          range.setBackground(scheme.color1); // Odd rows
        }
      }

      console.log("sampleFromApplyColorScheme", sampleFromApplyColorScheme);
      return {
        status: 200,
        message: `Color scheme applied to table ${tableName}`,
        data: sampleFromApplyColorScheme,
      };
    } catch (error) {
      console.error("[APPLY COLOR SCHEME] Error:", error);
      return {
        status: 500,
        message: `Error applying color scheme to table ${tableName}, ${error}`,
        data: {},
      };
    }
  }
}

/**
 * Creates and returns a new instance of the CRUD class
 * @returns {DB} A new instance of the CRUD class
 * @param dbName - Name of the Database
 * @param dbId - id of the sheet if already created
 */
function init(dbName, dbId = "") {
  return new DB(dbName, dbId);
}

function example() {
  const db = new DB(
    "myTestDataBase",
    (dbId = "1auvs768mjQQS9dTJuutCOpYKvWTSUjtPmzzZCSZBM1M")
  );

  console.log(db.getCreationResult());

  const employeeTableConfig = {
    tableName: "EMPLOYEES",
    fields: {
      name: "string",
      age: "number",
      position: "string",
      employed: "boolean",
      hire_date: "date",
    },
  };

  db.createTable(employeeTableConfig);

  console.log("employee table created");

  const employees = [
    {
      name: "John Doe",
      age: 30,
      position: "Software Engineer",
      employed: true,
      hire_date: new Date("2022-01-15"),
    },
    {
      name: "Jane Smith",
      age: 28,
      position: "Product Manager",
      employed: true,
      hire_date: new Date("2021-11-05"),
    },
    {
      name: "Mike Johnson",
      age: 35,
      position: "Data Scientist",
      employed: true,
      hire_date: new Date("2020-08-20"),
    },
    {
      name: "Emily Davis",
      age: 24,
      position: "UX Designer",
      employed: false,
      hire_date: new Date("2019-02-01"),
    },
    {
      name: "Chris Lee",
      age: 40,
      position: "Operations Manager",
      employed: true,
      hire_date: new Date("2020-12-10"),
    },
    {
      name: "Sarah Wilson",
      age: 33,
      position: "HR Specialist",
      employed: true,
      hire_date: new Date("2018-06-18"),
    },
    {
      name: "Alex Martin",
      age: 29,
      position: "Business Analyst",
      employed: false,
      hire_date: new Date("2021-04-25"),
    },
    {
      name: "Linda Clark",
      age: 42,
      position: "Accountant",
      employed: true,
      hire_date: new Date("2021-09-30"),
    },
    {
      name: "James Walker",
      age: 27,
      position: "DevOps Engineer",
      employed: true,
      hire_date: new Date("2017-07-19"),
    },
    {
      name: "Jessica Brown",
      age: 26,
      position: "Marketing Manager",
      employed: false,
      hire_date: new Date("2022-03-22"),
    },
    {
      name: "Robert Harris",
      age: 37,
      position: "Network Engineer",
      employed: true,
      hire_date: new Date("2021-01-11"),
    },
    {
      name: "Sophia Lewis",
      age: 31,
      position: "Backend Developer",
      employed: true,
      hire_date: new Date("2020-05-15"),
    },
    {
      name: "Lucas Moore",
      age: 34,
      position: "Frontend Developer",
      employed: false,
      hire_date: new Date("2022-02-17"),
    },
    {
      name: "Olivia Taylor",
      age: 25,
      position: "QA Engineer",
      employed: true,
      hire_date: new Date("2020-10-27"),
    },
    {
      name: "Daniel Anderson",
      age: 38,
      position: "System Administrator",
      employed: true,
      hire_date: new Date("2019-11-09"),
    },
  ];
  // let results = []
  // for (e of employees) {
  //   results.push(db.create('EMPLOYEES', e, ['name', 'age', 'position', 'employed', 'hire_date']));
  // }
  db.create(
    "EMPLOYEES",
    {
      name: "hola",
      age: 25,
      position: "QA Engineer",
      employed: "true",
      hire_date: new Date("2020-10-27"),
    },
    ["name", "age", "position", "employed", "hire_date"]
  );
  // console.log('Create Result: ', results);

  // Read an employee by ID
  // const readResult = db.read('EMPLOYEES', createResult.id);
  // console.log('Read Result:', readResult.data);

  // Update the employee record
  // const updatedEmployee = {
  //   name: 'John Doe',
  //   age: 31, // Updated age
  //   position: 'Senior Software Engineer', // Updated position
  // };
  // const updateResult = db.update('EMPLOYEES', createResult.id, updatedEmployee, ['name', 'age', 'position']);
  // console.log('Update Result:', updateResult);

  // Delete the employee record
  // const deleteResult = db.remove('EMPLOYEES', 'DELETED_EMPLOYEES', createResult.id);
  // console.log('Delete Result:', deleteResult);
  // Get All with pagination and sorting
  const getAllResult = db.getAll(
    "EMPLOYEES",
    { page: 1, pageSize: 25, sortBy: "hire_date", sortOrder: "desc" },
    (useCache = false)
  );
  console.log(getAllResult);

  // getAllResult.data.map((row) => {
  //    console.log(row)
  //    for (const [key, val] of Object.entries(row)) {
  //       console.log(`type of ${key}: `, typeof(val))
  //       if (key === "DATE"){
  //         console.log("fecha es un tipo Date",val instanceof Date);
  //         console.log("getime en la fecha:", val.getTime());
  //       }
  //     }
  // })

  console.log(
    db.createManyToManyTableConfig({
      tableName: "TOOL_GROUP_RELATION",
      historyTableName: "DELETED_TOOL_GROUP_RELATION",
      entity1TableName: "TOOL",
      entity2TableName: "MINOR_TOOL_GROUP_MIGRATION",
    })
  );
}
/**
 * db class for Google Apps Script
 * Provides methods for Create, Read, Update, and Delete operations on Google Sheets
 */

class DB {
  /**
   * @param {string} dbName - The name of the Google Spreadsheet to create and operate on.
   * @param {string} dbId - The id of the Google Spreadsheet if already created.
   */
  constructor(dbName, dbId = null) {
    try {
      let ssId;
      if (!dbId) {
        let ss = SpreadsheetApp.create(dbName);
        ssId = ss.getId();
      } else {
        ssId = dbId;
      }
      this.spreadsheet = SpreadsheetApp.openById(ssId);
      this.cache = CacheService.getScriptCache();
      this.tables = {};
      this.creationResult = {
        status: 200,
        message: "database initialized successfully",
      };
      //script lock
      this.lockService = LockService.getScriptLock();
      //userlock
      this.userLockService = LockService.getUserLock();
      this.lockTimeout = 100;
      this.readLockTimeout = 30000;
    } catch (err) {
      console.error(
        `Something went wrong initializing the DB: ${err.message}`,
        err.stack
      );
      this.creationResult = {
        status: 500,
        error: err.message,
      };
    }
  }

  _acquireLock(tableName, recordId, lockType) {
    try {
      // create the lock key
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      console.log(
        `[LOCK] Attempting to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
      );

      let lock = false;

      if (lockType === "write") {
        lock = this.lockService.tryLock(this.lockTimeout);
      } else if (lockType === "read") {
        lock = this.lockService.tryLock(this.readLockTimeout);
      }

      if (lock) {
        console.log(
          `[LOCK] Acquired ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return true;
      } else {
        console.warn(
          `[LOCK] Failed to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return false;
      }
    } catch (err) {
      console.error(`[LOCK] Error acquiring lock: ${err.stack}`);
      return false;
    }
  }

  _releaseLock(tableName, recordId, lockType) {
    try {
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      Utilities.sleep(400);
      this.lockService.releaseLock();
      console.log(
        `[LOCK] Released ${lockType} lock for record ${recordId} in table ${tableName}`
      );
    } catch (err) {
      console.error(`[LOCK] Error releasing lock: ${err.stack}`);
    }
  }

  releaseLocks() {
    try {
      this.lockService.releaseLock();
      console.log("[LOCK] Released all locks");
    } catch (err) {
      console.error(`[LOCK] Error in releaseLocks: ${err.stack}`);
    }
  }

  /**
   * Sanitizes cell values to prevent CSV injection attacks (CVE-2023-XXXXX)
   * Prevents formula injection by escaping dangerous characters
   * @param {*} value - The value to sanitize
   * @returns {*} Sanitized value safe for spreadsheet insertion
   * @private
   */
  _sanitizeForCSV(value) {
    // Only sanitize string values
    if (typeof value !== "string") {
      return value;
    }

    // Empty strings are safe
    if (value.length === 0) {
      return value;
    }

    // Check if the string starts with dangerous characters
    // These can trigger formula execution in spreadsheet applications:
    // = (formula), + (formula), - (formula), @ (formula),
    // \t (tab), \r (carriage return)
    const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
    const firstChar = value.charAt(0);

    if (dangerousChars.includes(firstChar)) {
      // Prepend with double quote to prevent formula execution
      // This makes the cell text-only in Google Sheets/Excel
      return "''" + value;
    }

    // Also check for pipe character followed by potentially dangerous patterns
    // This prevents DDE attacks: =cmd|'/c calc'!A1
    if (
      value.includes("|") &&
      (value.includes("cmd") || value.includes("powershell"))
    ) {
      return "''" + value;
    }

    return value;
  }

  /**
   * Sanitizes an entire row of values before writing to sheet
   * @param {Array} row - Array of values to sanitize
   * @returns {Array} Sanitized row
   * @private
   */
  _sanitizeRow(row) {
    return row.map((value) => this._sanitizeForCSV(value));
  }

  getCreationResult() {
    return this.creationResult;
  }

  /**
   * Creates a new table in the spreadsheet with an optional history table.
   * @param {Object} config - Configuration for creating the table.
   * @param {string} config.tableName - Name of the main table.
   * @param {string} [config.historyTableName] - Name of the history table.
   * @param {Object<columnName, type>} config.fields - Fields of the table.
   */
  createTable(config) {
    try {
      const { tableName, historyTableName, fields } = config;

      let mainTable = this.spreadsheet.getSheetByName(tableName);
      if (!mainTable) {
        mainTable = this.spreadsheet.insertSheet(tableName);
      }
      let historyTable;
      if (historyTableName) {
        historyTable = this.spreadsheet.getSheetByName(historyTableName);
        if (!historyTable) {
          historyTable = this.spreadsheet.insertSheet(historyTableName);
        }
      } else {
        historyTable = this.spreadsheet.getSheetByName(`DELETED_${tableName}`);
        if (!historyTable)
          historyTable = this.spreadsheet.insertSheet(`DELETED_${tableName}`);
      }

      const headers = [
        "ID",
        "DATE",
        ...Object.keys(fields).map((field) => field.toUpperCase()),
      ];

      // Sanitize headers to prevent CSV injection
      const sanitizedHeaders = this._sanitizeRow(headers);
      mainTable
        .getRange(1, 1, 1, sanitizedHeaders.length)
        .setValues([sanitizedHeaders]);
      historyTable
        .getRange(1, 1, 1, sanitizedHeaders.length)
        .setValues([sanitizedHeaders]);

      this.tables[tableName] = this._normalizeSchemaFields(fields);
      return {
        status: 200,
        message: "table created successfully",
      };
    } catch (err) {
      console.error(`Error when trying to init the database: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Creates configuration for a many-to-many junction table
   * @param {Object} config Configuration object
   * @param {string} config.tableName Name of the junction table
   * @param {string} config.historyTableName Name of the history table
   * @param {string} config.entity1TableName Name of the first entity table
   * @param {string} config.entity2TableName Name of the second entity table
   * @param {Object} [config.fieldsRelatedToBothEntities] Additional fields that describe the relationship
   * @returns {Object} Table configuration object
   */
  createManyToManyTableConfig(config) {
    try {
      const {
        entity1TableName,
        entity2TableName,
        fieldsRelatedToBothEntities,
      } = config;

      if (!entity1TableName || !entity2TableName) {
        throw new Error(
          "Required fields missing: tableName, entity1TableName, and entity2TableName are required"
        );
      }

      //check if the 2 entities are in schema context
      if (!this.tables[entity1TableName] || !this.tables[entity2TableName]) {
        throw new Error(
          `Tables must be in schema context before creating relation. ` +
            `${entity1TableName} exists: ${!!this.tables[entity1TableName]}, ` +
            `${entity2TableName} exists: ${!!this.tables[entity2TableName]}`
        );
      }

      //check if the parent tables actually exist as sheets
      const entity1Sheet = this._getSheet(entity1TableName);
      const entity2Sheet = this._getSheet(entity2TableName);
      if (!entity1Sheet || !entity2Sheet) {
        throw new Error(
          `Parent tables must exist as sheets before creating junction table. ` +
            `${entity1TableName} sheet exists: ${!!entity1Sheet}, ` +
            `${entity2TableName} sheet exists: ${!!entity2Sheet}`
        );
      }

      this._checkValidCreationTypes(fieldsRelatedToBothEntities);

      return {
        status: 200,
        data: {
          tableName: `${entity1TableName}_${entity2TableName}_RELATION`,
          historyTableName: `DELETED_${entity1TableName}_${entity2TableName}_RELATION`,
          fields: {
            created_at: "date",
            [`${entity1TableName.toLocaleLowerCase()}_id`]: "number",
            [`${entity2TableName.toLocaleLowerCase()}_id`]: "number",
            ...fieldsRelatedToBothEntities,
          },
        },
        message: `config object for Junction table ${entity1TableName}_${entity2TableName}_RELATION, dont forget to put the tableConfig into schema context`,
      };
    } catch (err) {
      console.error(`Error in createManyToManyTableConfig: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Adds a table to the database context
   * @param {Object} config - Table configuration object
   * @param {string} config.tableName - Name of the table
   * @param {Object} config.fields - Field definitions for the table
   * @returns {Object} Status of the operation
   */
  putTableIntoDbContext(config) {
    const { tableName, historyTableName, fields } = config;

    if (this.tables[tableName]) {
      console.error(
        `Error when trying to put table in context of the database: Already in context`
      );
      return {
        status: 500,
        error:
          "Error when trying to put table in context of the database: Already in context",
      };
    } else {
      this.tables[tableName] = this._normalizeSchemaFields(fields);
      return {
        status: 200,
        message: "Table added to the schema",
      };
    }
  }

  /**
   * Create a new record in the specified table or update an existing one based on addUpdatePolicy
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} data - Data to be inserted or updated
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @param {Object} [addUpdatePolicy] - Policy for updating existing records
   * @param {string} addUpdatePolicy.key - The key to search for existing records
   * @param {*} addUpdatePolicy.value - The value to match for the key
   * @returns {Object} Status and ID of the created or updated record
   */

  create(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      const sheet = this._getSheet(tableName);
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }
      // Apply defaults before validation and type checking
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during create:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      let typesChecked = false;
      if (this.tables[tableName]) {
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
      }

      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "data has matched on the additional update policy:  " +
            dataWithDefaults[addUpdatePolicy.key]
        );
        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          const searchResult = column
            .createTextFinder(addUpdatePolicy.value.toString())
            .matchEntireCell(true)
            .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
          }
        }
      }

      const now = new Date();

      if (existingRowIndex > -1) {
        //acquiring lock!!
        if (!this._acquireLock(tableName, id, "write")) {
          throw new Error("Could not acquire lock for update operation");
        }
        try {
          const updateResult = this.update(
            tableName,
            id,
            dataWithDefaults,
            keyOrder,
            typesChecked
          );
          updateResult.action = "updated";
          return updateResult;
        } finally {
          this._releaseLock(tableName, id, "write");
        }
      } else {
        const id = this._getNextId(sheet);
        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
            return value;
          }),
        ];
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(row);
        sheet.appendRow(sanitizedRow);

        this._clearCache(tableName);
        return {
          status: 200,
          id: id,
          action: "created",
        };
      }
    } catch (err) {
      console.error(`Error in create: ${err.message}`);
      return {
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
        error: err.message,
      };
    }
  }

  /**
   * Creates a record in a junction table for many-to-many relationships
   * @param {string} junctionTableName - Name of the junction table
   * @param {Object} data - Data containing the foreign keys and additional fields
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @returns {Object} Status and ID of the created junction record
   */
  createJunctionRecord(junctionTableName, data, keyOrder) {
    try {
      // Validate required parameters
      if (!data || Object.keys(data).length === 0) {
        throw new Error("Data parameter is required for createJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found`);
      }

      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          `Junction table must have exactly two foreign key fields, got ${
            Object.keys(data).filter((key) => key.includes("_id")).length
          } for table ${junctionTableName} , keys received: ${Object.keys(
            data
          ).join(", ")}`
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));
      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();
      const existingRecords = [];
      entityFkIndices.forEach((colIndex) =>
        existingRecords.push(
          table.getRange(2, colIndex + 1, lastRow - 1).getValues()
        )
      );

      // console.log("existing records:", existingRecords)
      // console.log("existing records length:", existingRecords[0].length)
      // console.log("fks length:", fksIds.length)
      // console.log("existing records first element:", existingRecords[0][0][0])
      let isDuplicate = false;

      for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
        let isMatch = true;
        for (let j = 0; j < existingRecords.length && isMatch; j++) {
          if (existingRecords[j][i][0] !== fksIds[j]) {
            isMatch = false;
          }
        }
        if (isMatch) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(", ")}`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.create(junctionTableName, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error in createJunctionRecord:", err.stack);
      const isValidationError =
        err.message.includes("Data parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder");
      return {
        status: isValidationError ? 400 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Gets records from a junction table along with related data
   * @param {string} junctionTableName - Name of the junction table
   * @param {string} sourceTableName - Name of the source table
   * @param {string} targetTableName - Name of the target table
   * @param {number} sourceId - ID from the source table
   * @param {Object} options - Options for pagination and sorting
   * @returns {Object} Status and array of related records with their relationships
   */
  getJunctionRecords(
    junctionTableName,
    sourceTableName,
    targetTableName,
    sourceId,
    options
  ) {
    try {
      console.log("[JUNCTION] Starting junction record retrieval:", {
        junctionTable: junctionTableName,
        sourceTable: sourceTableName,
        targetTable: targetTableName,
        sourceId,
        options,
      });
      const foreignKeyField = `${sourceTableName.toLowerCase()}_id`;
      const targetKeyField = `${targetTableName.toLowerCase()}_id`;
      const fieldIndex = this._getFieldIndex(
        junctionTableName,
        foreignKeyField
      );

      if (fieldIndex === -1) {
        throw new Error(
          `Foreign key field '${foreignKeyField}' not found in junction table`
        );
      }

      const junctionResult = this.getRelatedRecords(
        sourceId,
        junctionTableName,
        foreignKeyField,
        fieldIndex,
        options
      );

      if (junctionResult.status !== 200) {
        return junctionResult;
      }

      if (junctionResult.data.length === 0) {
        return {
          status: 200,
          data: [],
          message: `No relations found for ${sourceTableName} ID ${sourceId}`,
        };
      }

      const targetsIds = [];

      for (let i = 0; i < junctionResult.data.length; i++) {
        targetsIds.push(junctionResult.data[i][targetKeyField]);
      }
      console.log("[JUNCTION] Found target IDs:", targetsIds);

      const targetRecords = this.readIdList(targetTableName, targetsIds);

      if (targetRecords.status !== 200) {
        return targetRecords;
      }

      const combinedData = [];

      const targetMap = new Map(
        targetRecords.data.map((record) => [record.id, record])
      );

      for (let i = 0; i < junctionResult.data.length; i++) {
        const targetRecord = targetMap.get(
          junctionResult.data[i][targetKeyField]
        );
        if (targetRecord) {
          combinedData.push({
            ...targetRecord,
            relationship: junctionResult.data[i],
          });
        }
      }

      return {
        status: 200,
        data: combinedData,
        message: `Retrieved ${combinedData.length} related records from ${targetTableName}`,
        metadata: {
          totalJunctionRecords: junctionResult.data.length,
          totalTargetRecords: targetRecords.data.length,
          missingTargets: targetsIds.length - combinedData.length,
        },
      };
    } catch (err) {
      console.error(`Error in getJunctionRecords: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  createWithLogs(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      console.log("\n[CREATE] Starting create operation:", {
        tableName,
        data,
        keyOrder,
        addUpdatePolicy,
      });

      // Get sheet and validate existence
      const sheet = this._getSheet(tableName);
      console.log("[SHEET] Retrieved sheet:", sheet ? sheet.getName() : "null");
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }

      // Apply defaults then validate
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during createWithLogs:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      console.log("[VALIDATION] Starting data validation");
      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      console.log("[VALIDATION] Result:", validation);
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      // Type checking
      let typesChecked = false;
      if (this.tables[tableName]) {
        console.log(
          "[TYPES] Starting type validation for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("[TYPES] Checking field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
        console.log("[TYPES] All type checks passed");
      } else {
        console.log(
          "[TYPES] No type definitions found for table, skipping type checks"
        );
      }

      // Check for existing record
      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "[UPDATE POLICY] Checking for existing record with policy:",
          {
            key: addUpdatePolicy.key,
            value: addUpdatePolicy.value,
            matchValue: dataWithDefaults[addUpdatePolicy.key],
          }
        );

        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        console.log("[UPDATE POLICY] Calculated column index:", columnIndex);

        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          console.log("[UPDATE POLICY] Searching in range:", {
            startRow: 2,
            column: columnIndex,
            numRows: sheet.getLastRow() - 1,
          });

          const searchResult = column
            .createTextFinder(addUpdatePolicy.value.toString())
            .matchEntireCell(true)
            .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
            console.log("[UPDATE POLICY] Found existing record:", {
              row: existingRowIndex,
              id: id,
            });
          } else {
            console.log("[UPDATE POLICY] No existing record found");
          }
        }
      }

      const now = new Date();
      console.log("[TIMESTAMP] Using timestamp:", now);

      if (existingRowIndex > -1) {
        // Update existing Record
        console.log("[UPDATE] Updating existing record:", {
          tableName,
          id,
          existingRowIndex,
        });

        const updateResult = this.update(
          tableName,
          id,
          dataWithDefaults,
          keyOrder,
          typesChecked
        );
        updateResult.action = "updated";
        console.log("[UPDATE] Update complete:", updateResult);
        return updateResult;
      } else {
        // Create new record
        console.log("[CREATE] Creating new record");
        const id = this._getNextId(sheet);
        console.log("[CREATE] Generated new ID:", id);

        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            console.log("[CREATE] Processing field:", {
              key,
              value,
              type: typeof value,
              isUndefined: value === undefined,
              isBoolean: this._getExpectedType(tableName, key) === "boolean",
            });

            if (value === undefined) return "";
            if (this._getExpectedType(tableName, key) === "boolean")
              return value.toString();
            return value;
          }),
        ];

        console.log("[CREATE] Final row data to append:", row);
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(row);
        sheet.appendRow(sanitizedRow);

        const dataView = sheet
          .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
          .getValues()
          .slice(10);
        console.log("[CREATE CHECK] Final sheet data ", dataView);

        console.log("[CACHE] Clearing cache for table:", tableName);
        this._clearCache(tableName);

        const result = {
          status: 200,
          id: id,
          action: "created",
        };
        console.log("[CREATE] Operation complete:", result);
        return result;
      }
    } catch (err) {
      console.error("[ERROR] Error in create operation:", {
        error: err.message,
        stack: err.stack,
        tableName,
        data,
      });
      return {
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
        error: err.message,
      };
    }
  }
  /**
   * Update a record in the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to update
   * @param {Object} data - New data for the record
   * @param {string[]} keyOrder - Order of keys to be updated
   * @param typesChecked - Flag indicating if the types of the data are already checked
   * @param addUpdatePolicy
   * @returns {Object} Status and updated data
   */
  update(
    tableName,
    id,
    data,
    keyOrder,
    typesChecked = false,
    addUpdatePolicy = null
  ) {
    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table ${tableName} not found`);

        let rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        // Apply defaults before validation
        const defaultsApplication = this._applyDefaults(
          tableName,
          data,
          keyOrder
        );
        const dataWithDefaults = defaultsApplication.data;
        if (defaultsApplication.appliedDefaults.length > 0) {
          console.warn("[DEFAULTS] Applied during update:", {
            tableName,
            id,
            applied: defaultsApplication.appliedDefaults,
          });
        }

        const validation = this._validateData(
          tableName,
          dataWithDefaults,
          keyOrder,
          `in table "${tableName}"`
        );
        if (!validation.isValid) {
          throw new Error(
            `Missing required fields: ${validation.missingKeys.join(
              ", "
            )} in table "${tableName}"`
          );
        }

        if (!typesChecked) {
          if (this.tables[tableName]) {
            for (const [key, val] of Object.entries(dataWithDefaults)) {
              const expectedType = this._getExpectedType(tableName, key);
              if (expectedType && !this._checkType(val, expectedType)) {
                throw new Error(
                  `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
                );
              }
            }
          }
        }

        if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
          console.log(
            "data has matched on the additional update policy:  " +
              dataWithDefaults[addUpdatePolicy.key]
          );
          const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
          if (columnIndex > 2) {
            const column = sheet.getRange(
              2,
              columnIndex,
              sheet.getLastRow() - 1
            );
            const searchResult = column
              .createTextFinder(addUpdatePolicy.value.toString())
              .matchEntireCell(true)
              .findNext();

            if (searchResult) {
              rowIndex = searchResult.getRow();
              id = sheet.getRange(rowIndex, 1).getValue();
            }
          }
        }

        const now = new Date();
        const updatedRow = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
            return value;
          }),
        ];
        // Sanitize row to prevent CSV injection
        const sanitizedRow = this._sanitizeRow(updatedRow);
        sheet
          .getRange(rowIndex, 1, 1, sanitizedRow.length)
          .setValues([sanitizedRow]);

        this._clearCache(tableName);
        console.log(updatedRow);
        return {
          status: 200,
          id: id,
          data: { id: id, date: now, ...dataWithDefaults }, // includes defaults used
          action: "updated",
        };
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in update: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
        error: err.message,
      };
    }
  }

  updateWithLogs(
    tableName,
    id,
    data,
    keyOrder,
    typesChecked = false,
    addUpdatePolicy = null
  ) {
    try {
      console.log("Update Method Input:", {
        tableName,
        id,
        data,
        keyOrder,
        typesChecked,
        addUpdatePolicy,
      });

      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      let rowIndex = this._findRowById(sheet, id);
      console.log("Found row index:", rowIndex);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      // Apply defaults and validate
      const defaultsApplicationUW = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaultsUW = defaultsApplicationUW.data;
      if (defaultsApplicationUW.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during updateWithLogs:", {
          tableName,
          id,
          applied: defaultsApplicationUW.appliedDefaults,
        });
      }
      const validation = this._validateData(
        tableName,
        dataWithDefaultsUW,
        keyOrder,
        `in table "${tableName}"`
      );
      console.log("Validation result:", validation);

      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} in table "${tableName}"`
        );
      }

      // Type checking
      if (!typesChecked && this.tables[tableName]) {
        console.log(
          "Performing type checks for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaultsUW)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("Checking type for field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkTypeWithLogs(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
            );
          }
        }
      }

      // Build updated row data
      const now = new Date();
      const updatedRow = [id, now];

      console.log("Building row data with keyOrder:", keyOrder);

      keyOrder.forEach((key) => {
        const value = dataWithDefaultsUW[key];
        console.log("Processing field:", {
          key,
          value,
          type: typeof value,
          fieldType: this._getExpectedType(tableName, key),
        });

        if (value === undefined) {
          updatedRow.push("");
        } else if (this._getExpectedType(tableName, key) === "boolean") {
          updatedRow.push(Boolean(value).toString());
        } else if (value === null) {
          updatedRow.push("");
        } else {
          updatedRow.push(value);
        }
      });

      console.log("Final row data to write:", updatedRow);

      // Update the sheet
      // Sanitize row to prevent CSV injection
      const sanitizedRow = this._sanitizeRow(updatedRow);
      const range = sheet.getRange(rowIndex, 1, 1, sanitizedRow.length);
      console.log("Updating range:", {
        row: rowIndex,
        columns: sanitizedRow.length,
        values: sanitizedRow,
      });

      range.setValues([sanitizedRow]);

      this._clearCache(tableName);

      return {
        status: 200,
        id: id,
        data: dataWithDefaultsUW,
        action: "updated",
      };
    } catch (err) {
      console.error("Update error details:", {
        error: err.message,
        stack: err.stack,
      });
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
        error: err.message,
      };
    }
  }
  /**
   * Read a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to read
   * @returns {Object} Status and data of the read record
   */
  read(tableName, id) {
    try {
      if (!this._acquireLock(tableName, id, "read")) {
        throw new Error("Could not acquire read lock");
      }

      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table "${tableName}" not found`);

        const rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        const row = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];

        let headers_caps = this._getHeaders(sheet);

        const headers = [];
        headers_caps.forEach((s) => headers.push(s.toLowerCase()));

        const record = headers.reduce((acc, header, index) => {
          acc[header] = row[index];
          return acc;
        }, {});

        return {
          status: 200,
          data: record,
        };
      } finally {
        this._releaseLock(tableName, id, "read");
      }
    } catch (err) {
      console.error(`Error in read: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Reads a list of records by their IDs
   * @param {string} tableName - Name of the table to read from
   * @param {number[]} ids - Array of record IDs to retrieve
   * @returns {Object} Status and array of found records, with list of any IDs not found
   */
  readIdList(tableName, ids) {
    try {
      console.log("[READ LIST] Starting batch read operation:", {
        tableName,
        numberOfIds: ids.length,
        ids,
      });

      const MAX_IDS = 1000;
      if (ids.length > MAX_IDS) {
        return {
          status: 400,
          error: {
            message: `Cannot request more than ${MAX_IDS} records at once, try getAll()`,
          },
        };
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: 400,
          error: {
            message: "IDs must be a non-empty array",
          },
        };
      }
      if (!ids.every((id) => typeof id === "number")) {
        return {
          status: 400,
          error: {
            message: "All IDs must be numbers",
          },
        };
      }

      const table = this._getSheet(tableName);
      if (!table) throw new Error(`Table "${tableName}" not found`);

      const headers = this._getHeaders(table);
      console.log("[READ LIST] Retrieved headers:", headers);

      const idsSet = new Set(ids);
      const idsFound = new Map(ids.map((id) => [id, false]));
      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();

      const records = [];

      for (let i = 0; i < data.length; i++) {
        if (idsSet.has(data[i][0])) {
          const record = headers.reduce((acc, header, index) => {
            acc[header.toLowerCase()] = data[i][index];
            return acc;
          }, {});
          records.push(record);
          idsFound.set(data[i][0], true);
        }
      }

      const notFoundIds = Array.from(idsFound.entries())
        .filter(([_, found]) => !found)
        .map(([id, _]) => id);

      console.log("[READ LIST] Retrieved records:", {
        found: records.length,
        notFound: notFoundIds,
      });

      return {
        status: 200,
        data: records,
        notFound: notFoundIds,
        message:
          notFoundIds.size > 0
            ? `Retrieved ${
                records.length
              } records. IDs not found: ${notFoundIds.join(", ")}`
            : `Retrieved ${records.length} records successfully`,
      };
    } catch (err) {
      console.error("[READ LIST] Error: ", err.stack);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Delete a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {string} historyTableName - Name of the history sheet/table
   * @param {number} id - ID of the record to delete
   * @returns {Object} Status of the operation
   */
  remove(tableName, historyTableName, id) {
    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        const sheet = this._getSheet(tableName);
        const historySheet = this._getSheet(historyTableName);
        if (!sheet) throw new Error(`Table "${tableName}" not found`);
        if (!historySheet)
          throw new Error(`History Table "${tableName}" not found`);

        const rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        const deletedRow = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];
        sheet.deleteRow(rowIndex);

        const historyId = this._getNextId(historySheet);
        // Sanitize row to prevent CSV injection
        const historyRow = this._sanitizeRow([
          historyId,
          new Date(),
          ...deletedRow.slice(2),
        ]);
        historySheet.appendRow(historyRow);

        this._clearCache(tableName);
        this._clearCache(historyTableName);

        return {
          status: 200,
          message: "Record removed succesfully",
        };
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in remove: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Removes a record and its related junction records
   * @param {string} tableName - Name of the table
   * @param {string} historyTableName - Name of the history table
   * @param {number} id - ID of the record to remove
   * @returns {Object} Status of the cascade delete operation
   */
  removeWithCascade(tableName, historyTableName, id) {
    try {
      const sheet = this._getSheet(tableName);
      const historySheet = this._getSheet(historyTableName);
      if (!tableName) throw new Error(`Table name is required`); //see if this breaks the test suite
      if (!historyTableName) throw new Error(`History table name is required`); //see if this breaks the test suite
      if (!id) throw new Error(`ID is required`); //see if this breaks the test suite
      if (!sheet) throw new Error(`Table "${tableName}" not found`);
      if (!historySheet)
        throw new Error(`History Table "${historyTableName}" not found`);

      const rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      this._handleCascadeDelete(tableName, id); // aca no se si esto debe ser un response o un try catch

      const deletedRow = sheet
        .getRange(rowIndex, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      sheet.deleteRow(rowIndex);

      const historyId = this._getNextId(historySheet);
      // Sanitize row to prevent CSV injection
      const historyRow = this._sanitizeRow([
        historyId,
        new Date(),
        ...deletedRow.slice(2),
      ]);
      historySheet.appendRow(historyRow);

      this._clearCache(tableName);
      this._clearCache(historyTableName);

      return {
        status: 200,
        message: "Record removed succesfully",
      };
    } catch (err) {
      console.error(`Error in remove: ${err.stack}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Validates the integrity of a junction table
   * @param {string} junctionTableName - Name of the junction table to check
   * @param {string} junctionHistoryTableName - Name of the history table
   * @returns {Object} Status and count of invalid records removed
   */
  checkTableIntegrity(junctionTableName, junctionHistoryTableName) {
    try {
      const table = this._getSheet(junctionTableName);
      const historyTable = this._getSheet(junctionHistoryTableName);

      if (!table || !historyTable) {
        console.error("[SHEETS] Sheet reference check failed:", {
          mainTableExists: !!table,
          historyTableExists: !!historyTable,
        });
        throw new Error(
          !table
            ? `Table '${tableName}' not found when trying to delete related junction records`
            : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
        );
      }

      const headers = this._getHeaders(table);
      const fkColumns = headers.filter((h) => h.toLowerCase().endsWith("_id"));

      if (fkColumns.length !== 2) {
        throw new Error("Invalid junction table structure");
      }

      if (table.getLastRow() === 1)
        return {
          status: 204,
          message: "No records to check integrity of.",
          count: 0,
        };

      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();
      const invalidRows = [];
      const rowsToRemove = [];

      const historyId = this._getNextId(historyTable);

      for (let i = 0; i < data.length; i++) {
        let isValid = true;
        for (let j = 0; j < fkColumns.length; j++) {
          const colIndex = headers.indexOf(fkColumns[j]);
          const fkValue = data[i][colIndex];
          const parentTable = fkColumns[j].replace(/_id$/i, "").toUpperCase();

          const response = this.read(parentTable, fkValue);
          if (response.status !== 200) {
            isValid = false;
          }
        }
        if (!isValid) {
          invalidRows.unshift(i + 2);
          rowsToRemove.push([
            historyId + invalidRows.length,
            new Date(),
            ...data[i].slice(2),
          ]);
        }
      }

      if (invalidRows.length > 0) {
        console.log("[DELETE] Starting row deletion process");
        invalidRows.forEach((rowIdx, index) => {
          console.log(
            `[DELETE] Removing row ${rowIdx} (${index + 1}/${
              invalidRows.length
            })`
          );
          table.deleteRow(rowIdx);
        });
        console.log("[DELETE] Row deletion completed");

        // Add to history
        console.log("[HISTORY] Adding records to history table");
        // Sanitize rows to prevent CSV injection
        const sanitizedRowsToRemove = rowsToRemove.map((row) =>
          this._sanitizeRow(row)
        );
        const historyRange = historyTable.getRange(
          historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
          1,
          sanitizedRowsToRemove.length,
          sanitizedRowsToRemove[0].length
        );
        historyRange.setValues(sanitizedRowsToRemove);
        console.log("[HISTORY] History records added successfully");

        // Clear cache
        console.log("[CACHE] Clearing cache for affected tables");
        this._clearCache(junctionTableName);
        this._clearCache(junctionHistoryTableName);
        console.log("[CACHE] Cache cleared successfully");
      } else {
        console.log("[NO_ACTION] No matching records found to delete");
      }

      const result = {
        status: 200,
        count: rowsToRemove.length,
        message: "Record(s) removed successfully",
      };
      console.log("[COMPLETE] Operation finished successfully:", result);
      return result;
    } catch (err) {
      console.error(`Error in checkTableIntegrity: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Deletes related records from a junction table
   * @param {string} tableName - Name of the junction table
   * @param {string} junctionHistoryTableName - Name of the history table
   * @param {number} fkIndex - Index of the foreign key column
   * @param {number} id - ID to match in the foreign key column
   * @returns {Object} Status and count of deleted records
   */
  deleteRelatedJunctionRecords(
    tableName,
    junctionHistoryTableName,
    fkIndex,
    id
  ) {
    console.log("\n[DELETE_JUNCTION] Starting deletion process:", {
      tableName,
      historyTable: junctionHistoryTableName,
      fkIndex,
      targetId: id,
    });

    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        // Get and validate table references
        console.log("[SHEETS] Attempting to get sheet references");
        const table = this._getSheet(tableName);
        const historyTable = this._getSheet(junctionHistoryTableName);

        if (!table || !historyTable) {
          console.error("[SHEETS] Sheet reference check failed:", {
            mainTableExists: !!table,
            historyTableExists: !!historyTable,
          });
          throw new Error(
            !table
              ? `Table '${tableName}' not found when trying to delete related junction records`
              : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
          );
        }
        console.log("[SHEETS] Successfully retrieved both sheets");

        // Check for existing data
        const lastRow = table.getLastRow();
        console.log("[ROWS] Last row in table:", lastRow);

        if (lastRow < 1) {
          console.log("[EMPTY] Table is empty, no records to delete");
          return {
            status: 204,
            message: "No content to delete",
          };
        }

        // Get data range for processing
        console.log("[DATA] Retrieving data range:", {
          startRow: 2,
          targetColumn: fkIndex + 1,
          numRows: lastRow - 1,
          numCols: table.getLastColumn(),
        });

        const idCol = table.getRange(2, fkIndex + 1, lastRow - 1).getValues();
        const fullData = table
          .getRange(2, 1, lastRow - 1, table.getLastColumn())
          .getValues();
        console.log("[DATA] Retrieved rows:", idCol.length);

        // Prepare for deletion
        const historyId = this._getNextId(historyTable);
        console.log("[HISTORY] Generated new history ID:", historyId);

        // Find records to remove
        console.log("[PROCESS] Starting record identification");
        let idxToRemove = [];
        let rowsToRemove = [];

        for (let i = 0; i < idCol.length; i++) {
          if (idCol[i][0] === id) {
            idxToRemove.unshift(i + 2);
            rowsToRemove.push([
              historyId + idxToRemove.length,
              new Date(),
              ...fullData[i].slice(2),
            ]);
            console.log(
              `[MATCH] Found matching record at row ${i + 2}, ${fullData[i]}`
            );
          }
        }

        console.log("[SUMMARY] Records found:", {
          totalMatches: rowsToRemove.length,
          idxToDelete: idxToRemove,
          rowsToDelete: rowsToRemove,
          historyRecordsToCreate: rowsToRemove.length,
        });

        // Perform deletions
        if (idxToRemove.length > 0) {
          console.log("[DELETE] Starting row deletion process");
          idxToRemove.forEach((rowIdx, index) => {
            console.log(
              `[DELETE] Removing row ${rowIdx} (${index + 1}/${
                idxToRemove.length
              })`
            );
            table.deleteRow(rowIdx);
          });
          console.log("[DELETE] Row deletion completed");

          // Add to history
          console.log("[HISTORY] Adding records to history table");
          // Sanitize rows to prevent CSV injection
          const sanitizedRowsToRemove = rowsToRemove.map((row) =>
            this._sanitizeRow(row)
          );
          const historyRange = historyTable.getRange(
            historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
            1,
            sanitizedRowsToRemove.length,
            sanitizedRowsToRemove[0].length
          );
          historyRange.setValues(sanitizedRowsToRemove);
          console.log("[HISTORY] History records added successfully");

          // Clear cache
          console.log("[CACHE] Clearing cache for affected tables");
          this._clearCache(tableName);
          this._clearCache(junctionHistoryTableName);
          console.log("[CACHE] Cache cleared successfully");
        } else {
          console.log("[NO_ACTION] No matching records found to delete");
        }

        const result = {
          status: 200,
          count: rowsToRemove.length,
          message: "Record(s) removed successfully",
        };
        console.log("[COMPLETE] Operation finished successfully:", result);
        return result;
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error("[ERROR] Failed to remove related junction records:", {
        error: err.message,
        stack: err.stack,
        context: {
          tableName,
          historyTable: junctionHistoryTableName,
          fkIndex,
          targetId: id,
        },
      });

      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Get all records from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} options - Options for pagination and sorting
   * @param useCache - Flag that tells the db to use cached records
   * @returns {Object} Status and array of records
   */
  getAll(tableName, options = {}, useCache = true) {
    try {
      let message = "Data retrieved successfully";
      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_all`;
      let data;

      if (useCache) {
        data = this._getCachedData(cacheKey);
      }

      if (!data) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No data in the table "${tableName}"`,
          };
        }

        data = sheet
          .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
          .getValues()
          .map((row) =>
            headers.reduce((acc, header, index) => {
              header = header.toLowerCase();
              acc[header] = row[index];
              return acc;
            }, {})
          );
        if (!(data.length > 1000)) {
          this._setCachedData(cacheKey, data);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);
        if (fieldType) {
          data.sort((a, b) => {
            // console.log(a);
            let compareOperator;
            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }
            return compareOperator * sortOrder;
          });
          message = `Data sorted Succesfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }
        const startIndex = (page - 1) * pageSize;
        data = data.slice(startIndex, startIndex + pageSize);
        message += ` (Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: data,
        message: message,
      };
    } catch (err) {
      console.error(`Error in getAll: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithFilter(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex]);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues()
          .filter((row) => {
            // console.log("row analizada")
            return row[fieldIndex] === foreignKey;
          })
          .map((row) => {
            return headers.reduce((acc, header, index) => {
              header = header.toLowerCase();
              acc[header] = row[index];
              return acc;
            }, {});
          });
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithLogs(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      console.log(`[START] getRelatedRecords with params:`, {
        foreignKey,
        tableName,
        field,
        fieldIndex,
        options,
        useCache,
      });

      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      console.log(`[SHEET] Retrieved sheet:`, sheet ? sheet.getName() : "null");

      // Type checking for foreign key
      if (!(typeof foreignKey === "number")) {
        console.error(`[ERROR] Invalid foreign key type:`, typeof foreignKey);
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);
      }

      // Sheet existence check
      if (!sheet) {
        console.error(`[ERROR] Sheet not found:`, tableName);
        throw new Error(`Table "${tableName}" not found`);
      }

      // Field existence check
      if (!this.tables[tableName][field]) {
        console.error(`[ERROR] Field not found:`, {
          table: tableName,
          field: field,
          availableFields: Object.keys(this.tables[tableName]),
        });
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      // Cache check
      if (useCache) {
        console.log(
          `[CACHE] Attempting to retrieve from cache with key:`,
          cacheKey
        );
        relatedData = this._getCachedData(cacheKey);
        if (relatedData) {
          console.log(
            `[CACHE] Data found in cache, length:`,
            relatedData.length
          );
        } else {
          console.log(`[CACHE] No cached data found`);
        }
      }

      if (!relatedData) {
        console.log(`[PROCESS] Starting data retrieval from sheet`);
        const headers = this._getHeaders(sheet);
        console.log(`[HEADERS] Retrieved headers:`, headers);

        const lastRow = sheet.getLastRow();
        console.log(`[ROWS] Last row:`, lastRow);

        if (sheet.getLastRow() === 1) {
          console.log(`[EMPTY] Table is empty (only headers)`);
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        console.log(`[DATA] Retrieving data range from sheet`);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        console.log(`[DATA] Retrieved ${relatedData.length} rows of raw data`);

        let finalData = [];
        console.log(
          `[FILTER] Starting to filter data with fieldIndex:`,
          fieldIndex
        );
        console.log(`[FILTER] Looking for foreignKey:`, foreignKey);

        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          if (i === 0 || i === relatedData.length - 1) {
            console.log(`[ROW ${i}] Sample row data:`, row);
            console.log(`[ROW ${i}] Value at fieldIndex:`, row[fieldIndex]);
          }

          if (row[fieldIndex] === foreignKey) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
          }
        }

        console.log(`[FILTER] Found ${finalData.length} matching records`);
        relatedData = finalData;

        if (relatedData.length <= 1000) {
          console.log(`[CACHE] Caching ${relatedData.length} records`);
          this._setCachedData(cacheKey, relatedData);
        } else {
          console.log(`[CACHE] Data too large to cache:`, relatedData.length);
        }
      }

      // Sorting
      if (options.sortBy) {
        console.log(`[SORT] Attempting to sort by:`, options.sortBy);
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log(`[SORT] Field type:`, fieldType);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;
            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }
            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          console.warn(`[SORT] Field not found in schema:`, sortField);
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      // Pagination
      if (options.page && options.pageSize) {
        console.log(`[PAGE] Applying pagination:`, options);
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);

        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          console.error(`[PAGE] Invalid pagination parameters:`, {
            page,
            pageSize,
          });
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
        console.log(`[PAGE] Applied pagination, results:`, relatedData.length);
      }

      console.log(`[END] Returning ${relatedData.length} records`);
      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`[ERROR] Error in getRelatedRecords:`, err);
      console.error(`[ERROR] Stack trace:`, err.stack);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Gets related records when provided a fk.
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records with detailed logs
   */
  getRelatedRecords(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex]);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        let finalData = [];
        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          let obj = {};
          if (row[fieldIndex] === foreignKey) {
            // console.log("row que si paso", row)
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
          }
        }
        relatedData = finalData;
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Gets related records using text finder
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records found using text finder
   */
  getRelatedRecordsWithTextFinder(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);
        const lastRow = sheet.getLastRow();
        const lastColumn = sheet.getLastColumn();
        relatedData = [];
        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
        const allData = dataRange.getValues();

        const searchColumnRange = sheet.getRange(
          2,
          fieldIndex + 1,
          lastRow - 1,
          1
        );
        const textFinder = searchColumnRange
          .createTextFinder(foreignKey.toString())
          .matchEntireCell(true)
          .matchCase(false);
        const matchedRanges = textFinder.findAll();

        if (matchedRanges.length === 0) {
          return {
            status: 200,
            data: [],
            message: `No related records found for foreign key ${foreignKey}`,
          };
        }

        const rowIndicesSet = new Set();
        matchedRanges.forEach((range) => {
          rowIndicesSet.add(range.getRow());
        });
        // console.log("set of indices",rowIndicesSet)
        const rowIndices = Array.from(rowIndicesSet).sort((a, b) => a - b);
        // console.log("array of indices ordered",rowIndices)

        // const rowIndices = matchedRanges.map((range) => range.getRow()).sort((a, b) => a - b);
        const filteredRows = rowIndices.map((row) => allData[row - 2]);

        relatedData = filteredRows.map((row) => {
          headers.reduce((acc, header, index) => {
            header = header.toLowerCase();
            acc[header] = row[index];
            return acc;
          }, {});
        });

        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                  a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * MANY TO MANY LOGIC (create stays the same)
   */

  updateJunctionRecord(junctionTableName, id, data, keyOrder) {
    try {
      // Validate required parameters
      if (!id) {
        throw new Error("ID parameter is required for updateJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found.`);
      }
      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => !key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          "Junction table must have exactly two foreign key fields"
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));

      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations, excluding the current record being updated
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();

      // Find the row index of the current record being updated
      const currentRecordRow = this._findRowById(table, id);
      if (currentRecordRow === -1) {
        throw new Error(
          `Record with ID ${id} not found in junction table ${junctionTableName}`
        );
      }

      const existingRecords = [];
      entityFkIndices.forEach((colIndex) => {
        // Get values from rows 2 to lastRow, excluding the current record row
        const values = [];
        for (let row = 2; row <= lastRow; row++) {
          if (row !== currentRecordRow) {
            values.push(table.getRange(row, colIndex + 1).getValue());
          }
        }
        existingRecords.push(values);
      });

      console.log("existing records (excluding current):", existingRecords);
      console.log("existing records length:", existingRecords[0]?.length || 0);
      console.log("fks length:", fksIds.length);
      console.log("current record row:", currentRecordRow);

      let isDuplicate = false;

      // Only check for duplicates if there are existing records to compare against
      if (existingRecords[0] && existingRecords[0].length > 0) {
        for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
          let isMatch = true;
          for (let j = 0; j < existingRecords.length && isMatch; j++) {
            if (existingRecords[j][i] !== fksIds[j]) {
              isMatch = false;
            }
          }
          if (isMatch) {
            isDuplicate = true;
          }
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(
            ", "
          )} in another record`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.update(junctionTableName, id, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error updating junction record", err.stack);
      const isValidationError =
        err.message.includes("ID parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder") ||
        err.message.includes("Record with ID");
      return {
        status: err.message.includes("Record with ID")
          ? 404
          : isValidationError
          ? 400
          : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  _getHeaders(sheet) {
    const rawHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    // Ensure all headers are strings to prevent issues with .toLowerCase(), .endsWith(), etc.
    return rawHeaders.map((header) => String(header));
  }

  _getSheet(name) {
    return this.spreadsheet.getSheetByName(name);
  }

  _getNextId(sheet) {
    const lastRow = sheet.getLastRow();
    console.log(lastRow);
    if (lastRow <= 1) return 1;

    const idRange = sheet.getRange("A:A");
    const lastId = idRange.getValues()[lastRow - 1][0];

    const nextId = Math.max(lastRow, parseInt(lastId) + 1);
    console.log("next id", nextId);
    if (isNaN(nextId)) {
      throw new Error(
        "Next ID is not a number, please check the ID column in the sheet"
      );
    }
    return nextId;
  }

  _getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  _setCachedData(key, data) {
    console.log(
      "[CACHE] trying to cache",
      data.length,
      " records in",
      key,
      "key"
    );
    try {
      this.cache.put(key, JSON.stringify(data), 600);
    } catch (e) {
      console.log(
        "[CACHE] tried to cache",
        data.length,
        " records in",
        key,
        "key, but got the error: ",
        e.message
      );
      console.log("[WARNING] NO CACHE SET FOR ", key, " key");
    }
  }

  _clearCache(tableName) {
    this.cache.remove(`${tableName}_all`);
  }

  /**
   * Handles cascade deletion of related records
   * @private
   * @param {string} tableName - Name of the parent table
   * @param {number} id - ID of the record being deleted
   * @returns {Object} Status and count of deleted related records
   */
  _handleCascadeDelete(tableName, id) {
    try {
      const sheets = this.spreadsheet.getSheets();
      const tableBaseName = tableName.toLowerCase();

      let deletedRelations = 0; // Track number of affected records
      for (const sheet of sheets) {
        const sheetName = sheet.getName();
        if (!sheetName.includes("DELETED") && sheetName.includes("RELATION")) {
          const junctionTableName = sheetName;
          const junctionHistoryTableName = `DELETED_${sheetName}`;
          const headers = this._getHeaders(sheet);
          const fkFieldName = `${tableBaseName}_id`;

          const fkIndex = headers.indexOf(fkFieldName.toUpperCase());

          if (fkIndex !== -1) {
            const response = this.deleteRelatedJunctionRecords(
              junctionTableName,
              junctionHistoryTableName,
              fkIndex,
              id
            );
            if (response.status === 200) {
              deletedRelations += response.count;
            }
          }
        }
      }
      return {
        status: 200,
        message: `Cascade delete completed. Removed ${deletedRelations} related records`,
      };
    } catch (err) {
      console.error("Cascade delete failed:", err);
      throw err; // Propagate error to main delete operation
    }
  }

  /**
   * Find the row index of a record by its ID
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to search in
   * @param {number|string} id - The ID to search for
   * @returns {number} The row index of the found ID, or -1 if not found
   */
  _findRowById(sheet, id) {
    const idRange = sheet.getRange("A:A");
    const searchResult = idRange
      .createTextFinder(id.toString())
      .matchEntireCell(true)
      .matchCase(false)
      .findNext();
    return searchResult ? searchResult.getRow() : -1;
  }

  // _validateData(data, keyOrder) {
  //   return keyOrder.every((key) => key in data);
  // }

  /**
   * Validates that keyOrder includes all required fields from table schema
   * @param {string} tableName - Name of the table
   * @param {string[]} keyOrder - Array of field names provided
   * @returns {Object} - Validation result with missing required fields
   */
  _validateKeyOrderCompleteness(tableName, keyOrder) {
    const tableSchema = this.tables[tableName];
    if (!tableSchema) {
      return { isValid: true, missingRequiredFields: [] }; // No schema to validate against
    }

    const requiredFields = [];
    for (const [fieldName, fieldDef] of Object.entries(tableSchema)) {
      const hasDefault =
        this._getDefaultValue(tableName, fieldName) !== undefined;
      if (!hasDefault) {
        requiredFields.push(fieldName);
      }
    }

    const missingRequiredFields = requiredFields.filter(
      (field) => !keyOrder.includes(field)
    );
    const isValid = missingRequiredFields.length === 0;

    return { isValid, missingRequiredFields, requiredFields };
  }

  /**
   * Validates that all required keys are present in the data object.
   * @param {Object} data - The data object to validate.
   * @param {string[]} keyOrder - An array of required keys.
   * @param {string} [context] - Optional context for error messages.
   * @returns {Object} - An object containing validation status and missing keys.
   */
  _validateData(tableName, data, keyOrder, context = "") {
    // First validate that keyOrder is complete
    const keyOrderValidation = this._validateKeyOrderCompleteness(
      tableName,
      keyOrder
    );
    if (!keyOrderValidation.isValid) {
      throw new Error(
        `Incomplete keyOrder: Missing required fields [${keyOrderValidation.missingRequiredFields.join(
          ", "
        )}] ${context}. Required fields are: [${keyOrderValidation.requiredFields.join(
          ", "
        )}]`
      );
    }

    // Then validate that data contains all keys from keyOrder
    const missingKeys = keyOrder.filter((key) => {
      const isMissing = !(key in data);
      if (!isMissing) return false;
      const defaultValue = this._getDefaultValue(tableName, key);
      return defaultValue ? false : true; // only flag missing if no default
    });
    const isValid = missingKeys.length === 0;
    return { isValid, missingKeys, context };
  }

  _checkType(value, expectedType) {
    expectedType = expectedType.trim();
    switch (expectedType) {
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "date":
        // console.log("chequeo de tipo date", value instanceof Date)
        console.log(
          "chequeo de que getTime() es un numero",
          !isNaN(value.getTime())
        );
        console.log(
          "chequeo de que es tipo date por otro metodo",
          Object.prototype.toString.call(value) === "[object Date]"
        );
        return (
          Object.prototype.toString.call(value) === "[object Date]" &&
          !isNaN(value.getTime())
        );
      default:
        return false;
    }
  }

  /**
   * Normalize incoming schema field definitions to { type, default? }
   * @param {Object} fields
   * @returns {Object}
   */
  _normalizeSchemaFields(fields) {
    const normalized = {};
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypesList = VALID_TYPES.join(", ");
    for (const [fieldName, definition] of Object.entries(fields || {})) {
      if (typeof definition === "string") {
        const typeValue = definition.trim();
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        normalized[fieldName] = { type: typeValue };
      } else if (definition && typeof definition === "object") {
        const typeValue =
          typeof definition.type === "string" ? definition.type.trim() : "";
        if (!typeValue) {
          throw new Error(
            `Missing required 'type' for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        const norm = { type: typeValue };
        if (Object.prototype.hasOwnProperty.call(definition, "default")) {
          norm.default = definition.default;
        }
        // Optional behavior flags
        if (
          Object.prototype.hasOwnProperty.call(definition, "treatNullAsMissing")
        ) {
          if (typeof definition.treatNullAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatNullAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatNullAsMissing = definition.treatNullAsMissing;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            definition,
            "treatEmptyStringAsMissing"
          )
        ) {
          if (typeof definition.treatEmptyStringAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatEmptyStringAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatEmptyStringAsMissing = definition.treatEmptyStringAsMissing;
        }
        normalized[fieldName] = norm;
      } else {
        throw new Error(
          `Invalid schema definition for field "${fieldName}". Expected string or { type, default? }`
        );
      }
    }
    return normalized;
  }

  _getFieldDefinition(tableName, key) {
    const tableDef = this.tables?.[tableName];
    if (!tableDef) return null;
    const def = tableDef[key];
    if (def == null) return null;
    if (typeof def === "string") return { type: def.trim() };
    if (typeof def === "object") return def;
    return null;
  }

  _getExpectedType(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    return def?.type || null;
  }

  _getDefaultValue(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    if (!def || !Object.prototype.hasOwnProperty.call(def, "default")) {
      return undefined;
    }

    const defaultValue = def.default;

    // Handle special default values
    if (defaultValue === "now") {
      return new Date();
    }

    return defaultValue;
  }

  /**
   * Apply default values to missing fields (undefined only).
   * Does not override explicit null or empty string values.
   * @param {string} tableName
   * @param {Object} data
   * @param {string[]} keyOrder
   * @returns {{ data: Object, appliedDefaults: Array<{key: string, value: any}> }}
   */
  _applyDefaults(tableName, data, keyOrder) {
    const result = { ...data };
    const appliedDefaults = [];
    for (const key of keyOrder) {
      const currentValue = result[key];
      const fieldDef = this._getFieldDefinition(tableName, key) || {};
      const treatNullAsMissing = !!fieldDef.treatNullAsMissing;
      const treatEmptyStringAsMissing = !!fieldDef.treatEmptyStringAsMissing;

      const isConsideredMissing =
        currentValue === undefined ||
        (currentValue === null && treatNullAsMissing) ||
        (currentValue === "" && treatEmptyStringAsMissing);

      if (isConsideredMissing) {
        const defVal = this._getDefaultValue(tableName, key);
        if (defVal !== undefined) {
          // Coalesce null defaults to empty string to preserve prior blank behavior
          result[key] = defVal === null ? "" : defVal;
          appliedDefaults.push({ key, value: defVal });
        }
      }
    }
    return { data: result, appliedDefaults };
  }

  /**
   * Validates type checking with detailed logging
   * @private
   * @param {*} value - Value to check
   * @param {string} expectedType - Expected type of the value
   * @returns {boolean} Whether the value matches the expected type
   */
  _checkTypeWithLogs(value, expectedType) {
    console.log("\n[TYPE CHECK] Starting type check:", {
      value,
      expectedType,
      actualType: typeof value,
      isNull: value === null,
      isUndefined: value === undefined,
    });

    switch (expectedType) {
      case "number":
        const isNumber = typeof value === "number" && !isNaN(value);
        console.log("[NUMBER CHECK]", {
          value,
          isTypeNumber: typeof value === "number",
          isNotNaN: !isNaN(value),
          finalResult: isNumber,
        });
        return isNumber;

      case "string":
        const isString = typeof value === "string";
        console.log("[STRING CHECK]", {
          value,
          isTypeString: isString,
          valueLength: value?.length,
        });
        return isString;

      case "boolean":
        const isBoolean = typeof value === "boolean";
        console.log("[BOOLEAN CHECK]", {
          value,
          isTypeBoolean: isBoolean,
          isTruthy: !!value,
        });
        return isBoolean;

      case "date":
        try {
          console.log("[DATE CHECK] Initial value:", {
            value,
            isDate: value instanceof Date,
            prototype: Object.prototype.toString.call(value),
          });

          // Check if it's a Date object
          const isDateObject =
            Object.prototype.toString.call(value) === "[object Date]";
          console.log("[DATE CHECK] Is Date object:", isDateObject);

          // Try to get timestamp (will throw if not a valid date)
          let hasValidTimestamp = false;
          try {
            hasValidTimestamp = !isNaN(value.getTime());
            console.log("[DATE CHECK] Timestamp check:", {
              timestamp: value.getTime(),
              isValid: hasValidTimestamp,
            });
          } catch (e) {
            console.error("[DATE CHECK] Failed to get timestamp:", e.message);
          }

          const isValidDate = isDateObject && hasValidTimestamp;
          console.log("[DATE CHECK] Final result:", {
            isDateObject,
            hasValidTimestamp,
            isValid: isValidDate,
          });

          return isValidDate;
        } catch (err) {
          console.error("[DATE CHECK] Error during date validation:", {
            error: err.message,
            stack: err.stack,
          });
          return false;
        }

      default:
        console.warn("[TYPE CHECK] Unknown type:", expectedType);
        return false;
    }
  }

  _checkValidCreationTypes(tableFields) {
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypes = VALID_TYPES.join(", ");
    if (tableFields) {
      for (const [field, type] of Object.entries(tableFields)) {
        if (!VALID_TYPES.includes(type)) {
          throw new Error(
            `Invalid type "${type}" for field "${field}". Valid types are: ${validTypes}`
          );
        }
      }
    }
  }

  _getFieldIndex(tableName, fieldName) {
    const table = this._getSheet(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' not found`);
    }

    const headers = this._getHeaders(table);
    const fieldIndex = headers.findIndex(
      (header) => header.toLowerCase() === fieldName.toLowerCase()
    );

    return fieldIndex;
  }

  applyColorScheme(tableName, colorScheme) {
    try {
      const sheet = this.spreadsheet.getSheetByName(tableName);
      const lastRow = sheet.getLastRow() === 1 ? 10 : sheet.getLastRow();

      const lastCol = sheet.getLastColumn();

      // Define multiple color schemes
      const colorSchemes = {
        red: {
          headerColor: "#E53935", // Red header
          color1: "#FFCDD2", // Light Red for alternating rows
          color2: "#FFEBEE", // Lighter Red
        },
        blue: {
          headerColor: "#1E88E5", // Blue header
          color1: "#BBDEFB", // Light Blue for alternating rows
          color2: "#E3F2FD", // Lighter Blue
        },
        green: {
          headerColor: "#43A047", // Green header
          color1: "#C8E6C9", // Light Green for alternating rows
          color2: "#E8F5E9", // Lighter Green
        },
        orange: {
          headerColor: "#FB8C00", // Orange header
          color1: "#FFE0B2", // Light Orange for alternating rows
          color2: "#FFF3E0", // Lighter Orange
        },
        purple: {
          headerColor: "#8E24AA", // Purple header
          color1: "#E1BEE7", // Light Purple for alternating rows
          color2: "#F3E5F5", // Lighter Purple
        },
      };

      // Get the chosen color scheme based on the input
      const scheme = colorSchemes[colorScheme];

      if (!scheme) {
        throw new Error(
          "Color scheme not found. Available schemes: red, blue, green, orange, purple."
        );
      }

      // Apply color to the header row
      const headerRange = sheet.getRange(1, 1, 1, lastCol);
      headerRange.setBackground(scheme.headerColor).setFontColor("#FFFFFF");

      const sampleFromApplyColorScheme = {
        headerColor: scheme.headerColor,
        color1: scheme.color1,
        color2: scheme.color2,
      };

      // Apply alternating colors to the data rows
      for (let row = 2; row <= lastRow; row++) {
        const range = sheet.getRange(row, 1, 1, lastCol);
        if (row % 2 === 0) {
          range.setBackground(scheme.color2); // Even rows
        } else {
          range.setBackground(scheme.color1); // Odd rows
        }
      }

      console.log("sampleFromApplyColorScheme", sampleFromApplyColorScheme);
      return {
        status: 200,
        message: `Color scheme applied to table ${tableName}`,
        data: sampleFromApplyColorScheme,
      };
    } catch (error) {
      console.error("[APPLY COLOR SCHEME] Error:", error);
      return {
        status: 500,
        message: `Error applying color scheme to table ${tableName}, ${error}`,
        data: {},
      };
    }
  }
}

/**
 * Creates and returns a new instance of the CRUD class
 * @returns {DB} A new instance of the CRUD class
 * @param dbName - Name of the Database
 * @param dbId - id of the sheet if already created
 */
function init(dbName, dbId = "") {
  return new DB(dbName, dbId);
}

function example() {
  const db = new DB(
    "myTestDataBase",
    (dbId = "1auvs768mjQQS9dTJuutCOpYKvWTSUjtPmzzZCSZBM1M")
  );

  console.log(db.getCreationResult());

  const employeeTableConfig = {
    tableName: "EMPLOYEES",
    fields: {
      name: "string",
      age: "number",
      position: "string",
      employed: "boolean",
      hire_date: "date",
    },
  };

  db.createTable(employeeTableConfig);

  console.log("employee table created");

  const employees = [
    {
      name: "John Doe",
      age: 30,
      position: "Software Engineer",
      employed: true,
      hire_date: new Date("2022-01-15"),
    },
    {
      name: "Jane Smith",
      age: 28,
      position: "Product Manager",
      employed: true,
      hire_date: new Date("2021-11-05"),
    },
    {
      name: "Mike Johnson",
      age: 35,
      position: "Data Scientist",
      employed: true,
      hire_date: new Date("2020-08-20"),
    },
    {
      name: "Emily Davis",
      age: 24,
      position: "UX Designer",
      employed: false,
      hire_date: new Date("2019-02-01"),
    },
    {
      name: "Chris Lee",
      age: 40,
      position: "Operations Manager",
      employed: true,
      hire_date: new Date("2020-12-10"),
    },
    {
      name: "Sarah Wilson",
      age: 33,
      position: "HR Specialist",
      employed: true,
      hire_date: new Date("2018-06-18"),
    },
    {
      name: "Alex Martin",
      age: 29,
      position: "Business Analyst",
      employed: false,
      hire_date: new Date("2021-04-25"),
    },
    {
      name: "Linda Clark",
      age: 42,
      position: "Accountant",
      employed: true,
      hire_date: new Date("2021-09-30"),
    },
    {
      name: "James Walker",
      age: 27,
      position: "DevOps Engineer",
      employed: true,
      hire_date: new Date("2017-07-19"),
    },
    {
      name: "Jessica Brown",
      age: 26,
      position: "Marketing Manager",
      employed: false,
      hire_date: new Date("2022-03-22"),
    },
    {
      name: "Robert Harris",
      age: 37,
      position: "Network Engineer",
      employed: true,
      hire_date: new Date("2021-01-11"),
    },
    {
      name: "Sophia Lewis",
      age: 31,
      position: "Backend Developer",
      employed: true,
      hire_date: new Date("2020-05-15"),
    },
    {
      name: "Lucas Moore",
      age: 34,
      position: "Frontend Developer",
      employed: false,
      hire_date: new Date("2022-02-17"),
    },
    {
      name: "Olivia Taylor",
      age: 25,
      position: "QA Engineer",
      employed: true,
      hire_date: new Date("2020-10-27"),
    },
    {
      name: "Daniel Anderson",
      age: 38,
      position: "System Administrator",
      employed: true,
      hire_date: new Date("2019-11-09"),
    },
  ];
  // let results = []
  // for (e of employees) {
  //   results.push(db.create('EMPLOYEES', e, ['name', 'age', 'position', 'employed', 'hire_date']));
  // }
  db.create(
    "EMPLOYEES",
    {
      name: "hola",
      age: 25,
      position: "QA Engineer",
      employed: "true",
      hire_date: new Date("2020-10-27"),
    },
    ["name", "age", "position", "employed", "hire_date"]
  );
  // console.log('Create Result: ', results);

  // Read an employee by ID
  // const readResult = db.read('EMPLOYEES', createResult.id);
  // console.log('Read Result:', readResult.data);

  // Update the employee record
  // const updatedEmployee = {
  //   name: 'John Doe',
  //   age: 31, // Updated age
  //   position: 'Senior Software Engineer', // Updated position
  // };
  // const updateResult = db.update('EMPLOYEES', createResult.id, updatedEmployee, ['name', 'age', 'position']);
  // console.log('Update Result:', updateResult);

  // Delete the employee record
  // const deleteResult = db.remove('EMPLOYEES', 'DELETED_EMPLOYEES', createResult.id);
  // console.log('Delete Result:', deleteResult);
  // Get All with pagination and sorting
  const getAllResult = db.getAll(
    "EMPLOYEES",
    { page: 1, pageSize: 25, sortBy: "hire_date", sortOrder: "desc" },
    (useCache = false)
  );
  console.log(getAllResult);

  // getAllResult.data.map((row) => {
  //    console.log(row)
  //    for (const [key, val] of Object.entries(row)) {
  //       console.log(`type of ${key}: `, typeof(val))
  //       if (key === "DATE"){
  //         console.log("fecha es un tipo Date",val instanceof Date);
  //         console.log("getime en la fecha:", val.getTime());
  //       }
  //     }
  // })

  console.log(
    db.createManyToManyTableConfig({
      tableName: "TOOL_GROUP_RELATION",
      historyTableName: "DELETED_TOOL_GROUP_RELATION",
      entity1TableName: "TOOL",
      entity2TableName: "MINOR_TOOL_GROUP_MIGRATION",
    })
  );
}

```

3. lookupsync.gs  
   1. Purpose: Holds much of the existing scriptLib functionality  
   2. Functions:  
      1. Lib.uuid()  
      2. Lib.notify(msg, title \= "System")  
      3. Lib.normalize \= function(str)  
      4. Lib.combineDateTime \= function(date, time)  
      5. parseDatesFromRange(dateString)  
      6. Lib.alertUser \= function(title, message)  
      7. Lib.confirmAction \= function(title, message)  
      8. getMap(sheetName)  
      9. getValidEventTimes \= function(ctx, dateVal, startTimeVal, endTimeVal)

```javascript
/**
* scriptLib.gs - The Universal Toolbelt
* Standardized for the Engine to ensure global availability.
*/
var Lib = Lib || {};

/** Generates a child-specific UUID */
Lib.uuid = function() {
 return "C-" + Utilities.getUuid().split('-')[0].toUpperCase();
};

/** UI: Simple Toast Notification */
Lib.notify = function(msg, title = "System") {
 SpreadsheetApp.getActiveSpreadsheet().toast(msg, title, 5);
};

/** Normalizes strings for comparison (lowercase, no whitespace) */
Lib.normalize = function(str) {
 return String(str || "").trim().toLowerCase();
};

/** Robust Date/Time Merger */
Lib.combineDateTime = function(date, time) {
 if (!date) return null;
 let d = new Date(date);
 if (isNaN(d.getTime())) return null;
  let t = new Date(time);
 if (isNaN(t.getTime())) {
   const parts = String(time).split(':');
   if (parts.length >= 2) {
     d.setHours(parseInt(parts[0], 10));
     d.setMinutes(parseInt(parts[1], 10));
     d.setSeconds(0);
     return d;
   }
   return d;
 }
  d.setHours(t.getHours());
 d.setMinutes(t.getMinutes());
 d.setSeconds(0);
 return d;
};

/**
* GLOBAL HELPER: THE DATE EXPLODER
* Kept outside Lib for easiest access by the Stage 3 Exploder.
*/
function parseDatesFromRange(dateString) {
 if (!dateString) return [];
 const results = [];
  try {
   let [datePart, timePart] = dateString.split(/@|at/);
   timePart = (timePart || "19:00").trim();

   const monthMatch = datePart.match(/[A-Za-z]+/);
   const yearMatch = datePart.match(/\d{4}/);
   if (!monthMatch) return [];

   const month = monthMatch[0];
   const year = yearMatch ? yearMatch[0] : new Date().getFullYear();
   const daySection = datePart.replace(month, "").replace(year, "").trim();
  
   const segments = daySection.split(",");

   segments.forEach(seg => {
     if (seg.includes("-")) {
       const [start, end] = seg.split("-").map(n => parseInt(n.trim()));
       for (let d = start; d <= end; d++) {
         results.push(new Date(`${month} ${d}, ${year} ${timePart}`));
       }
     } else {
       const d = parseInt(seg.trim());
       if (!isNaN(d)) {
         results.push(new Date(`${month} ${d}, ${year} ${timePart}`));
       }
     }
   });
 } catch (e) {
   console.error("Exploder Error: " + e.message);
 }
 return results;
}




/**
* UI HELPER: Shows a modal alert.
*/
Lib.alertUser = function(title, message) {
 const ui = SpreadsheetApp.getUi();
 ui.alert(title, message, ui.ButtonSet.OK);
}

/**
* UI HELPER: A simple confirmation dialog.
*/
Lib.confirmAction = function(title, message) {
 const ui = SpreadsheetApp.getUi();
 const response = ui.alert(title, message, ui.ButtonSet.YES_NO);
 return response === ui.Button.YES;
}



// Inside scriptLib
function getMap(sheetName) {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const regSheet = ss.getSheetByName("Map_Registry");
 const data = regSheet.getDataRange().getValues();
  const map = {};
 for (let i = 1; i < data.length; i++) {
   if (data[i][0] === sheetName) {
     // Map: Field Name -> Column Index
     map[data[i][1]] = data[i][2];
   }
 }
 return map;
}



/**
* Resolves messy Date, StartTime, and EndTime into clean JS Dates.
* If EndTime is missing, it adds the default duration from ControlPanel.
*/
getValidEventTimes = function(ctx, dateVal, startTimeVal, endTimeVal) {
 // 1. Combine Date and Start Time using your existing robust merger
 let start = Lib.combineDateTime(dateVal, startTimeVal);
 if (!start) return { start: null, end: null };

 let end = null;
  // 2. Check if End Time exists
 if (endTimeVal) {
   end = Lib.combineDateTime(dateVal, endTimeVal);
   // If the event crosses midnight (e.g., 10 PM to 2 AM)
   if (end < start) {
     end.setDate(end.getDate() + 1);
   }
 } else {
   // 3. Fallback to ControlPanel Default Duration
   // Your CSV shows "Default Event Duration Hours" = 2
   let defaultHours = parseFloat(ctx.settings["Default Event Duration Hours"]) || 2;
   end = new Date(start.getTime());
   end.setMinutes(end.getMinutes() + (defaultHours * 60));
 }

 return { start: start, end: end };
};

```

4. DateTime.gs  
   1. Purpose: Date/Time Normalization: Handling weird theatrical time strings.  
   2. Ensure we log that the Spreadsheet Timezone (SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()) must be explicitly passed into our date builders before we sync to Calendar, otherwise a 7:00 PM Call Time might sync as 7:00 PM UTC (2:00 PM EST).

```javascript

```

5. reconcile.gs  
   1. Purpose: Generic Data Drift; A function that compares two arrays and returns the differences.  
   2. reconcileSheets  
      1. Update scriptLib.reconcileSheets to accept a protectedFields array from the Map\_Registry.  
      2. This function seems to have been deleted at some point?  
   3. reconcileByFingerprint(params)  
   4. reconcileVenuesByFuzzyFingerprint()  
   5. Add a validateTheatricalTime(timeStr) helper. Theatrical imports often have "TBD," "After Show," or weird ranges like "8:30am–11:30am." Your scriptLib should normalize these before they hit the engine\_ingest.  
      1. Suggestion: Put this in scriptLib.TheatricalParser. It should handle "TBD" by assigning a default time (e.g., 12:00 PM) but flagging the SyncStatus as "Incomplete/TBD" so it doesn't push to a public-facing calendar by mistake.  
         1. Response: an all day event on Google calendar would be better than an assumed time.. but I don’t think we currently have logic for this. Something is flagging it as manual review 

```javascript


/**
* REVISED: Reconciler that uses Fingerprints instead of Unique IDs.
* Perfect for comparing two different calendars (Venue vs. Crew).
*/
function reconcileByFingerprint(params) {
 const { stage, sourceName, destName, sourceMap, destMap, fieldsToCompare } = params;
 const CONFIG = getGlobalConfig();
 const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceName);
 const destSheet = ss.getSheetByName(destName);
 if (!sourceSheet || !destSheet) return;

 const sData = sourceSheet.getDataRange().getValues();
 const dData = destSheet.getDataRange().getValues();
  // 1. Build Destination Lookup using FINGERPRINTS
 const dLookup = {};
 for (let i = 1; i < dData.length; i++) {
   // Pass the row and the map to the fingerprint helper
   const fingerprint = scriptLib.getAdvancedDuplicateFingerprint(dData[i], destMap);
   if (fingerprint) dLookup[fingerprint] = { data: dData[i], rowIdx: i + 1 };
 }

 let driftCount = 0;

 // 2. Iterate Source and match by Fingerprint
 for (let i = 1; i < sData.length; i++) {
   const sRow = sData[i];
   const rowIdx = i + 1;
   const sFingerprint = scriptLib.getAdvancedDuplicateFingerprint(sRow, sourceMap);
  
   if (!sFingerprint) continue;

   const match = dLookup[sFingerprint];

   // --- CASE: MISSING (The "Conflict" or "New Event" check) ---
   if (!match) {
     // In Stage 5, if a Venue event isn't in your Crew Log, it's a potential conflict
     masterLog({
       stage: stage,
       sheetName: sourceName,
       rowIdx: rowIdx,
       id: sFingerprint,
       type: "MISSING",
       details: `Fingerprint not found in ${destName}`
     });
     driftCount++;
     continue;
   }

   // --- CASE: MATCH FOUND (Check for internal drift) ---
   // If the Fingerprint matches, they are the same event.
   // Now check if secondary fields (Description, End Time, etc.) differ.
   let isDifferent = false;
   fieldsToCompare.forEach(field => {
     const sVal = String(sRow[sourceMap[field]] || "");
     const dVal = String(match.data[destMap[field]] || "");
     if (sVal !== dVal) isDifferent = true;
   });

   if (isDifferent) {
     if (CONFIG.AutomaticChangeswhenpossible === true) {
       fieldsToCompare.forEach(field => {
         destSheet.getRange(match.rowIdx, destMap[field] + 1).setValue(sRow[sourceMap[field]]);
       });
       applyStatus(destSheet, match.rowIdx, "Synced");
     } else {
       applyStatus(destSheet, match.rowIdx, "Manual Review", { details: "Venue data differs from Crew Log" });
     }
     driftCount++;
   }
 }
 return driftCount;
}
function reconcileVenuesByFuzzyFingerprint() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const vLog = ss.getSheetByName("Venue_Cal_Log").getDataRange().getValues();
 const cLogSheet = ss.getSheetByName("Crew_Calendar_Log");
 const cLogData = cLogSheet.getDataRange().getValues();

 // 1. Build Lookup by Time + Space
 const vLookup = {};
 vLog.forEach((row, i) => {
   if (i === 0) return;
   const fp = scriptLib.getTimeSpaceFingerprint(row, VENUECALMAP);
   if (fp) vLookup[fp] = row;
 });

 let adoptionCount = 0;
 let conflictCount = 0;

 for (let j = 1; j < cLogData.length; j++) {
   const cRow = cLogData[j];
   const cIdx = j + 1;
   const cFP = scriptLib.getTimeSpaceFingerprint(cRow, CREWCALMAP);
  
   if (!cFP || !vLookup[cFP]) continue;

   const vMatch = vLookup[cFP];
   const cTitle = String(cRow[CREWCALMAP.Title]).toLowerCase();
   const vTitle = String(vMatch[VENUECALMAP.Title]).toLowerCase();
  
   // 2. FUZZY TITLE CHECK
   // Does one title contain the other? (e.g., "Nutcracker" in "The Nutcracker")
   const titlesMatch = vTitle.includes(cTitle) || cTitle.includes(vTitle);

   if (titlesMatch) {
     // It's the same show! Adopt the ID if we don't have it.
     if (!cRow[CREWCALMAP.EventID]) {
       cLogSheet.getRange(cIdx, CREWCALMAP.EventID + 1).setValue(vMatch[VENUECALMAP.EventID]);
       cLogSheet.getRange(cIdx, CREWCALMAP.Source + 1).setValue("Venue Adoption");
       applyStatus(cLogSheet, cIdx, "Adopted from Venue");
       adoptionCount++;
     }
   } else {
     // Same Time/Space, DIFFERENT Title = HARD CONFLICT
     applyStatus(cLogSheet, cIdx, "Location Conflict", {
       details: `Building has "${vMatch[VENUECALMAP.Title]}" booked here.`
     });
     conflictCount++;
   }
 }
 return { adopted: adoptionCount, conflicts: conflictCount };
}

```

6. ultility.gs Functions \> scriptLib  
   1. checkOption(cellValue, command) checks/returns sheet, row, mode, behaviors    
   2. createFingerprint(title, date, time, location) —\> scriptLib?   
   3. runMasterHealthCheck() maybe this is just goSync(“log\_only”)  
   4. reconcileDataDrift(params)  
      1. reconcileSheets(params)  
      2. reconcileByFingerprint(params)  
   5. repairCrewCalendarLog() ——-\> probably now a sync mode or custom context?  
   6. Need to define fingerprint vs hash

```javascript
// ==========================================
// 2. CORE UTILITIES
// ==========================================




/**
* Consolidated Option Checker: Performs exact-match check against tags.
*/
function checkOption(cellValue, command) {
 if (!cellValue || !command) return false;
 const tags = String(cellValue).split(',').map(t => t.trim().toLowerCase());
 return tags.includes(command.toLowerCase());
}



/**
* Generates a human-readable delimited fingerprint for tracking changes.
*/
function createFingerprint(title, date, time, location) {
 const nDate = normalizeForComparison(date);
 const nTime = normalizeForComparison(time);
 return `${String(title || "").trim()} | ${nDate} | ${nTime} | ${String(location || "").trim()}`;
}

/**
* THE MASTER HEALTH CHECK: The Engine's Diagnostic Tool.
*/
function runMasterHealthCheck() {
 const ui = SpreadsheetApp.getUi();
 let newIdsCount = 0;
  // Track stats across all stages
 let totalStats = { checked: 0, updates: 0, drifts: 0, conflicts: 0 };

 try {
   notify("Stage 1/3: Synchronizing Registry...", "Health Check");
   if (typeof syncIdLog === "function") {
     newIdsCount = syncIdLog();
   }

   notify("Stage 2/3: Checking Data Drift...", "Health Check");
  
   // Stage 2A: Import vs Parent Lineup (Using EventName as the anchor)
   let stats1 = reconcileDataDrift({
     stageName: "Import -> Parent",
     sourceSheet: "import",
     destSheet: "Parent Lineup",
     sourceMap: IMPORT_MAP,
     destMap: PARENT_LINEUP_MAP,
     sKey: "EventName",
     dKey: "EventName",
     checkByFingerprint: false // Imports don't have fingerprints yet
   });

   // Stage 2B: Parent Lineup vs Lineup
   let stats2 = reconcileDataDrift({
     stageName: "Parent -> Lineup",
     sourceSheet: "Parent Lineup",
     destSheet: "Lineup",
     sourceMap: PARENT_LINEUP_MAP,
     destMap: LINEUP_MAP,
     sKey: "parentID",
     dKey: "parentID",
     checkByFingerprint: false // We check the parsed data later
   });

   // Stage 2C: Lineup vs Crew Calendar (The Core Sync)
   let stats3 = reconcileDataDrift({
     stageName: "Lineup -> Crew Log",
     sourceSheet: "Lineup",
     destSheet: "Crew_Calendar_Log",
     sourceMap: LINEUP_MAP,
     destMap: CREWCALMAP,
     sKey: "UUID",
     dKey: "UUID",
     checkByFingerprint: true // YES! Just compare the Fingerprint strings!
   });

   // Aggregate Stats
   totalStats.updates = stats1.updates + stats2.updates + stats3.updates;
   totalStats.drifts = stats1.drifts + stats2.drifts + stats3.drifts;
   totalStats.checked = stats1.checked + stats2.checked + stats3.checked;

   notify("Stage 3/3: Scanning for Room Conflicts...", "Health Check");
   if (typeof checkRoomConflicts === "function") {
     totalStats.conflicts = checkRoomConflicts();
   } else {
     console.warn("checkRoomConflicts not defined. Skipping Stage 3.");
   }
    // Log the final Global configuration state for the record
   const CONFIG = typeof getGlobalConfig === "function" ? getGlobalConfig() : { Mode: "Unknown" };
   masterLog({
     stage: "SYSTEM_HEALTH",
     sheetName: "MASTER",
     details: `Health Check Finished. Config Mode: ${CONFIG.Mode} | Rows Evaluated: ${totalStats.checked} | Drifts: ${totalStats.drifts} | Conflicts: ${totalStats.conflicts}`
   });

   ui.alert("Health Check Complete",
     `1. Registry: ${newIdsCount} new IDs recorded.\n` +
     `2. Data Drift: ${totalStats.updates} updates applied automatically. ${totalStats.drifts} rows require Manual Review.\n` +
     `3. Conflicts: ${totalStats.conflicts} detected.\n\n` +
     `Check Audit Log for specific row-by-row details.`, ui.ButtonSet.OK);

 } catch (e) {
   console.error(e);
   if (typeof alertUser === "function") {
     alertUser("Health Check Error", "The check failed at a critical step: " + e.message);
   } else {
     ui.alert("Health Check Error", e.message, ui.ButtonSet.OK);
   }
 }
}
/**
* THE RECONCILER: Evaluates Data Drift & Applies The Decision Matrix
*/
function reconcileDataDrift(params) {
 const { stageName, sourceSheet, destSheet, sourceMap, destMap, sKey, dKey, fields, checkByFingerprint } = params;
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sSht = ss.getSheetByName(sourceSheet);
 const dSht = ss.getSheetByName(destSheet);
 const CONFIG = getGlobalConfig();
  let stats = { checked: 0, updates: 0, drifts: 0 };
 if (!sSht || !dSht) return stats;

 const sData = sSht.getDataRange().getValues();
 const dData = dSht.getDataRange().getValues();

 // Map Destination for quick lookup
 const dLookup = new Map();
 for (let i = 1; i < dData.length; i++) {
   const id = dData[i][destMap[dKey]];
   if (id) dLookup.set(id, { row: dData[i], idx: i + 1 });
 }

 for (let i = 1; i < sData.length; i++) {
   const sRow = sData[i];
   const id = sRow[sourceMap[sKey]];
   if (!id || !dLookup.has(id)) continue;
   stats.checked++;

   const match = dLookup.get(id);
   let driftLog = [];

   // ==========================================
   // STEP 1: DETECT DRIFT (Fingerprint vs Manual)
   // ==========================================
   if (checkByFingerprint && sourceMap.SyncHash !== undefined && destMap.SyncHash !== undefined) {
     const sHash = sRow[sourceMap.SyncHash];
     const dHash = match.row[destMap.SyncHash];
     if (sHash !== dHash) driftLog.push(`Fingerprint Changed: [${dHash}] ➔ [${sHash}]`);
   } else if (fields && fields.length > 0) {
     fields.forEach(field => {
       let dField = field;
       if (field === "EventName" && destMap.Title !== undefined) dField = "Title";
       if (field === "Venue" && destMap.Location !== undefined) dField = "Location";

       const sVal = normalizeForComparison(sRow[sourceMap[field]]);
       const dVal = normalizeForComparison(match.row[destMap[dField]]);
       if (sVal !== dVal) driftLog.push(`${field}: [${dVal}] ➔ [${sVal}]`);
     });
   }

   // If no drift, move on.
   if (driftLog.length === 0) continue;

   // ==========================================
   // STEP 2: THE DECISION MATRIX
   // ==========================================
  
   // Grab Row Options safely (if the sheet has an Options column)
   const optionsCell = destMap.Options !== undefined ? match.row[destMap.Options] : "";
   const isBypass = checkOption(optionsCell, "Bypass");
   const isAutoSync = checkOption(optionsCell, "AutoSync") || CONFIG.PushAll;

   // SCENARIO A: Row is set to BYPASS
   if (isBypass) {
     applyStatus(dSht, match.idx, "Bypassed", destMap, {
       id: id, stage: stageName,
       details: "IGNORING DRIFT (Bypass Active). " + driftLog.join(" | ")
     });
     continue;
   }

   // SCENARIO B: Auto-Update Approved
   if (isAutoSync) {
     // 1. Overwrite the actual data fields
     if (fields) {
       fields.forEach(field => {
         let dField = field;
         if (field === "EventName" && destMap.Title !== undefined) dField = "Title";
         if (field === "Venue" && destMap.Location !== undefined) dField = "Location";
         dSht.getRange(match.idx, destMap[dField] + 1).setValue(sRow[sourceMap[field]]);
       });
     }
    
     // 2. Overwrite the SyncHash so it doesn't trigger again
     if (checkByFingerprint && destMap.SyncHash !== undefined) {
       dSht.getRange(match.idx, destMap.SyncHash + 1).setValue(sRow[sourceMap.SyncHash]);
     }

     applyStatus(dSht, match.idx, "Synced", destMap, {
       id: id, stage: stageName,
       details: "AUTO-UPDATED: " + driftLog.join(" | ")
     });
     stats.updates++;
   }
  
   // SCENARIO C: Not Auto - Flag for Manual Review
   else {
     applyStatus(dSht, match.idx, "Manual Review", destMap, {
       id: id, stage: stageName,
       details: "DRIFT DETECTED: " + driftLog.join(" | ")
     });
     stats.drifts++;
   }
 }
  return stats;
}

/**
* REPAIR: Removes duplicates based on UUID.
*/
function repairCrewCalendarLog() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sheet = ss.getSheetByName("Crew_Calendar_Log");
 if (!sheet) return;

 const data = sheet.getDataRange().getValues();
 const headers = data.shift();
 const uniqueRows = [];
 const seenIds = new Set();

 data.forEach(row => {
   const uuid = row[CREWCALMAP.UUID];
   if (uuid && !seenIds.has(uuid)) {
     uniqueRows.push(row);
     seenIds.add(uuid);
   }
 });

 sheet.clearContents();
 sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
 if (uniqueRows.length > 0) {
   sheet.getRange(2, 1, uniqueRows.length, headers.length).setValues(uniqueRows);
 }
 notify(`Cleaned ${data.length - uniqueRows.length} duplicates.`, "Repair");
}


/**
* Utility to grab a clean vertical array from a sheet
*/
function getCleanColumn(data, colIdx, skipRows = 1) {
 return data.slice(skipRows)
   .map(row => row[colIdx])
   .filter(val => val !== "" && val !== null && typeof val !== 'undefined');
}

```

7. HashProvider.gs  
   1. Purpose: Hashing/Fingerprinting: Any function that creates a unique string from an array of data.  
   2. \[x\] Add HashProvider: Explicitly document the hashing algorithm (e.g., Utilities.computeDigest).  
   3. scriptLib.Crypto \= {  
      1. getFingerprint: function(fieldsArray)  
      2. getHash: function(fieldsArray)  
   4. repopulateSheetHashes(sheetName, MAP)  
   5. repairAllSystemHashes()  
   6. generateHash(row, map, fields \= \["Title", "Date", "Start", "Location"\])

```javascript
/**
* scriptLib.Crypto
* Unified methods for generating hashes and fingerprints.
*/
Crypto = {
  
   /**
    * Creates a standardized, normalized pipe-delimited string.
    * Perfect for human-readable tracking or fuzzy matching.
    */
   getFingerprint: function(fieldsArray) {
       return fieldsArray
           .map(field => normalize(field))
           .join("|");
   },

   /**
    * Creates an 8-character MD5 hash from an array of fields.
    * Perfect for strict SyncHash columns and DB-style reconciliation.
    */
   getHash: function(fieldsArray) {
       const rawString = this.getFingerprint(fieldsArray);
       const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, rawString);
       return Utilities.base64Encode(signature).slice(0, 8);
   }
};

function generateHash(row, map, fields = ["Title", "Date", "Start", "Location"]) {
 const rawString = fields
   .map(field => String(row[map[field]] || "").trim().toLowerCase())
   .join("|");
  const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, rawString);
 return Utilities.base64Encode(signature).slice(0, 8);
}

/**
* Universal utility to populate or repair hashes on any sheet.
* @param {string} sheetName - e.g., "Crew_Calendar_Log"
* @param {Object} MAP - The mapping constant for that sheet (e.g., CREWCALMAP)
*/
function repopulateSheetHashes(sheetName, MAP) {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sheet = ss.getSheetByName(sheetName);
 if (!sheet) return;

 const data = sheet.getDataRange().getValues();
 const range = sheet.getRange(2, MAP.SyncHash + 1, data.length - 1, 1);
 const newHashes = [];

 for (let i = 1; i < data.length; i++) {
   const row = data[i];
  
   // We create a unique string based on the core event data
   // Usually: Title + Date + Start + Location
   const rawString = [
     row[MAP.Title],
     row[MAP.Date],
     row[MAP.Start],
     row[MAP.Location]
   ].join("|").toLowerCase();

   // Create the 8-character MD5 fingerprint
   /*const hash = Utilities.base64Encode(
     Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, rawString)
   ).slice(0, 8); */
   const hash = Crypto.getHash(rawString);


   newHashes.push([hash]);
 }

 // Batch write to the SyncHash column for speed
 if (newHashes.length > 0) {
   range.setValues(newHashes);
 }
  console.log(`Repopulated ${newHashes.length} hashes for ${sheetName}`);
}

function repairAllSystemHashes() {
 //const ui = SpreadsheetApp.getUi();
  // 1. Repair Crew Log
 repopulateSheetHashes("Crew_Calendar_Log", CREWCALMAP);
  // 2. Repair Venue Log
 repopulateSheetHashes("Venue_Cal_Log", VENUECALMAP);
  // 3. Repair Lineup (If your LINEUPMAP has a SyncHash)
 if (typeof LINEUP_MAP !== 'undefined' && LINEUP_MAP.SyncHash !== undefined) {
   repopulateSheetHashes("Lineup", LINEUP_MAP);
 }

 console.log("System Refresh Complete: All SyncHashes have been regenerated.");
}

```

8. UI.gs  
   1. Purpose: move any generic UI functionality here  
   2. Perhaps this can be a way to centralize when things go to console.log vs trigger actual UI?  
   3. 

# engine.md v2

# engine.md

## Scheduler v2: primary library for tester.sheets

1. # The Sync Sequence

   1. Syncs MUST always follow the `Pull -> Reconcile -> Push` sequence to prevent double-booking physical venues.  
   2. Audit Stages: (Is this just Sheet Policy / Custom Mode?)  
      1. SYSTEM: System Initialization & Startup Error Checking?  
      2. HEALTH\_CHECK: Maps, Settings, lookup, status etc  
      3. PULL: Pull Calendar Updates to Venue\_Cal\_Log or Crew\_Cal\_Log  
      4. RECONCILE: Check and log/report for inconsistencies or discrepancies (see: log types)  
         1. Identify "Drifts" (mismatches) and "Conflicts" (double-bookings).  
      5. PUSH: When Sheet Policy/Behavior/Options and Calendar Behaviors allow, update Calendar Events with information from their assigned row

2. # Mode Awareness: 

   1. Any script performing a write operation to Google Calendar MUST first verify ctx.modes\[ctx.modeName\].writeToCalendar before executing the API call.

3. # The Logic Hierarchy (Decision Tree)

   The Engine makes decisions by checking settings in this specific order. A more specific rule always overrides a general one.  
   1. Mode Awareness (Global):   
      1. Is the script in MODE\_LOG\_ONLY? If so, kill all write operations. (Source: Modes tab)  
      2. or Run Custom Sync   
      3. Mode is a combination of options/policies/behaviors  
   2. Sheet Policy (Local): Is the sheet set to READ\_ONLY or OVERWRITE\_ALLOWED? (Source: Sheet\_Settings tab)  
   3. Row Exception (Individual): Is this specific row marked "Manual Review" or "LOCKED"? If so, skip it. (Source: The options column for any row) 

4. # FILE: **engine\_core.gs**

   1. ## Goals: 

      1. Helps define the relationships between fields  
         1. Define a status, sheet\_schema, a log, a map, etc because even though they are in the sheet something in the code needs to know how to make those relationships  
         2. SheetSchema / Sheet\_Settings  
            1. IdKey / unique id field  
            2. Sheet.map  
               1. map.fieldName  
               2. map.columnID  
               3. map.Header  
               4. map.description   
            3. Sheet policies/options   
            4. Tab Name  
            5. Sheet Description   
            6. Sheet status   
         3. Some of these currently hardcoded definitions can be written in a temporary repair/initialize function   
         4. Parent.Lineup.Call  
            1. Parent.eventID  
            2. Lineup.eventID  
            3. Call.EventID  
         5. ID Schema  
            1. ID Type  
            2. ID.parent  
            3. ID.child\[\]  
            4.   
         6. EventID.idRef  
         7. Status  
            1. Status.colorName  
            2. Status.colorHex   
            3. Status.description   
            4. Status.behavior: when this status is applied, this row exception should be assigned to the appropriate row updateDetails.exceptions  
               1. If a row has a status of "Manual Review," the engine should extract that row’s UUID and add it to a ctx.runtimeBypassList. This ensures that even if a "Batch Sync" is called, the core logic automatically skips that ID without needing to check the sheet again during the loop.  
         8. Idea/Goal: globally define scriptLib to make calling those functions easier.  
      2. Config.gs defines the structure, and engine\_core.gs builds the ctx (Context) object that gets passed to every other function.  
      3. Eventually: UI and functions that allow for “custom context” which would be helpful in developing goSync(context)   
      4. onEdit(e) triggers appendLog(logData, logOptions)   
   2. Action: Initializes the ctx (Context) object at the start of any run.  
      1. Config.loadDynamicMaps() loads Map\_Registry into memory (column maps for sheets and header naming)  
      2. Config.getGlobalConfig() Loads ControlPanel settings (app & operation settings)  
         1. \[ \] Sync Window: Implement the startDays/endDays logic from ControlPanel into the getEventsToSync() query to prevent the script from scanning years of historical data.  
      3. loads Status (defines status, status color, status behaviors)  
      4. loads lookup (lookup lists for dropdown menus)   
         1. Venue  
         2. CallType  
         3. Series  
         4. CrewStaff  
         5. OptionsSheetPolicy:  
            1. Sheet Behavior (from Sheet\_Settings) is the **Policy** (e.g., "This sheet is Read-Only").   
         6. RowException/Behaviors  
            1. Row Behavior (from Status) is the **Exception** (e.g., "This specific row is Locked/Bypassed"). Your sync engine should check Row Behavior first, then fallback to Sheet Behavior.  
         7. Log Types  
      5. Config. loadSheetSettings() loads Sheet\_Settings (replaces master ID schema)   
         1. Sheet Name  
         2. Unique ID field for sheet  
         3. Sheet options behaviors  
      6. Config.mode —-\> new sheet/map that defines modes and what options or behaviors are associated with that mode. Is mode the same as customContext? Or is that what getMode(mode) returns?  
   3. *Triggers:* Provides data and options to the other engines.  
   4. Functions: What does this logic replace? What needs added to this from existing code? What needs to move to scriptLib?   
      1. getProjectContext(): Returns the ctx object as JSON. The UI will use this to build dropdowns and know which columns to display without making multiple server calls  
      2. getContext: function()  
      3. Status: {  
         1. apply: function(ctx, sheet, rowIdx, statusName, logContext \= {})  
         2. hasBehavior: function(ctx, statusName, targetBehavior)  
      4. Log: {  
         1. write: function(ctx, params)  
      5. Engine.Data \= {  
         1. saveRecord: function(ctx, sheetName, id, dataArray)  
      6. A master buildContext() function in engine\_core.gs that runs *once* per execution. It should fetch Config.getGlobalConfig(), Config.loadDynamicMaps(), and the Lookup / Status rules, packaging them into one ctx object.  
         1. \[ \] Refine buildContext(): Ensure it pulls statusBehaviors into a key-value pair for O(1) lookup during sync: ctx.rules.behaviors\['Manual Review'\] \= 'BYPASS'.  
         2. \[ \] Immutable Context: Ensure ctx is treated as read-only once initialized.  
      7. defaultContext \= hardcoded settings to write to sheet\_settings or controlpanel when empty values are present. May only be used for development 

```javascript
/* GLOBAL CONSTANTS
* Use these for initializing 'System' sheets that the Engine requires to boot. getContext will update this with current values
*/
const S_SYS = {
 CONTROL: "ControlPanel",
 REGISTRY: "Map_Registry",
 SETTINGS: "Sheet_Settings",
 STATUS: "Status",
 AUDIT: "Audit_Log",
 LOOKUP: "Lookup",
 ID_LOG: "idLog"
};
/**
* FILE: Engine_Core.gs
* PURPOSE: Central Context, Logging, and Status Management.
*/

var Engine = {
 /**
  * Initializes the context (ctx).
  * This is called at the top of every main function.
  */
 getContext: function() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 1. Minimal Init
 let ctx = {
   ss: ss,
   sheets: {}, // Initialize empty so assembleSheetMap can fill it
   runtime: { bypassList: [], isCustom: false, reportOnly: false }
 };

 // 2. Map everything first (This fills ctx.sheets)
 this.assembleSheetMap(ctx);

 // 3. Load logic that depends on maps
 ctx.config = this.loadConfig(ss);
 ctx.status = this.loadStatusRules(ss);
 ctx.lookup = this.loadLookups(ctx); // Pass the whole ctx!

 ctx.runtime.bypassList = this.loadBypassList(ctx);

 // 4. Helper: Add a 'get' method directly to ctx for easy sheet access
   ctx.get = (sheetName) => ss.getSheetByName(sheetName);

 return ctx;
},

 /**
  * Reads 'ControlPanel' to set global variables
  */
 loadConfig: function(ss) {
   const sheet = ss.getSheetByName("ControlPanel");
   const data = sheet.getDataRange().getValues();
   let config = { mode: "Draft 26-27", syncWindow: { start: 14, end: 365 }, defaultDuration: 2 };

   data.forEach(row => {
     const nam = row[0];
     const key = row[1]; //added this as a code friendlier way to name and rename keys
     const val = row[2];
     if (key === "Mode") config.mode = val;
     if (key === "StartSync") config.syncWindow.startDays = Number(val);
     if (key === "EndSync") config.syncWindow.endDays = Number(val);
     if (key === "defaultDuration") config.defaultDuration = Number(val);
   });
   return config;
 },

 /**
  * Reads 'Status' to understand behavior for different row states
  */
 loadStatusRules: function(ss) {
   const sheet = ss.getSheetByName("Status");
   if (!sheet) return {};
   const data = sheet.getDataRange().getValues();
   data.shift();
   let rules = {};
   data.forEach(row => {
     if (!row[0]) return;
     rules[row[0]] = { hex: row[2], behavior: row[4] };
   });
   return rules;
 },

 /**
  * NEW: loadLookups
  * 1. Maps Venue Names to Calendar IDs
  * 2. Loads Dropdown lists (Call Types, etc.)
  */
 loadLookups: function(ctx) {
   let lookups = { calendars: {}, lists: {} };
   const ss = ctx.ss;


   // 1. Process Calendars
   const calSheet = ss.getSheetByName("Calendars");
   if (calSheet) {
     const calData = calSheet.getDataRange().getValues();
     calData.shift(); // Remove headers
     calData.forEach(row => {
       const calId = row[1];
       const venueName = row[2];
       if (venueName && calId) lookups.calendars[venueName] = calId;
     });
   }

   // 2. Process Lookup Lists using ctx.sheets["Lookup"].map
     const listSheet = ss.getSheetByName("Lookup");
     const lookupSheetObj = ctx.sheets["Lookup"];
    
     if (listSheet && lookupSheetObj && lookupSheetObj.map) {
       const listData = listSheet.getDataRange().getValues();
       const map = lookupSheetObj.map;

       Object.keys(map).forEach(fieldName => {
         const colIdx = map[fieldName].index;
         lookups.lists[fieldName] = scriptLib.getCleanColumn(listData, colIdx);
       });
     }
 return lookups;
},

 /**
  * Assembles the sheets and their column maps
  */
 assembleSheetMap: function(ctx) {
   const settingsSheet = ctx.ss.getSheetByName("Sheet_Settings");
   const mapSheet = ctx.ss.getSheetByName("Map_Registry");
   if (!settingsSheet || !mapSheet) return;

   const settingsData = settingsSheet.getDataRange().getValues();
   settingsData.shift();
  
   const mapData = mapSheet.getDataRange().getValues();
   mapData.shift();

   settingsData.forEach(row => {
     const sheetName = row[0];
     if (!sheetName) return;

     ctx.sheets[sheetName] = {
       settings: { idKey: row[1], behavior: row[2], syncMode: row[3], isProtected: row[4] === "Yes" },
       map: {}
     };

     mapData.filter(m => m[0] === sheetName).forEach(m => {
       ctx.sheets[sheetName].map[m[1]] = { index: m[2], header: m[4] };
     });
   });
 },

 /**
  * Scans idLog for any ID marked as 'Bypassed'
  */
 loadBypassList: function(ctx) {
   const sheet = ctx.ss.getSheetByName("idLog");
   if (!sheet) return [];
  
   const data = sheet.getDataRange().getValues();
   const headers = data.shift();
   const idIdx = headers.indexOf("UniqueID");
   const statusIdx = headers.indexOf("SyncStatus");

   if (idIdx === -1 || statusIdx === -1) return [];

   return data
     .filter(row => row[statusIdx] === "Bypassed")
     .map(row => row[idIdx]);
 },

 Status: {
   apply: function(ctx, sheetName, rowIdx, statusName, logContext = {}) {
     const sheet = ctx.ss.getSheetByName(sheetName);
     const sheetObj = ctx.sheets[sheetName];
     if (!sheet || !sheetObj) return;

     const theme = ctx.status[statusName] || { hex: "#ffffff", behavior: "DEFAULT" };
     const now = new Date();
     const map = sheetObj.map;

     // Update columns based on Map_Registry
     if (map.SyncStatus) sheet.getRange(rowIdx, Number(map.SyncStatus.index) + 1).setValue(statusName);
     if (map.LastSynced) sheet.getRange(rowIdx, Number(map.LastSynced.index) + 1).setValue(now);
    
     if (logContext.details && map.UpdateDetails) {
        sheet.getRange(rowIdx, Number(map.UpdateDetails.index) + 1).setValue(logContext.details);
     }

     sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).setBackground(theme.hex);

     Engine.Log.write(ctx, {
       stage: logContext.stage || "STATUS_UPDATE",
       sheetName: sheetName,
       rowIdx: rowIdx,
       id: logContext.id || "N/A",
       type: statusName,
       details: logContext.details || `Status changed to ${statusName}`
     });
   }
 },

 Log: {
   write: function(ctx, params) {
     const auditSheet = ctx.ss.getSheetByName("Audit_Log");
     if (!auditSheet) return;

     const { stage, sheetName, rowIdx, id, type, details } = params;
     const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd HH:mm:ss");
    
     const logRow = [timestamp, stage || "SYSTEM", sheetName || "N/A", rowIdx || "N/A", id || "N/A", type || "INFO", details || ""];

     auditSheet.insertRowAfter(1);
     auditSheet.getRange(2, 1, 1, logRow.length).setValues([logRow]);
   }
 },
/**
  * Universal Sheet Accessor
  * Returns both the GAS Sheet object AND its registry mapping
  */
 loadSheet: function(ctx, sheetName) {
   return {
     ref: ctx.ss.getSheetByName(sheetName),
     schema: ctx.sheets[sheetName]
   };
 },

 /**
  * Finds a column index by its FieldName for a specific sheet
  */
 getCol: function(ctx, sheetName, fieldName) {
   const sheet = ctx.sheets[sheetName];
   if (sheet && sheet.map[fieldName]) {
     return sheet.map[fieldName].index;
   }
   console.error(`Field ${fieldName} not found in map for ${sheetName}`);
   return -1;
 }



};


```

5. # FILE: **engine\_ingest.gs**

   1. *Goal: Handle spreadsheet data, convert the imported data to individual events, prepare the lineup for adopting an event or moving to the draft season calendar or crew calendar (see lineup options*  
      1. *The Parser & Data Pipeline*  
   2. *Trigger:*   
      1. *user input (currently menu UI in onopen.gs)*  
      2. *If context allows, autoUpdate (and log the change/addition/deletion)*   
   3. *Action:*   
      1. Converts raw Import \-\> Parent Lineup \-\> Lineup \-\> Crew Log.  
      2. If existing data is present, goSync? Or UI choice \-\> goSync   
         1. During goParent \-\> goLineup, you need a "Collision Policy." If a user manually edited a Note in the Lineup sheet, and you re-run goLineup, will the engine overwrite the manual note  
         2. Recommendation: During goLineup, if a childID already exists, perform a **Field-Level Reconcile** rather than a row overwrite.  
            1. Behavior: If ctx.maps.Lineup.ShowNotes is marked as "User Owned" in your Map\_Registry, the ingest engine should never overwrite it, even if the source data changed.  
   4. *Method:* They use scriptLib.reconcileSheets (or reconcileByFingerprint) to move the arrays of data from one sheet to the next.  
   5. *Result:* At the end of goLineup(), the Crew\_Calendar\_Log is fully updated with the latest sheet data, but the Google Calendars haven't been touched yet.  
   6. Functions: What does this logic replace? What needs added to this from existing code? What needs to move to scriptLib?   
      1. goParent() write/update Parent Lineup   
         1. will call scriptLib.reconcileSheets() using the ctx.maps to process the data arrays in memory.  
      2. goLineup() write/update Lineup using scriptLib.ParseComplexDatesAndTimes  
         1. will call scriptLib.reconcileSheets() using the ctx.maps to process the data arrays in memory.  
      3. **goCrewLog() is this the same as verify crewLog and calendar?**  
         1. will call scriptLib.reconcileSheets() using the ctx.maps to process the data arrays in memory.  
         2. This should be the only function that assigns a sourceID. It acts as the "Traffic Controller" between Calls and Lineup.

```javascript
// At the top of engine_calendar.gs, engine_sync.gs, etc.
var Engine = Engine || {};

/**
* STAGE 1 & 2: Moves data from 'import' to 'Parent Lineup'.
* Fixes: ReferenceError by initializing 'ctx'.
*/
function goParent() {
 const ctx = Engine.getContext();
 const ss = ctx.ss;
 const iSheet = ss.getSheetByName("import");
 const pSheet = ss.getSheetByName("Parent Lineup");
  if (!iSheet || !pSheet) {
   Lib.notify("Import or Parent Lineup sheet not found.", "Error");
   return;
 }

 const iMap = ctx.maps["import"];
 const pMap = ctx.maps["Parent Lineup"];
 const iData = iSheet.getDataRange().getValues();
 const pData = pSheet.getDataRange().getValues();
  iData.shift(); // Remove headers

 // Map existing Parent events by Name for quick lookup
 const pLookup = {};
 pData.forEach((row, idx) => {
   const name = row[pMap.EventName];
   if (name) pLookup[name] = { rowIdx: idx + 1, id: row[pMap.parentID] };
 });

 iData.forEach((iRow) => {
   const eventName = iRow[iMap.EventName];
   if (!eventName) return;

   const existing = pLookup[eventName];
  
   // Prepare the data row using the Map Registry indices
   let rowArray = new Array(Object.keys(pMap).length).fill("");
   rowArray[pMap.EventName]    = eventName;
   rowArray[pMap.Series]       = iRow[iMap.Series];
   rowArray[pMap.Opening]      = iRow[iMap.Opening];
   rowArray[pMap.Range]        = iRow[iMap.Range];
   rowArray[pMap.DatesAndTimes]= iRow[iMap.IndividualDatesAndTimes];
   rowArray[pMap.Venue]        = iRow[iMap.Venue];
   rowArray[pMap.Pricing]      = iRow[iMap.Pricing];
   rowArray[pMap.ShowNotes]    = iRow[iMap.ShowNotes];

   if (existing) {
     // UPDATE: Record already exists
     rowArray[pMap.parentID] = existing.id;
     pSheet.getRange(existing.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
   } else {
     // INSERT: New event
     rowArray[pMap.parentID] = "P-" + Utilities.getUuid().split('-')[0].toUpperCase();
     rowArray[pMap.SyncStatus] = "Active";
     pSheet.appendRow(rowArray);
   }
 });

 Lib.notify("Parent Lineup Updated", "Success");
}

/**
* STAGE 3: Explodes Parent Lineup into individual events in the Lineup sheet.
*/
function goLineup() {
 const ctx = Engine.getContext();
 const ss = ctx.ss;
 const pSheet = ss.getSheetByName("Parent Lineup");
 const lSheet = ss.getSheetByName("Lineup");
  const pMap = ctx.maps["Parent Lineup"];
 const lMap = ctx.maps["Lineup"];
 const pData = pSheet.getDataRange().getValues();
 const lData = lSheet.getDataRange().getValues();
  pData.shift();

 // Create lookup for existing children to avoid duplicates
 const existingRecords = {};
 lData.forEach((row, idx) => {
   const key = `${row[lMap.parentID]}|${row[lMap.RawDateStr]}`;
   existingRecords[key] = { rowIdx: idx + 1, uuid: row[lMap.UUID] };
 });

 pData.forEach((pRow) => {
   const parentID = pRow[pMap.parentID];
   const rawDates = pRow[pMap.DatesAndTimes];
   if (!parentID || !rawDates) return;

   // parseDatesFromRange is assumed to be in your scriptLib
   const performanceDates = parseDatesFromRange(String(rawDates));

   performanceDates.forEach((dObj, index) => {
     const dateStr = Utilities.formatDate(dObj, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
     const lookupKey = `${parentID}|${dateStr}`;
     const record = existingRecords[lookupKey];

     let rowArray = new Array(Object.keys(lMap).length).fill("");
     rowArray[lMap.EventName]    = pRow[pMap.EventName];
     rowArray[lMap.parentID]     = parentID;
     rowArray[lMap.Date]         = dObj;
     rowArray[lMap.RawDateStr]   = dateStr;
     rowArray[lMap.EventOfTotal] = `${index + 1} of ${performanceDates.length}`;
     rowArray[lMap.Venue]        = pRow[pMap.Venue];

     if (record) {
       rowArray[lMap.UUID] = record.uuid; // Preserve UUID
       lSheet.getRange(record.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
     } else {
       rowArray[lMap.UUID] = Lib.uuid(); // Generate new child ID [cite: 13]
       rowArray[lMap.SyncStatus] = "Draft";
       lSheet.appendRow(rowArray);
     }
   });
 });

 Lib.notify("Lineup Explosion Complete", "Success");
}

```

6. # FILE: **engine\_calendar.gs**

   1. *Goal: Handle Calendar sync functions and options*  
      1. engine\_sync.gs handles *Sheet-to-Sheet* syncing (like Calls to Crew Log), while engine\_calendar.gs handles strictly *Sheet-to-Google Calendar* syncing*.*  
   2. *Action:* It loads the Crew\_Calendar\_Log or Venue\_Cal\_Log array into memory for comparison against Google calendar events   
   3. *Execution:* It loops through the array, matching Sheet rows to Calendar Events. If they don't match, it passes the row and the event to handleSyncDrift() (which we rewrote above).  
      1. **Crucial Distinction:** In theater, the "Venue Calendar" (Master) often differs from the "Production Calendar" (Internal).  
      2. • **Logic:** If Venue\_Cal\_Log shows a conflict (two shows in the Ballroom), engine\_calendar should not "fix" it. It should flag it as Manual Review in the SyncStatus column and post to the Audit\_Log.  
      3. The Venue\_Cal\_Log should be treated as a "Reference" sheet. If a conflict is found there, it triggers a Manual Review status in the Lineup or Calls sheet. **Never let the script automatically delete a Venue Calendar event.**  
   4. *Resolution:* handleSyncDrift alters the array. Once the loop is done, goSync() does **one single batch write** (setValues) to save all statuses ("Pulled", "Pushed", "Manual Review") back to the Crew\_Calendar\_Log at once.  
   5. Engine.Calendar \= {  
      1. pullCalendarEvents: function(ctx, calendarId, venueName, map, startDate, endDate) Fetches events from a single calendar and maps them to an array.  
      2. getEventDetails: function(eventID) Retrieves event data from google calendar for a single event  
      3. syncRow: function(ctx, sheetName, rowIdx, rowData) Pushes a sheet row to the Google Calendar.  
   6. Functions: What does this logic replace? What needs added to this from existing code? What needs to move to scriptLib?   
      1. See uploaded code  
      2. verifyCrewLogAndCalendar (see notes under engine\_ingest)  
      3. handleSyncDrift() that updates arrays in memory instead of pinging the sheet directly.  
      4. getEventDetails(eventID) return details (or why don’t I need this with the engine\_calendar)  
         1. **(updateEvent vs handleSyncDrift):** updateEvent should be a low-level scriptLib function that just talks to the API. handleSyncDrift is the high-level logic that decides **what** to update based on the Lookup behaviors (e.g., "Prefer Update from Source").  
      5. writeEvent(callID??)  
      6. updateEvent(eventID, updateData) is this the same thing as handleSyncDrift?   
      7. GetEvents(calendarID)  
      8. getCalendarID(calendar name) or from lookup

```javascript
// ==============================================================================
// FILE: engine_calendar.gs
// PURPOSE: Handles external Google Calendar API interactions (Pull & Push).
// ==============================================================================

var Engine = Engine || {}; // Safety initialization

Engine.Calendar = {

/**
  * GENERIC PULL: Fetches events from a single calendar and maps them to an array.
  * Does NOT write to sheets. Keeps Engine.Calendar pure.
  * * @param {Object} ctx - The master context object.
  * @param {string} calendarId - The Google Calendar ID.
  * @param {string} venueName - The friendly venue name (for mapping).
  * @param {Object} map - The column map for the target sheet (e.g., Venue_Cal_Log map).
  * @param {Date} startDate - Start of sync window.
  * @param {Date} endDate - End of sync window.
  * @returns {Array[]} Array of mapped row data.
  */
 pullCalendarEvents: function(ctx, calendarId, venueName, map, startDate, endDate) {
   let rows = [];
   try {
     const cal = CalendarApp.getCalendarById(calendarId);
     if (!cal) return rows;

     const events = cal.getEvents(startDate, endDate);
    
     // Determine max array length from map to prevent index out of bounds
     const maxCols = Math.max(...Object.values(map)) + 1;

     events.forEach(event => {
       let row = new Array(maxCols).fill("");
      
       row[map.EventID] = event.getId();
       row[map.Title] = event.getTitle() || "No Title";
       row[map.Date] = event.getStartTime();
       row[map.Start] = event.getStartTime();
       row[map.End] = event.getEndTime();
       row[map.Location] = venueName;
       row[map.Description] = event.getDescription();
       row[map.Source] = cal.getName();
      
       // Use the raw Google Event ID for both ID and UUID to prevent redundancy
       if (map.UUID !== undefined) row[map.UUID] = event.getId(); //This is fine for now but may be replaced with a way to associate Calls or Lineup(rows) with a calendar log
      
       row[map.LastSynced] = new Date();
       row[map.SyncStatus] = "Pulled from Calendar"; // Matches Status.csv (finally) but how is this updating our log or using our applyStatus functionality? Check in engine sync since this is still just an array value

       rows.push(row);
     });
   } catch (e) {
     console.error(`Error fetching calendar ${calendarId}: ${e.message}`);
   }
   return rows;
 },

 /**
  * Retrieves event data from google calendar for a single event
  */
   getEventDetails: function(eventID){


   },

 /**
  * Pushes a sheet row to the Google Calendar.
  */
 syncRow: function(ctx, sheetName, rowIdx, rowData) {
   const venueName = rowData[map.Venue];
   const calendarId = ctx.venues[venueName] || ctx.config.DefaultCalendarID;
  
   const map = ctx.maps[sheetName];
   if (!map) return;

   
   const cal = CalendarApp.getCalendarById(calendarId);
   if (!cal) {
     Engine.Log.write(ctx, { type: "ERROR", details: `Calendar not found: ${calendarId}` });
     return;
   }

   // Use your helper from Helpers.gs/scriptLib
   const times = getValidEventTimes(ctx, rowData[map.Date], rowData[map.StartTime], rowData[map.EndTime]);
  
   if (!times.start) {
     Engine.Log.write(ctx, { type: "ERROR", details: "Invalid date/time for sync." });
     return;
   }

   // Logic for Create vs Update (Placeholder for next step)
   console.log(`Ready to sync: ${rowData[map.EventName]} to ${calendarId}`);
  
   Engine.Log.write(ctx, {
     stage: "PUSH",
     type: "SUCCESS",
     details: `Validated sync for ${rowData[map.EventName]}`
   });
 }


};

```

7. # FILE: **engine\_maintenance.gs**

   1. *Goal:*   
      1. *action logging (see log settings… controlPanel?)*   
      2. *Row/sheet status handling*   
      3. *Initialize settings (what goes in core vs maintenance)*  
      4. *Lookup and dropdown maintenance*   
      5. *Eventually: reporting*  
   2. *Triggers:* Runs nightly, via UI, or as needed to prevent errors  
      1. Scheduled  
      2. UI  
      3. onEdit(e) check / update map registry and headers  
   3. Functions: What does this logic replace? What needs added to this from existing code? What needs to move to scriptLib?   
      1. Engine.Maintenance \= {  
         1. runHealthCheck: function()  
            1. repairMapRegistry(): A function to ensure Map\_Registry indices match the actual sheet column positions.  
            2. repairHeaders()  
            3. applyDropdowns(ctx)  
            4. check / update status definitions & lookup  
         2. reset: function(options)  
         3. repairHeaders: function()  
         4. applyDropdowns: function(ctx)   
            1. Update dropdowns/datavalidation  
            2. Helper function to update lookups? Option for future UI  
      2. Engine.Maintenance.resetHeaders \= function(ctx)  
      3. repairEngineEnvironmentDefaults()  
      4. **What needs added:**  
         1. check / update status definitions & lookup   
         2. writeNewMode(options)  
         3. writeNewSheet(map, sheetSettings) or update sheet   
         4. getRecentLogs(limit): A dedicated function to pull the last 50 entries from Audit\_Log for a "System Health" dashboard in the UI.  
         5. appendLog(logData, logOptions)  
         6. clearLog \-\> UI Confirm  
         7. updateSyncStatus(sheet, rowID, statusData) —-\> return logData and updateDetails?   
         8. updateDetails {} 

```javascript
// At the top of engine_calendar.gs, engine_sync.gs, etc.
var Engine = Engine || {};

/**
* Engine_Maintenance.gs
* Handles System Health, Granular Resets, and Schema Validation.
*/
Engine.Maintenance = {

 /**
  * 1. HEALTH CHECK
  * Compares physical sheet headers against the Map_Registry.
  * Flags discrepancies before you run a sync.
  */
 runHealthCheck: function() {
   const ctx = Engine.getContext();
   const reports = [];

   Object.keys(ctx.schema).forEach(sheetName => {
     const sheet = ctx.ss.getSheetByName(sheetName);
     if (!sheet) {
       reports.push(`❌ Missing Sheet: ${sheetName}`);
       return;
     }
    
     const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
     const map = ctx.schema[sheetName].map;
    
     // Compare map keys to actual headers
     Object.entries(map).forEach(([fieldName, index]) => {
       if (headers[index] !== fieldName) {
         reports.push(`⚠️ Header Mismatch in ${sheetName}: Expected "${fieldName}" at index ${index}, found "${headers[index]}"`);
       }
     });
   });

   return reports.length > 0 ? reports : ["✅ System Healthy"];
 },

 /**
  * 2. GRANULAR RESET
  * options: { target: "SHEET_NAME", type: "HEADERS" | "CONTENT" | "FULL" }
  */
 reset: function(options) {
   const ui = SpreadsheetApp.getUi();
   const response = ui.alert('CAUTION', `Are you sure you want to reset ${options.target} (${options.type})?`, ui.ButtonSet.YES_NO);
  
   if (response !== ui.Button.YES) return;

   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(options.target);
   const ctx = Engine.getContext();
   const map = ctx.schema[options.target].map;

   switch(options.type) {
     case "HEADERS":
       // Re-write headers based on Map_Registry without touching data
       const headerRow = [];
       Object.entries(map).forEach(([name, idx]) => headerRow[idx] = name);
       sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
       break;
    
     case "SYNC_ONLY":
       // Clear only the Status and LastSynced columns
       // This lets you "re-run" a sync without deleting events
       const syncCols = [map.SyncStatus, map.LastSynced, map.UpdateDetails];
       syncCols.forEach(colIdx => {
         if (colIdx !== undefined) sheet.getRange(2, colIdx + 1, sheet.getLastRow(), 1).clearContent();
       });
       break;

     case "FULL":
       sheet.clear();
       this.reset({ target: options.target, type: "HEADERS" });
       break;
   }
  
   Engine.Log.write(ctx, { stage: "MAINTENANCE", type: "RESET", details: `${options.target} reset type: ${options.type}` });
 },
 repairHeaders: function() {
   const ctx = Engine.getContext(); // Now loads from Map_Registry sheet
   const results = [];

   Object.keys(ctx.schema).forEach(sheetName => {
     const sheet = ctx.ss.getSheetByName(sheetName);
     if (!sheet) return;

     const map = ctx.schema[sheetName].map;
     const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
     let updated = false;
     Object.entries(map).forEach(([fieldName, colIdx]) => {
       if (headers[colIdx] !== fieldName) {
         sheet.getRange(1, colIdx + 1).setValue(fieldName);
         updated = true;
       }
     });
     if (updated) results.push(`Fixed headers for ${sheetName}`);
   });
   return results;
 },

 /**
  * Refreshes Data Validation (Dropdowns) across the workbook
  * based on the lists in the 'Lookup' sheet.
  */
 applyDropdowns: function(ctx) {
   const ss = ctx.ss;
   const lookupSheet = ss.getSheetByName("Lookup");
   const lMap = ctx.maps["Lookup"];
   if (!lookupSheet || !lMap) return;

   // 1. Extract Lists from Lookup
   const lData = lookupSheet.getDataRange().getValues();
   const getList = (colIdx) => {
     return lData.slice(1) // Skip header
                 .map(row => row[colIdx])
                 .filter(val => val !== "" && val !== null);
   };

   const venueList = getList(lMap.Venue);
   const crewList = getList(lMap.Crew);
   const callTypeList = getList(lMap.CallType);
   const optionsList = getList(lMap.Options);

   // 2. Define Targets (Which sheets get which dropdowns)
   // Format: { sheetName: { columnName: list } }
   const targets = {
     "Lineup": {
       "Venue": venueList
     },
     "Crew_Calendar_Log": {
       "Staff": crewList,
       "Venue": venueList,
       "Options": optionsList
     }
   };

   // 3. Apply Validation
   for (const [sheetName, config] of Object.entries(targets)) {
     const targetSheet = ss.getSheetByName(sheetName);
     const targetMap = ctx.maps[sheetName];
     if (!targetSheet || !targetMap) continue;

     for (const [colName, list] of Object.entries(config)) {
       const colIdx = targetMap[colName];
       if (colIdx === undefined) continue;

       const range = targetSheet.getRange(2, colIdx + 1, targetSheet.getMaxRows() - 1);
       const rule = SpreadsheetApp.newDataValidation()
                                  .requireValueInList(list)
                                  .setAllowInvalid(false)
                                  .build();
       range.setDataValidation(rule);
     }
   }
  
   Engine.Log.write(ctx, { type: "MAINTENANCE", details: "Data Validation (Dropdowns) refreshed." });
 }
};

/**
* MAINTENANCE: Synchronizes physical sheet headers with the Map_Registry.
* Warning: This will overwrite Row 1 of your sheets to match your Map definitions.
*/
Engine.Maintenance.resetHeaders = function(ctx) {
 const ss = ctx.ss;
 const maps = ctx.maps;

 for (const [sheetName, columnMap] of Object.entries(maps)) {
   const sheet = ss.getSheetByName(sheetName);
   if (!sheet) {
     console.warn(`Maintenance: Sheet "${sheetName}" defined in Map_Registry not found.`);
     continue;
   }

   // Determine the max column index defined in the map
   const indices = Object.values(columnMap);
   const maxCol = Math.max(...indices);
  
   // Create a header array of the necessary length
   const newHeaders = new Array(maxCol + 1).fill("");

   // Fill the header array based on the Map_Registry keys
   for (const [headerName, colIdx] of Object.entries(columnMap)) {
     newHeaders[colIdx] = headerName;
   }

   // Apply to the sheet
   sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
   sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight("bold").setBackground("#eeeeee");
  
   Engine.Log.write(ctx, {
     stage: "MAINTENANCE",
     sheetName: sheetName,
     type: "HEADER_RESET",
     details: "Headers synchronized with Map_Registry."
   });
 }
 notify("All sheet headers have been calibrated to the Map_Registry.");
};
/**
* Scans all sheets defined in the Map_Registry and updates the 'Column Index'
* to match the current physical position of the headers in the spreadsheet.
* * Triggered by: ControlPanel 'Maintenance' toggle or manual menu.
*/
function repairMapRegistry() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const registrySheet = ss.getSheetByName("Map_Registry");
  if (!registrySheet) {
   console.error("Maintenance Error: Map_Registry sheet not found.");
   return;
 }

 const registryData = registrySheet.getDataRange().getValues();
 const registryHeaders = registryData[0];
  // Find column positions within the Map_Registry itself
 const col_sheetName = registryHeaders.indexOf("Sheet Name");
 const col_fieldName = registryHeaders.indexOf("Field Name");
 const col_index = registryHeaders.indexOf("Column Index");

 if (col_sheetName === -1 || col_fieldName === -1 || col_index === -1) {
   console.error("Maintenance Error: Map_Registry is missing required system columns.");
   return;
 }

 let repairsMade = 0;
 let missingFields = [];
 let logDetails = [];

 // Iterate through each field mapping (skipping the header row)
 for (let i = 1; i < registryData.length; i++) {
   const sheetName = registryData[i][col_sheetName];
   const fieldName = registryData[i][col_fieldName];
   const storedIndex = registryData[i][col_index];

   if (!sheetName || !fieldName) continue;

   const targetSheet = ss.getSheetByName(sheetName);
   if (!targetSheet) {
     console.warn(`Maintenance: Sheet "${sheetName}" not found in spreadsheet.`);
     continue;
   }

   // Get actual headers from the target sheet to find the new index
   const actualHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
   const actualIndex = actualHeaders.indexOf(fieldName);

   if (actualIndex === -1) {
     missingFields.push(`${sheetName} -> ${fieldName}`);
     continue;
   }

   // If the index in the registry doesn't match the physical sheet, update it
   if (actualIndex !== storedIndex) {
     registrySheet.getRange(i + 1, col_index + 1).setValue(actualIndex);
    
     const repairLog = `Moved: ${sheetName}.${fieldName} from Col ${storedIndex} to ${actualIndex}`;
     logDetails.push(repairLog);
     repairsMade++;
   }
 }

 // Finalize the process and log the results
 const summary = `Maintenance Complete. Repaired: ${repairsMade} | Missing Headers: ${missingFields.length}`;
  // Verbose logging to Audit_Log
 if (typeof postDetailedAudit === 'function') {
   postDetailedAudit(
     "SYSTEM_HEALTH",
     "Map_Registry",
     summary,
     "",
     logDetails.join(" | ")
   );
 }

 console.log(summary);
 if (missingFields.length > 0) {
   console.warn("The following fields were not found in their respective sheets:", missingFields);
 }

 // Turn off the Maintenance toggle in Control Panel if needed
 finalizeMaintenance(summary);
}

/**
* Resets the Maintenance flag in the ControlPanel and logs completion.
*/
function finalizeMaintenance(summary) {
 // Logic to find 'Maintenance' in ControlPanel and set Value to FALSE
 // This prevents the maintenance script from running every sync cycle.
}
/**
* Moved from engine_sync.gs.
* Place this inside engine_maintenance.gs or execute it only when necessary.
*/
function repairEngineEnvironmentDefaults() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const ui = SpreadsheetApp.getUi();
  const response = ui.alert("Warning", "This will rebuild default ControlPanel and Sheet_Settings. Only run this if those sheets are missing or corrupted. Continue?", ui.ButtonSet.YES_NO);
  if (response === ui.Button.YES) {
   // ... [Insert your existing setupEngineEnvironment code here, but use .appendRow or check existing data first] ...
   // 1. Setup ControlPanel Defaults

   const cpSheet = ss.getSheetByName("ControlPanel") || ss.insertSheet("ControlPanel");

   const cpDefaults = [//these definitely don't match the sheet right now
   ["Setting Field", "Value", "Description"],
   ["Mode", "Draft 26-27", "Current active operation mode"],
   ["Start Sync Date (Days before today)", 14, "Past window for sync"],
   ["End Sync Date (Days after today)", 400, "Future window for sync"],
   ["Default Event Duration Hours", 2, "Fallback duration if end time is missing"]
 ];

 cpSheet.getRange(1, 1, cpDefaults.length, 3).setValues(cpDefaults);

 // 2. Setup Sheet_Settings Defaults

 const ssSheet = ss.getSheetByName("Sheet_Settings") || ss.insertSheet("Sheet_Settings");

 const ssDefaults = [
   ["Sheet Name", "ID Key", "Behavior", "Sync Mode"],
   ["Lineup", "UUID", "SOURCE", "OVERWRITE_ALLOWED"],
   ["Calls", "CallID", "SOURCE", "OVERWRITE_ALLOWED"],
   ["Crew_Calendar_Log", "UUID", "MIRROR", "SYNC"],
   ["Venue_Cal_Log", "EventID", "PULL", "READ_ONLY"]
 ];

 ssSheet.getRange(1, 1, ssDefaults.length, 4).setValues(ssDefaults);



 // 3. Run Maintenance to align headers

 const ctx = Engine.getContext();

 Engine.Maintenance.validateHeaders(ctx); // Ensures Map_Registry matches Sheet Headers


 Lib.notify("Engine Defaults Pushed Successfully", "Setup");


   if (typeof Lib !== 'undefined' && Lib.notify) Lib.notify("Environment Repaired", "Maintenance");
 }
}

```

8. # FILE: engine\_sync.gs

   1. Example: Manual review row status causes a bypass behavior so that other functions skip until it has been manually reviewed. This behavior would be respected unless a sheet setting was “overwrite” and the confirmation UI was accepted  
      1. Need both batch(array) read/write and scan sheet vs scan array but the ids should be able to lookup and selectively replace   
   2. Goal: log & Check the status and relationship of everything, using the global/local context for decision logic  
      1. engine\_sync.gs handles *Sheet-to-Sheet* syncing (like Calls to Crew Log), while engine\_calendar.gs handles strictly *Sheet-to-Google Calendar* syncing.  
      2. Something that checks for behavior/option conflicts and eventually can present UI choice selection (especially if destructive)   
      3. Decisions:   
         1. Batch or Scanned (need ability for both)   
         2. SyncHash or Fingerprint use case (both have pros/cons but fingerprint was decided on for legibility purposes)  
         3. Row Exception/Behavior  
         4. Sheet.Policy behavior  
         5. Mode or customContext   
         6. \[ \] Conflict Logic: Define "Conflict" clearly. Is it a location conflict (Venue) or a personnel conflict (Staff)?  
   3. Trigger: UI menu   
   4. Engine.Sync \= {  
      1. runMasterSync: function()  
      2. reconcileLogs: function(ctx)  
   5. Functions  
      1. setupEngineEnvironment(context) initializes settings. Empty settings trigger UI? Or maybe temporarily initializes empty settings to a default coded value. Look for opportunities to   
      2. goSync() —\> goSync(context)   
      3. RowSync(behavior, sheet/map, rowID)   
      4. getSSEvent(sheet/map, uniqueID) return event.details   
      5. Read/write Engine.Data   
      6. bulkUpdateRows(sheetName, updates): Instead of the UI calling a "Save" function 20 times, it should send one array of updates that the engine processes in a single execution to avoid GAS timeouts.

```javascript
// ==============================================================================
// FILE: engine_sync.gs
// PURPOSE: Orchestrates the Pull, Reconcile, and Push operations for the system.
// ==============================================================================

var Engine = Engine || {};

Engine.Sync = {

 runMasterSync: function() {
   const ctx = Engine.getContext();
   Engine.Log.write(ctx, { stage: "SYNC_START", details: "Initiating Master Sync" });

   try {
     // 1. PULL: Sync Building/Venue calendars to the Venue_Cal_Log
     this.mirrorVenues(ctx);

     // 2. RECONCILE: Check for Location Conflicts or Venue Adoptions
     this.reconcileLogs(ctx);

     // 3. PUSH: Sync valid changes from Crew_Calendar_Log to Google Calendar
     this.syncCrewCalendar(ctx);

     Engine.Log.write(ctx, { stage: "SYNC_COMPLETE", details: "All phases finished." });
   } catch (e) {
     Engine.Log.write(ctx, { stage: "SYNC_ERROR", type: "ERROR", details: e.message });
   }
 },
/**
  * PHASE 1: MIRROR VENUES
  * Loops through Calendars.csv settings, uses Engine.Calendar to fetch data,
  * and batch writes to Venue_Cal_Log.
  */
 mirrorVenues: function(ctx) {
   const sheetName = "Venue_Cal_Log";
   const sheet = ctx.ss.getSheetByName(sheetName);
   const map = ctx.maps[sheetName];
   if (!sheet || !map) return;

   Engine.Core.logAudit(ctx, { stage: "PULL", sheetName: sheetName, details: "Starting Venue Mirror..." });

   // Calculate Sync Window based on ControlPanel
   const startDate = new Date();
   startDate.setDate(startDate.getDate() - (ctx.settings.ControlPanel["Start Sync Date (Days before today)"] || 14));
   const endDate = new Date();
   endDate.setDate(endDate.getDate() + (ctx.settings.ControlPanel["End Sync Date (Days after today)"] || 400));

   let allVenueEvents = [];

   // Loop through the Calendars context (Assuming ctx.calendars is built from Calendars.csv)
   // Structure expected: ctx.calendars = [{displayName: "...", id: "...", venueName: "Main Stage"}, ...]
   if (ctx.calendars) {
     ctx.calendars.forEach(calObj => {
       // Skip draft/crew calendars
       if (calObj.venueName.includes("Draft") || calObj.displayName.includes("Draft")) return;

       // Use the clean API wrapper!
       const events = Engine.Calendar.pullCalendarEvents(
         ctx,
         calObj.id,
         calObj.venueName,
         map,
         startDate,
         endDate
       );
       allVenueEvents = allVenueEvents.concat(events);
     });
   }

   // Batch write to sheet
   if (allVenueEvents.length > 0) {
     const maxCols = Math.max(...Object.values(map)) + 1;
     if (sheet.getLastRow() > 1) {
       sheet.getRange(2, 1, sheet.getLastRow() - 1, maxCols).clearContent();
     }
     sheet.getRange(2, 1, allVenueEvents.length, maxCols).setValues(allVenueEvents);
   }

   Engine.Core.logAudit(ctx, { stage: "PULL", sheetName: sheetName, details: `Mirrored ${allVenueEvents.length} events from building calendars.` });
 },

 /**
  * RECONCILE: Compares Crew_Calendar_Log against Venue_Cal_Log.
  * Identifies Venue Adoptions and flags Location Conflicts.
  */
 reconcileLogs: function(ctx) {
   const crewSheet = ctx.ss.getSheetByName("Crew_Calendar_Log");
   const vLogData = ctx.ss.getSheetByName("Venue_Cal_Log").getDataRange().getValues();
   const cMap = ctx.maps["Crew_Calendar_Log"];
   const vMap = ctx.maps["Venue_Cal_Log"];

   // Build a conflict map: "Date|Location" -> Title
   const venueOccupancy = vLogData.reduce((acc, row) => {
     const key = `${row[vMap.Date]}|${row[vMap.Location]}`;
     acc[key] = row[vMap.Title];
     return acc;
   }, {});

   const crewData = crewSheet.getDataRange().getValues();
   crewData.forEach((row, i) => {
     if (i === 0) return;
     const key = `${row[cMap.Date]}|${row[cMap.Location]}`;
     const conflictTitle = venueOccupancy[key];

     if (conflictTitle && conflictTitle !== row[cMap.Title]) {
       Engine.Status.apply(ctx, "Crew_Calendar_Log", i + 1, "Location Conflict", {
         details: `Space occupied by: ${conflictTitle}`
       });
     }
   });
 }
};


```

9. # FILE: Config.gs

   1. **Recommendation:** Keep Config.gs strictly for **Hardcoded Constants** (like the Folder ID for backups or the Script ID for scriptLib). Move all **Dynamic Loading** (reading from the Map\_Registry sheet) into engine\_core.buildContext(). This separates "settings that never change" from "settings the user can edit on the sheets."  
   2. PURPOSE:   
      1. Config.gs defines the structure, and engine\_core.gs builds the ctx (Context) object that gets passed to every other function.  
      2. Loads UI Settings, Status Colors, and the dynamic Map Registry.  
      3. Seems like much of this is going to be integrated into engine\_core.gs  
      4. Probably need to make a config.md   
      5. Define status schema? (And other schemas? Or is this on sheet\_settings or how do all these sheet things get pulled to memory ?   
   3. Functions  
      1. getGlobalConfig()  
      2. loadDynamicMaps() —-\> rename to getMapRegistry   
         1. getMap(sheetName)  
         2. getSheet(mapName)   
         3. maybe something like getRelationship(map, field1, field2)   
         4. getRowException(sheet, row)  
         5. getSheetBehavior(sheet)  
         6. getMode  
      3. runSystemHealthCheck() how is this interacting with config and sync operations  
      4. runMasterHeaderReset() compares sheet headers to Map\_Registry and updates the sheet as needed. If blank on Map\_Registry, prefer current value from sheet. Does CRUD do this?     
      5. runFirstTimeSetup() is this the same as setupEngineEnvironment(context)  
      6. loadSheetSettings()  
      7. getUIFriendlySchema(sheetName)  
   4. 

10. # FILE: UI\_helper.gs: 

    1. Purpose: move functions that only exist to allow for UI interactions and specific buttons here  
    2. Currently empty file.   
    3. See UI-Notes.md  
    4. Functions:  
       1. function findIdAndJump(id)

11. # FILE: search.gs 

    1. Does not exist yet  
    2. Intent: ways to find individual events  
    3. Return reports or UI  
    4. Functions   
       1. getParent(parentID)  
       2. getLineup(childID)  
       3. getCall(callID)  
       4. 

12. # OTHER FILES

    1. 0\_OnOpen.gs \> UI menu   
       1. onOpen()  
       2. openAuditLog()  
       3. masterAggregatorSync()  
    2. 0\_idLog.gs functions that deal with idLog sheet   
       1. registerIdInLog(id, type, title, location, parentId \= "N/A", syncHash \= "N/A")  
       2. syncIdLog()  
       3. generateAndRegisterUuid(type, title, sourceSheet)  
    3. 0\_sync calls and crew log.gs  
       1. syncCallsToCrewLog()  
       2. verifyCallsAndCrewLog()  
    4. 0\_sync crew log w cal.gs  
       1. syncCrewLogWithCalendar()  
       2. handleSyncDrift(row, map, event, isAdopted, calLastUpdated, sheetLastSynced, ctx)  
       3. verifyCrewLogAndCalendar()  
       4. finalizeCrewLogStatus()  
       5. pullCalendarUpdatesToLog(calendarId, sourceName)  
    5. 0\_sync venue cals.gs  
       1. syncVenueCalendarsToLog()  
       2. findExistingVenueEvent(plannedRow, vData)  
       3. syncPerformanceSpaces()  
    6. 0\_temp.gs functions that can be run once from the console for testing and development.   
       1. testContext()  
    7. 0\_draft season.gs \> functions specific to draft season calendar   
       1. writeNewSeason()  
       2. pullDraftCal()  
       3. wipeDraftSeasonCal()  
    8. 0\_helper.gs \> scriptLib  
       1. getParentData(identifier)  
       2. getChildData(identifier)  
       3. getRowByUuid(uuid)  
       4. getCrewCall(eventID)  
       5. getCalendar(calendarId)  
       6. getCalEvents(calendarId)  
       7. updateCCL()  
       8. updateLogFromCalendar(calendarEvent)  
       9. updateCrewCalLog()  
    9. 0\_verify.gs   
       1. verifyImport(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey)  
       2. verifyTDL(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey)  
       3. verifyEvent(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey)  
    10. e\_doublecheckme.gs  
        1. finalizeLogAndSort() this function used to serve a purpose. It could probably move to 0\_helpers.gs

# TesterSheet.md

# TesterSheet.md

## FILE: Tester

# ControlPanel: 

1. Sync Settings and default values   
2. Need initializeSheet(“ControlPanel”). This sheet might not have all of the field and value definitions that code is expecting.  
3. Need repairControlPanel()/ updateControlPanel()  
4. This sheet can currently be edited by users. Eventually it may be hidden and all of this may be interacted with by a separate UI. 

# Modes: 

1. new sheet to define customContext presets   
2. This sheet can currently be edited by users. Eventually it may be hidden and all of this may be interacted with by a separate UI.   
3. Some modes can be hardcoded. They can write to this sheet for reference but this will help with some testing consistency 

# Calendars: 

1. New sheet to define & lookup Calendar Names and IDs and associate Venue Names with them

# Sheet\_Settings: 

1. sheet definitions, properties, policies, column map array, uniqueID, etc   
2. This sheet can currently be edited by users. Eventually it may be hidden and all of this may be interacted with by a separate UI. 

# idLog: 

1. every uniqueID has a row here that helps with validation and update history   
2. See questions for clarity & response  
3. \[ \] idLog: Add a "Last Verified" timestamp to help the health check identify "ghost" events.

# Audit Log: 

1. logs every action (that has its log type is selected in ControlPanel)

# Lookup: 

1. dropdown menu lookup lists and calendarID reference   
2. Considering moving calendar ID lookup/index to a separate tab. Then the calendars could have settings/properties too

# Status: 

1. Status lookup, color, options/behaviors (these behaviors pass to the row when a status is applied)   
2. Transitioned from master sheet schema but realized we need to define a sheet schema still?  
3. This sheet can currently be edited by users. Eventually it may be hidden and all of this may be interacted with by a separate UI. 

# Map\_Registry: 

1. columnID and header lookups for every sheet  
2. Transitioned from hardcoded maps to allow for dynamic maps   
3. This sheet can currently be edited by users as a development function. Eventually it may be hidden and all of this may be interacted with by a separate UI. 

# import: 

1. import range. Source data 

# Parent Lineup: 

1. copy of source data for comparison and added fields

# Lineup: 

1. Parent Lineup \-\> parsed into individual “child” events with individual start and end times   
   1. Sometimes, for events with a single start time, a parent row will be very similar to to the child row  
   2. Need a way for Lineup to adopt existing calendar events. This would likely mostly be a read-only association with venue calendars UNLESS we are writing to the draft-season-calendar or crew calendar 

# Crew\_Calendar\_Log: 

1. The crew calendar / draft season calendar sheet sync log  
2. Any events within config.start/end range on calendar will sync to/from this spreadsheet, (options permitting)   
3. Pulls events from calls/lineup/google calendar as needed/allowed/specified  
4. Pushes events to google calendar as needed/allowed/specified

# Venue\_Calendar\_Log: 

1. Venue Calendar sheets sync log

# Calls: 

1. User edited sync sheet for Calls.  
2. Calls have a CallType   
3. may be associated with an existing Calendar Event  
   1. Need a method (UI? but a function to make the association either way) for calls to adopt calendar events. We have a column for eventID, so when a call is associated with a calendar events, that can be tracked here.   
   2. may sync (read, pull from, push to with crew\_calendar\_log depending on row options or associated calendar events  
   3. may sync (read/pull from) with venue\_cal\_log if associated with an event on the venue\_cal\_log

# UI-Notes.md

# UI-Notes.md

1. # UI Development Readiness

   1. To ensure the UI is fast and doesn't time out  
   2. JSON Endpoints: Create a getProjectContext() function that returns the ctx object. The UI (HTML Service) will call this once to understand the sheet structure without re-parsing the spreadsheet constantly.  
   3. Batching: Your UI should send "Bulk Mutation" requests. Instead of updating one row at a time, the UI should collect 10 edits and send them as a single array to a scriptLib.CRUD.updateBatch() function.

2. # UI Menu: Event Manager

   1. ## Ingest

      1. ### goParent

      2. ### goLineup

      3. ### goCrewLog

   2. ## Sync

      1. ### goSync(context) 

      2. ### Run Custom Sync —-\> Eventually UI Dialog 

      3. ### Report Mode: goSync(“report”)

   3. ## Navigation 

      1. ### \> Sheet options 

   4. ## Sheet

      1. ### Sheet Settings (eventually UI to edit active sheet settings)

      2. ### Repair (active) Sheet —\> (source of truth confirm) 

      3. ### Reset (active?) Sheet —\> UI confirm 

   5. ## Calendar 

      1. ### (If calendar log, is available) WipeCalendar(date range, “draft season calendarID”) —-\> eventually UI with choice popup 

      2. ### Write log updates to Calendar

      3. ### Pull Calendar Updates

3. # UI Sidebar: 

   1. Contextual Report: User clicks a row in "Lineup." The sidebar calls getEventDetails(uuid) and displays:  
      1. The Parent Event info.  
      2. Venue Status: "Clear" or "Conflict with \[Event Name\] on Venue Calendar."  
      3. Audit History: "Seth updated time on 04/01," "Auto-pushed to Calendar 04/02."  
   2. Bidirectional Editing: The sidebar has a "Save" button. Clicking it updates the sheet row and immediately triggers a single-row sync to the calendar, returning a "Success" toast to the user.

# old1

# Goals:

- Move helper functions that are completing a generic task to a script library for better future use  
- Organize source data and assign unique identifiers early in the process to assist with linked events from other sources or finding duplicates  
- Consolidate and Optimize the functions in the spreadsheet to work together while removing unnecessary functions  
- 

# Workbook Sheets

## Import

- Headers: Event Name, Series, Opening, Range, Individual Dates and Times, Total Events, Venue, Pricing, Pit  
- importrange from another sheet  
- source data for lineup information

## Parent Lineup

- Headers: Event Name, Series, Opening, Range, Individual Dates and Times, Total Events, Venue, Pricing, Pit, parentID, Show Notes, Event Needs  
- values from import with a unique id "parentID" assigned and a column for associated notes  
- Total Events \= number of children

## Lineup

- Headers: Parent Event, Series, Opening, Range, Individual Dates and Times, event of total events, Venue, Pricing, Pit, parentID, childID, Show Notes, Event Needs, parsedDate, parsedTime, After Today, Within Next Quarter, Within Next Month, parseStatus  
- parsed and processed data from processAdvancedSheet() and columns to compare the parsedDate with todays date

## Performance Spaces

- Headers: Event Title, Start Date, Start Time, Details, Last Updated, Location/Space, End Time, Event ID, Status, parentID, childID  
- synced data from performance calendars  
- One Way Sync: Calendar \> Sheet

## Calls:

- Headers: Parent Event, childID, Title, Rehearsal/Setup Date, Call Time, Type, Description, Staff, Series, Venue, callID, eventID  
- This sheet is used to add events to the calendar via spreadsheet. Rows added without a callID will be assigned a callID and appended to the crew calendar log

## F

- Headers: Event Name, Date, Time, Type, Description, Staff, Series, Venue, End Time, Source, Remove from Filter, Event ID  
- Filters Lineup, Calls, and Performance spaces into a single sheet. May be able to get rid of this one?

## Crew\_Calendar\_Log: 

- Headers: Event ID, Title, Date, Start, End, Location, Description, Source, sourceID, Last Synced, Sync Status, Push to Crew Calendar, Remove from Crew calendar  
- This is the master log for the crew calendar, with a couple of options for how to manage syncing.   
- It displays the current status/last action

# Functions

I will list the functions and the current code for each that are being used, along with the function specific notes I have for revisions, though there are also relevant notes along with the workbook sheets details

## processAdvancedSheet()

- Current: Working as designed  
- Helper functions used:  
  - columnToLetter(column)  
  - parseComplexDateTime(str)  
- Changes/Updates/Description:  
1. Source Sheet: “import”  
2. 1st Target sheet: “Parent Lineup”  
3. 2nd Target sheet: “Lineup”  
4. Copy Import \> Parent Lineup and assign each row a “parentID”  
5. Process Parent Lineup into Child Lineup (essentially what the original script was doing)

	

```javascript
function processAdvancedSheet() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sourceSheet = ss.getActiveSheet();
 let targetSheet = ss.getSheetByName("Test");
  if (!targetSheet) {
   targetSheet = ss.insertSheet("Test");
 }

 const range = sourceSheet.getDataRange();
 const data = range.getValues();
 const richTextData = range.getRichTextValues();
 const headers = data.shift();
 richTextData.shift();
  const idx = {
   dateTime: headers.indexOf("Individual Dates and Times"),
   afterToday: headers.indexOf("After Today"),
   nextQuarter: headers.indexOf("Within Next Quarter"),
   nextMonth: headers.indexOf("Within Next Month"),
   pianoTuning: headers.indexOf("Piano Tuning?"),
   eventName: headers.indexOf("Event Name"),
   showNotes: headers.indexOf("Show Notes")
 };

 if (idx.dateTime === -1) {
   SpreadsheetApp.getUi().alert("Error: 'Individual Dates and Times' column not found.");
   return;
 }

 const results = [];
 const eventNameRT = [];
 const showNotesRT = [];
  const parsedDateColLetter = columnToLetter(headers.length + 1);

 data.forEach((row, rowIdx) => {
   const rawCellValue = String(row[idx.dateTime] || "");
   if (!rawCellValue) return;

   const lines = rawCellValue.split('\n').map(p => p.trim()).filter(p => p !== "");
  
   lines.forEach(line => {
     const parsed = parseComplexDateTime(line);
     if (parsed.status === "Skip") return;

     const currentRowNum = results.length + 2;
     let newRow = [...row];
    
     newRow[idx.dateTime] = line;

     if (idx.afterToday > -1) newRow[idx.afterToday] = `=IF(${parsedDateColLetter}${currentRowNum} >= TODAY(), TRUE, FALSE)`;
     if (idx.nextQuarter > -1) newRow[idx.nextQuarter] = `=IF(${parsedDateColLetter}${currentRowNum} <= EOMONTH(TODAY(), 3), TRUE, FALSE)`;
     if (idx.nextMonth > -1) newRow[idx.nextMonth] = `=IF(${parsedDateColLetter}${currentRowNum} <= EOMONTH(TODAY(), 1), TRUE, FALSE)`;

     newRow.push(parsed.dateValue);
     newRow.push(parsed.timeValue);
     newRow.push(parsed.status);   
    
     results.push(newRow);

     if (idx.eventName > -1) eventNameRT.push([richTextData[rowIdx][idx.eventName]]);
     if (idx.showNotes > -1) showNotesRT.push([richTextData[rowIdx][idx.showNotes]]);
   });
 });

 targetSheet.clear();
 const newHeaders = [...headers, "Parsed Date", "Parsed Time", "Status"];
  // 1. Write and Bold Headers
 const headerRange = targetSheet.getRange(1, 1, 1, newHeaders.length);
 headerRange.setValues([newHeaders]).setFontWeight("bold");
  if (results.length > 0) {
   const outputRange = targetSheet.getRange(2, 1, results.length, newHeaders.length);
   outputRange.setValues(results);
  
   // 2. Re-apply RichText for Links
   if (idx.eventName > -1 && eventNameRT.length > 0) {
     targetSheet.getRange(2, idx.eventName + 1, eventNameRT.length, 1).setRichTextValues(eventNameRT);
   }
   if (idx.showNotes > -1 && showNotesRT.length > 0) {
     targetSheet.getRange(2, idx.showNotes + 1, showNotesRT.length, 1).setRichTextValues(showNotesRT);
   }

   // 3. Formatting
   if (idx.pianoTuning > -1) {
     targetSheet.getRange(2, idx.pianoTuning + 1, results.length, 1).insertCheckboxes();
   }

   const dateCol = headers.length + 1;
   const timeCol = headers.length + 2;
   targetSheet.getRange(2, dateCol, results.length, 1).setNumberFormat("MM/dd/yyyy");
   targetSheet.getRange(2, timeCol, results.length, 1).setNumberFormat("h:mm am/pm");
  
   targetSheet.autoResizeColumns(1, newHeaders.length);
 }
}

```

## columnToLetter(column)

- Current: Working as designed

```javascript
function columnToLetter(column) {
 let temp, letter = '';
 while (column > 0) {
   temp = (column - 1) % 26;
   letter = String.fromCharCode(temp + 65) + letter;
   column = (column - temp - 1) / 26;
 }
 return letter;
}

```

## parseComplexDateTime(str)

- Current: Working as designed  
- Helper functions used:  
- Changes/Updates/Description:  
1. 

```javascript
function parseComplexDateTime(str) {
 let result = { dateValue: "Manual Fix", timeValue: "Manual Fix", status: "Check" };
 const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
 try {
   const monthMatch = str.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
   const dayMatch = str.match(/\s(\d{1,2}),/);
   const yearMatch = str.match(/\d{4}/);      
   const timeMatch = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
   if (!monthMatch && !timeMatch) return { status: "Skip" };
   if (monthMatch && dayMatch && yearMatch && timeMatch) {
     const monthIndex = months.indexOf(monthMatch[0].toLowerCase());
     const day = parseInt(dayMatch[1]);
     const year = parseInt(yearMatch[0]);
     let hours = parseInt(timeMatch[1]);
     const minutes = parseInt(timeMatch[2]);
     const ampm = timeMatch[3].toLowerCase();
     if (ampm === "pm" && hours < 12) hours += 12;
     if (ampm === "am" && hours === 12) hours = 0;
     const finalDate = new Date(year, monthIndex, day, hours, minutes);
     if (!isNaN(finalDate.getTime())) {
       result.dateValue = finalDate;
       result.timeValue = finalDate;
       result.status = "Success";
     }
   }
 } catch (e) { result.status = "Check"; }
 return result;
}

```

## importPerformanceSpaces() & syncPerformanceSpaces()

- Current: Working   
- Helper functions used:  
  - helperFormatTime(date)  
- Changes/Updates/Description: merge/revise with syncPerformanceSpaces() to end up with a one–way sync function that checks the performance space calendars for updates and either adds them to the sheet or indicates when a change has been made to an event

```javascript
/**
* Option 0: Performance Spaces
* Imports multiple specific calendars into one consolidated list.
*/
function importPerformanceSpaces() {
 const sheet = SpreadsheetApp.getActiveSheet();
  // MAP YOUR CALENDAR IDs HERE
 // Replace the email addresses below with the actual IDs from your Calendar Settings
 const performanceCalendars = {
   "General Theatre": "Iqmtlck8snkslflp9hgo4a8jpd0@group.calendar.google.com",
   "Plaza-Ground-Plaza (400)": "c_1889qeg6bd7m0hrtmo68tkre9svb8@resource.calendar.google.com",
   "Main-2-Ballroom (80)": "c_188fuc79i81mgim8iakt2nsclug0g@resource.calendar.google.com",
   "Main-Basement-Ghostlight Lounge (100)": "c_188c70eufe8lah74j3gmfh9edq4vq@resource.calendar.google.com",
   "166-1-Black box (100)": "c_18839d3tuv3tgi8mki4gp683btaqa@resource.calendar.google.com",
   "Main-1-Onstage (1400)": "c_188depm0v46sij9tksaonsgh0m10a@resource.calendar.google.com",
   "166-2-2nd Floor- Theatre 166 (75)": "mansfieldtickets.com_1882f0eejjs0ig97knriti2qjkiug6ga68p3edpp68r3ed1g@resource.calendar.google.com",
   "166-Basement-Dance studio (30)": "c_188b7aple2u7sicbkvngrjsd5fqu4@resource.calendar.google.com",
   "Holidays in United States": "en.usa#holiday@group.v.calendar.google.com",
   "Main-1-Conference Room (12)": "mansfieldtickets.com_188456u476d3agrvn9porfjdpp5jg6gb6krj6dhi64rjee1k64@resource.calendar.google.com"
 };

 const now = new Date();
 const start = new Date(now.getTime() - (20 * 24 * 60 * 60 * 1000));
 const end = new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000));
  let allEvents = [];

 // Loop through each calendar in the group
 for (let displayName in performanceCalendars) {
   let id = performanceCalendars[displayName];
   let cal = CalendarApp.getCalendarById(id);
  
   if (cal) {
     let events = cal.getEvents(start, end);
     events.forEach(event => {
   allEvents.push([
     event.getTitle(),       // Column A: Event Title
     event.getStartTime(),   // Column B: Start Time
     Utilities.formatDate(event.getStartTime(),Session.getScriptTimeZone(),"h:mm a"),   // Column C: [blank]
     "",                     // Column D: [blank]
     event.getDescription(), // Column E: Details (was "Notes")
     "",                     // Column F: [blank]
     "",                     // Column G: [blank]
     displayName,             // Column H: Location/Space
     Utilities.formatDate(event.getEndTime(),Session.getScriptTimeZone(),"h:mm a")
   ]);
 });
   }
 }

 // Clear sheet and add headers
 sheet.clear();
 sheet.appendRow([
   "Event Title",
   "Start Date",
   "Start Time",
   " ",
   "Details",
   " ",
   " ",
   "Location/Space",
   "End Time"
 ]);



 // Sort events by Start Time (index 1) before writing
 allEvents.sort((a, b) => a[1] - b[1]);

 if (allEvents.length > 0) {
   sheet.getRange(2, 1, allEvents.length, allEvents[0].length).setValues(allEvents);
   SpreadsheetApp.getUi().alert("Imported " + allEvents.length + " events from Performance Spaces.");
 } else {
   SpreadsheetApp.getUi().alert("No events found for the selected timeframe.");
 }
}

```

```javascript
/**
* Option 0: Performance Spaces (SYNC EDITION)
* Synchronizes calendars and tracks changes using Status and Last Updated columns.
*/
function syncPerformanceSpaces() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sheet = ss.getActiveSheet();
  // 1. CONFIGURATION
 const performanceCalendars = {
   "General Theatre": "Iqmtlck8snkslflp9hgo4a8jpd0@group.calendar.google.com",
   "Plaza-Ground-Plaza (400)": "c_1889qeg6bd7m0hrtmo68tkre9svb8@resource.calendar.google.com",
   "Main-2-Ballroom (80)": "c_188fuc79i81mgim8iakt2nsclug0g@resource.calendar.google.com",
   "Main-Basement-Ghostlight Lounge (100)": "c_188c70eufe8lah74j3gmfh9edq4vq@resource.calendar.google.com",
   "166-1-Black box (100)": "c_18839d3tuv3tgi8mki4gp683btaqa@resource.calendar.google.com",
   "Main-1-Onstage (1400)": "c_188depm0v46sij9tksaonsgh0m10a@resource.calendar.google.com",
   "166-2-2nd Floor- Theatre 166 (75)": "mansfieldtickets.com_1882f0eejjs0ig97knriti2qjkiug6ga68p3edpp68r3ed1g@resource.calendar.google.com",
   "166-Basement-Dance studio (30)": "c_188b7aple2u7sicbkvngrjsd5fqu4@resource.calendar.google.com",
   "Holidays in United States": "en.usa#holiday@group.v.calendar.google.com",
   "Main-1-Conference Room (12)": "mansfieldtickets.com_188456u476d3agrvn9porfjdpp5jg6gb6krj6dhi64rjee1k64@resource.calendar.google.com"
 };

 const now = new Date();
 const start = new Date(now.getTime() - (20 * 24 * 60 * 60 * 1000));
 const end = new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000));
  // 2. GET EXISTING SHEET DATA (to compare)
 // We create a map where the Key is the Event ID
 const existingData = sheet.getDataRange().getValues();
 const existingMap = {};
  // Skip header row (i=1), mapping Event ID (Column J/Index 9) to the whole row
 for (let i = 1; i < existingData.length; i++) {
   const row = existingData[i];
   const eventId = row[9];
   if (eventId) existingMap[eventId] = row;
 }

 let finalData = [];

 // 3. FETCH CALENDAR EVENTS & DETECT CHANGES
 for (let displayName in performanceCalendars) {
   const calId = performanceCalendars[displayName];
   const cal = CalendarApp.getCalendarById(calId);
  
   if (cal) {
     const events = cal.getEvents(start, end);
     events.forEach(event => {
       const id = event.getId();
       const calLastUpdated = event.getLastUpdated().getTime();
       const existingRow = existingMap[id];
      
       let status = "Synced"; // Default
       let lastUpdatedDisplay = "";

       if (!existingRow) {
         status = "NEW";
         lastUpdatedDisplay = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd HH:mm");
       } else {
         // Compare the saved timestamp in Column F (index 5) with current Calendar timestamp
         const sheetLastUpdated = new Date(existingRow[5]).getTime();
        
         if (calLastUpdated > sheetLastUpdated) {
           status = "UPDATED";
           lastUpdatedDisplay = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd HH:mm");
         } else {
           // Keep the old status and timestamp if nothing changed
           status = existingRow[3] || "Synced";
           lastUpdatedDisplay = existingRow[5];
         }
       }

       finalData.push([
         event.getTitle(),                                // A: Event Title
         event.getStartTime(),                            // B: Start Date (Object)
         helperFormatTime(event.getStartTime()),          // C: Start Time
         status,                                          // D: Status
         event.getDescription(),                          // E: Details
         calLastUpdated,                                  // F: Hidden Last Updated Timestamp (for logic)
         lastUpdatedDisplay,                              // G: Last Updated Readable
         displayName,                                     // H: Location/Space
         helperFormatTime(event.getEndTime()),            // I: End Time
         id                                               // J: Original Event ID
       ]);
     });
   }
 }

 // 4. SORT AND WRITE
 finalData.sort((a, b) => a[1] - b[1]);

 sheet.clear();
 const headers = [
   "Event Title", "Start Date", "Start Time", "Status",
   "Details", "Modified TS", "Last Updated", "Location/Space", "End Time", "Original Event ID"
 ];
 sheet.appendRow(headers);

 if (finalData.length > 0) {
   sheet.getRange(2, 1, finalData.length, finalData[0].length).setValues(finalData);
   sheet.getRange(2, 2, finalData.length, 1).setNumberFormat("mm/dd/yyyy");
   // Hide column F as it's just for the script's math
   sheet.hideColumns(6);
  
   SpreadsheetApp.getUi().alert("Sync Complete. Checked " + finalData.length + " events.");
 }
}

```

## pushEventsToCrewCalendar()

- Current: Working   
- Helper functions used:  
  -   
- Changes/Updates/Description: not sure this is the best way to handle this part of the process. Currently i use sheet f to filter lineup, calls, and performance spaces to a single sheet. Then I used this function to push a draft. Then the log got created. Maybe instead of this, a new function creates the initial Crew\_Calendar\_Log

	

```javascript
function pushEventsToCrewCalendar() {
 const sheet = SpreadsheetApp.getActiveSheet();
 const data = sheet.getDataRange().getValues();
  // Replace with your actual New Crew Calendar ID
 const crewCalId = 'c_0ef07333ed7602ad2c11acc22a8e3473a65aae72648f2e013b22a16f15ae48ee@group.calendar.google.com';
 const crewCal = CalendarApp.getCalendarById(crewCalId);
  if (!crewCal) {
   SpreadsheetApp.getUi().alert("Could not find the Crew Calendar. Check the ID!");
   return;
 }

 let count = 0;

 // Start loop at 1 to skip header row
 for (let i = 1; i < data.length; i++) {
   let row = data[i];
   let eventTitle = row[0];  // Column A
   let startDate  = row[1];  // Column B
   let startTime  = row[2];  // Column C
   let description = row[4]; // Column E
   let location    = row[7]; // Column H
   let isSelected  = row[10]; // Column K (Checkbox)

   // Only push if the checkbox is checked AND we have a title/date
   if (isSelected === true && eventTitle && startDate) {
    
     // Combine Date (B) and Time (C) into one object
     let startDateTime = new Date(startDate);
     startDateTime.setHours(startTime.getHours());
     startDateTime.setMinutes(startTime.getMinutes());

     // Set end time to 1 hour later by default
     let endDateTime = new Date(startDateTime.getTime() + (60 * 60 * 1000));

     // Create the event
     crewCal.createEvent(eventTitle, startDateTime, endDateTime, {
       description: description,
       location: location
     });

     // Uncheck the box after pushing so it's not duplicated later
     sheet.getRange(i + 1, 11).setValue(false);
     count++;
   }
 }

 SpreadsheetApp.getUi().alert("Successfully pushed " + count + " events to the Crew Calendar.");
}
```

## runSyncEngine(mode)

- Current: Most up-to-date, Working but seems like we lost a bit of the status and time tracking ability from previous versions  
- Helper functions used:  
  - updateRowStatus(sheet, row, status, color)  
  - isSynced(event, logRow)  
  - checkDuplicate(eid, seenIds)  
  - getAdvancedDuplicateFingerprint(rowValues)  
  - updateSyncTimestamp(sheet, row)  
- Changes/Updates/Description:

```javascript
/**
* ENGINE: Handles the actual data transfer
* Re-organized to prevent "Self-Duplicate" loops.
*/
function runSyncEngine(mode) {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const logSheet = ss.getSheetByName("Crew_Calendar_Log");
 const crewCal = CalendarApp.getCalendarById('c_0ef07333ed7602ad2c11acc22a8e3473a65aae72648f2e013b22a16f15ae48ee@group.calendar.google.com');
  if (!crewCal) return;

 // 1. REFRESH DATA: Always get the latest data to avoid indexing errors
 const logRange = logSheet.getDataRange();
 const logData = logRange.getValues();
  // 2. INITIALIZE REGISTRIES: These MUST be inside the function to reset every run
 const seenIds = {};           // Technical Duplicate Registry
 const seenFingerprints = {};  // Advanced Duplicate Registry

 for (let k = 1; k < logData.length; k++) {
   let rowK = k + 1;
   let rowValues = logData[k];
   let eid = rowValues[0];
   let currentStatus = rowValues[9];
   let isPushChecked = logSheet.getRange(rowK, 11).getValue();

   // --- STEP 1: EPHEMERAL STATUS RESET ---
   // We clear these first so the script can re-evaluate the row's health
   const toClear = ["Synced", "Pushed to Calendar", "Pulled from Crew Calendar", "Possible Duplicate", "Duplicate (ID Match)"];
   if (toClear.includes(currentStatus)) {
     updateRowStatus(logSheet, rowK, "", null);
   }

   // Skip rows marked as deleted or empty
   if (!rowValues[1] || (eid && eid.toString().includes("DEL:"))) continue;

   // --- STEP 2: DUPLICATE IDENTIFICATION ---
  
   // A. Technical Check (ID)
   if (eid && eid !== "") {
     if (seenIds[eid]) {
       updateRowStatus(logSheet, rowK, "Duplicate (ID Match)", "#f4cccc");
       continue; // Skip further processing for this row
     }
     seenIds[eid] = true;
   }

   // B. Advanced Check (Name, Time, Loc)
   let fingerprint = getAdvancedDuplicateFingerprint(rowValues);
   if (fingerprint && seenFingerprints[fingerprint]) {
     updateRowStatus(logSheet, rowK, "Possible Duplicate", "#fff2cc");
     continue; // Skip further processing
   }
   seenFingerprints[fingerprint] = true;

   // --- STEP 3: SYNC LOGIC ---
   // ... inside the runSyncEngine loop (Step 3: Sync Logic) ...

   try {
     if (!eid) continue;

     let ev = crewCal.getEventById(eid);
     if (!ev) {
       updateRowStatus(logSheet, rowK, "Deleted from Calendar", "#ea9999");
       logSheet.getRange(rowK, 1).setValue("DEL: " + eid);
       continue;
     }

     // MODE LOGIC: PUSH
     if (mode !== 'PULL_ONLY' && isPushChecked) {
       ev.setTitle(rowValues[1]).setTime(new Date(rowValues[3]), new Date(rowValues[4]));
       updateRowStatus(logSheet, rowK, "Pushed to Calendar", "#e2efda");
       updateSyncTimestamp(logSheet, rowK); // <--- UPDATE TIMESTAMP
       logSheet.getRange(rowK, 11).setValue(false);
     }
     // MODE LOGIC: PULL
     else if (mode !== 'PUSH_ONLY' && !isSynced(ev, rowValues)) {
       logSheet.getRange(rowK, 2).setValue(ev.getTitle());
       logSheet.getRange(rowK, 3).setValue(ev.getStartTime());
       logSheet.getRange(rowK, 4).setValue(ev.getStartTime());
       updateRowStatus(logSheet, rowK, "Pulled from Crew Calendar", "#fff2cc");
       updateSyncTimestamp(logSheet, rowK); // <--- UPDATE TIMESTAMP
     }
     // MODE LOGIC: CONFIRM SYNC
     else if (isSynced(ev, rowValues)) {
       updateRowStatus(logSheet, rowK, "Synced", "#d9ead3");
       updateSyncTimestamp(logSheet, rowK); // <--- UPDATE TIMESTAMP
     }

   } catch (err) {
     updateRowStatus(logSheet, rowK, "Manual Review", "#fce5cd");
   }
   calEventColor(eid,k);
 }
}
```

## appendNewFromCalls()

```javascript
/**
* PART A: Scans the Calls sheet for events without IDs,
* creates them on the Calendar, and appends them to the Log.
*/
function appendNewFromCalls() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const callsSheet = ss.getSheetByName("Calls");
 const logSheet = ss.getSheetByName("Crew_Calendar_Log");
 const crewCalId = 'c_0ef07333ed7602ad2c11acc22a8e3473a65aae72648f2e013b22a16f15ae48ee@group.calendar.google.com';
 const crewCal = CalendarApp.getCalendarById(crewCalId);

 if (!callsSheet || !logSheet || !crewCal) return;

 const callsData = callsSheet.getDataRange().getValues();
 let newCount = 0;

 for (let i = 1; i < callsData.length; i++) {
   let name = callsData[i][0];  // Col A
   let date = callsData[i][1];  // Col B
   let time = callsData[i][2];  // Col C
   let type = callsData[i][3];  // Col D
   let desc = callsData[i][4];  // Col E
   let loc  = callsData[i][7];  // Col H
   let id   = callsData[i][8];  // Col I (Event ID)

   // Only process if Name and Date exist, but ID is missing
   if (!id && name && date) {
     try {
       let startDT = new Date(date);
       if (time instanceof Date) {
         startDT.setHours(time.getHours(), time.getMinutes());
       }
      
       // Default end time to 1 hour later
       let endDT = new Date(startDT.getTime() + 3600000);

       // Create the Calendar Event
       let event = crewCal.createEvent(desc || name, startDT, endDT, {
         description: (type ? type + " | " : "") + name,
         location: loc || ""
       });
      
       let newID = event.getId();

       // 1. Write ID back to Calls sheet
       callsSheet.getRange(i + 1, 9).setValue(newID);

       // 2. Append to Log sheet
      // Inside your append logic after the event is created:
logSheet.appendRow([
 newID,
 desc || name,
 date,
 startDT,
 endDT,
 loc || "",
 fullDesc,
 sourceName,
 new Date(), // This sets the first "Last Synced" time
 "Pulled from " + sourceName
]);

       // 3. Apply the "Recovered/New" style color to the new log row
       let lastRow = logSheet.getLastRow();
       updateRowStatus(logSheet, lastRow, "Pulled from calls", "#d9ead3"); // Light green
      
       newCount++;
     } catch (e) {
       console.log("Error appending from Calls row " + (i+1) + ": " + e.message);
     }
   }
 }
 return newCount;
}
```

## onEdit() & onEdit1()

```javascript
/**
 * Automation: Checks Box in Col K when B-H are edited
 */
function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() === "Crew_Calendar_Log" && e.range.getRow() > 1) {
    const col = e.range.getColumn();
    if (col >= 2 && col <= 8) {
      sheet.getRange(e.range.getRow(), 11).setValue(true).setBackground("#fff2cc");
    }
  }
}


function onEdit1(e) {
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const editedRow = e.range.getRow();
  const editedCol = e.range.getColumn();

  // 1. Only run if the edit happened in "Crew_Calendar_Log"
  if (sheetName === "Crew_Calendar_Log") {
    
    // 2. Ignore the header row (Row 1)
    if (editedRow > 1) {
      
      // 3. Only trigger if editing "Content" columns (B through H)
      // This prevents the checkbox from checking itself if you edit the ID or Sync columns
      if (editedCol >= 2 && editedCol <= 8) {
        
        // 4. Set Column K (the 11th column) to TRUE (Checked)
        sheet.getRange(editedRow, 11).setValue(true);
        
        // Optional: Change the color of the checkbox cell to nudge you to sync
        sheet.getRange(editedRow, 11).setBackground("#fff2cc"); 
      }
    }
  }
}
```

## backPopulateIDsToCalls()

```javascript
function backPopulateIDsToCalls() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const callsSheet = ss.getSheetByName("Calls");
 const fSheet = ss.getSheetByName("f");
  const callsData = callsSheet.getDataRange().getValues();
 const fData = fSheet.getDataRange().getValues();
  let matchCount = 0;

 for (let i = 1; i < callsData.length; i++) {
   let callEventName = callsData[i][0]; // Col A
   let currentID = callsData[i][8];     // Col I
  
   // Only look for ID if Column I is currently empty
   if (!currentID || currentID === "") {
     for (let j = 1; j < fData.length; j++) {
       // Match by Event Name (Col A in both sheets)
       if (callEventName === fData[j][0]) {
         let eventID = fData[j][12]; // Col M in Sheet f
         callsSheet.getRange(i + 1, 9).setValue(eventID);
         matchCount++;
         break;
       }
     }
   }
 }
 SpreadsheetApp.getUi().alert("Linked " + matchCount + " rows in Calls to existing Calendar IDs.");
}

```

## masterLogSync() & pullUpdatesFromCalendar()

- Previous versions that were merged into runSyncEngine()

```javascript
function masterLogSync() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const logSheet = ss.getSheetByName("Crew_Calendar_Log");
 const crewCalId = 'c_0ef07333ed7602ad2c11acc22a8e3473a65aae72648f2e013b22a16f15ae48ee@group.calendar.google.com';
 const crewCal = CalendarApp.getCalendarById(crewCalId);

 if (!crewCal) {
   SpreadsheetApp.getUi().alert("Calendar connection failed. Sync aborted.");
   return;
 }

 const ephemeralStatuses = [
   "Pushed to calendar", "Pulled from calendar", "Pulled from calls",
   "Pulled from PerformanceSpace", "Pulled from Lineup"
 ];

 const logData = logSheet.getDataRange().getValues();
 const seenIds = {};

 // --- PART A: APPEND NEW ROWS (SAME AS BEFORE) ---
 // ... (keeping your existing Part A logic here) ...

 // --- PART B: TWO-WAY SYNC & DYNAMIC STATUS CLEARING ---
 for (let k = 1; k < logData.length; k++) {
   let rowK = k + 1;
   let eid = logData[k][0];
   let currentStatus = logData[k][9]; // Column J

   // 1. RE-VALIDATION RESET
   // Clear ephemeral statuses AND duplicate/error warnings so they can be re-evaluated
   if (ephemeralStatuses.includes(currentStatus) ||
       currentStatus === "Duplicate warning" ||
       currentStatus === "Sync Error") {
     logSheet.getRange(rowK, 10).clearContent().setBackground(null);
   }

   if (!eid || eid.toString().includes("DEL:")) continue;

   // 2. DUPLICATE CHECK
   // If we've seen this ID already in this specific run, mark it.
   if (seenIds[eid]) {
     logSheet.getRange(rowK, 10).setValue("Duplicate warning").setBackground("#f4cccc");
     continue;
   }
   seenIds[eid] = true;

   try {
     let ev = crewCal.getEventById(eid);
     if (!ev) {
       logSheet.getRange(rowK, 1).setValue("DEL: " + eid);
       logSheet.getRange(rowK, 10).setValue("Deleted from calendar").setBackground("#ea9999");
       continue;
     }

     let pushFlag = logSheet.getRange(rowK, 10).getValue();
    
     if (logSheet.getRange(rowK, 11).getValue() === true) {
       // PUSH LOGIC
       ev.setTitle(logData[k][1]).setTime(new Date(logData[k][3]), new Date(logData[k][4]));
       logSheet.getRange(rowK, 10).setValue("Pushed to calendar").setBackground("#e2efda");
       logSheet.getRange(rowK, 11).setValue(false).setBackground(null);
     } else {
       // PULL LOGIC
       let cStart = ev.getStartTime().getTime();
       let lStart = (logData[k][3] instanceof Date) ? logData[k][3].getTime() : 0;
      
       if (cStart !== lStart || ev.getTitle() !== logData[k][1]) {
          logSheet.getRange(rowK, 2).setValue(ev.getTitle()).setBackground("#fff2cc");
          logSheet.getRange(rowK, 3).setValue(ev.getStartTime()).setBackground("#fff2cc");
          logSheet.getRange(rowK, 10).setValue("Pulled from calendar").setBackground("#fff2cc");
       }
     }
   } catch (err) {
     logSheet.getRange(rowK, 10).setValue("Sync Error").setBackground("#f4cccc");
     console.log("Error ID " + eid + ": " + err.message);
   }
 }
}

```

```javascript
function pullUpdatesFromCalendar() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const logSheet = ss.getSheetByName("Crew_Calendar_Log");
 const data = logSheet.getDataRange().getValues();
 const crewCalId = 'c_0ef07333ed7602ad2c11acc22a8e3473a65aae72648f2e013b22a16f15ae48ee@group.calendar.google.com';
 const crewCal = CalendarApp.getCalendarById(crewCalId);

 let updateCount = 0;
 const highlightColor = "#fff2cc"; // Light Yellow

 for (let i = 1; i < data.length; i++) {
   let existingId = data[i][0]; // Col A
   let sourceSheetName = data[i][7]; // Col H (Assumes this contains "Calls", "Lineup", etc.)
   if (!existingId) continue;

   try {
     let event = crewCal.getEventById(existingId);
     if (event) {
       let calTitle = event.getTitle();
       let calStart = event.getStartTime();
       let calEnd   = event.getEndTime();
       let calLoc   = event.getLocation();
       let calDesc  = event.getDescription();
      
       let sheetVals = {
         title: data[i][1],
         start: (data[i][3] instanceof Date) ? data[i][3].getTime() : 0,
         end:   (data[i][4] instanceof Date) ? data[i][4].getTime() : 0,
         loc:   data[i][5],
         desc:  data[i][6]
       };

       let rowNum = i + 1;
       let rowChanged = false;

       // --- UPDATE LOG SHEET ---
       if (calTitle !== sheetVals.title) {
         logSheet.getRange(rowNum, 2).setValue(calTitle).setBackground(highlightColor);
         rowChanged = true;
       }
       if (calStart.getTime() !== sheetVals.start) {
         logSheet.getRange(rowNum, 3).setValue(calStart).setBackground(highlightColor);
         logSheet.getRange(rowNum, 4).setValue(calStart).setBackground(highlightColor);
         rowChanged = true;
       }
       if (calEnd.getTime() !== sheetVals.end) {
         logSheet.getRange(rowNum, 5).setValue(calEnd).setBackground(highlightColor);
         rowChanged = true;
       }
       if (calLoc !== sheetVals.loc) {
         logSheet.getRange(rowNum, 6).setValue(calLoc).setBackground(highlightColor);
         rowChanged = true;
       }
       if (calDesc !== sheetVals.desc) {
         logSheet.getRange(rowNum, 7).setValue(calDesc).setBackground(highlightColor);
         rowChanged = true;
       }

       // --- UPDATE SOURCE SHEET (Calls, Lineup, etc.) ---
       if (rowChanged && sourceSheetName) {
         let srcSheet = ss.getSheetByName(sourceSheetName);
         if (srcSheet) {
           updateSourceRow(srcSheet, existingId, calTitle, calStart, calEnd);
         }
         logSheet.getRange(rowNum, 9).setValue(new Date());
         updateCount++;
       }
     }
   } catch (e) {
     Logger.log("Error checking ID: " + existingId + " - " + e.message);
   }
 }
}

/**
* Helper: Finds the ID in a source sheet and updates the relevant cells.
* Adjust the column numbers below to match your source sheet layouts.
*/
function updateSourceRow(sheet, id, newTitle, newStart, newEnd) {
 let data = sheet.getDataRange().getValues();
 for (let j = 0; j < data.length; j++) {
   // Searches the WHOLE row for the ID (flexible in case ID column moves)
   let idIndex = data[j].indexOf(id);
   if (idIndex !== -1) {
     let row = j + 1;
     // Example mapping: Col A = Title, Col B = Date, Col C = Time
     // Modify these based on how "Calls" or "Lineup" are structured
     sheet.getRange(row, 1).setValue(newTitle).setBackground("#fff2cc");
     sheet.getRange(row, 2).setValue(newStart).setBackground("#fff2cc");
     // Add more fields as needed
     break;
   }
 }
}

```

## Various helper functions

```javascript
/**
* HELPER: Updates the Status (Col J) and Row Background
*/
function updateRowStatus(sheet, row, status, color) {
 const statusCell = sheet.getRange(row, 10);
 statusCell.setValue(status);
 if (color) {
   sheet.getRange(row, 1, 1, 10).setBackground(color);
 } else {
   sheet.getRange(row, 1, 1, 10).setBackground(null);
 }
}

/**
* HELPER: Compares Calendar Event vs Sheet Row
* Returns true if they match exactly.
*/
function isSynced(event, logRow) {
 const calStart = event.getStartTime().getTime();
 const logStart = (logRow[3] instanceof Date) ? logRow[3].getTime() : 0;
 const calTitle = event.getTitle();
 const logTitle = logRow[1];
  return (calStart === logStart && calTitle === logTitle);
}

/**
* HELPER: Duplicate Check
*/
function checkDuplicate(eid, seenIds) {
 if (seenIds[eid]) return true;
 seenIds[eid] = true;
 return false;
}


/**
* HELPER: Advanced Duplicate Check (Attribute Matching)
* Checks: Name, Start Time, End Time, Location
*/
function getAdvancedDuplicateFingerprint(rowValues) {
 const name = String(rowValues[1] || "").trim().toLowerCase();
 const start = (rowValues[3] instanceof Date) ? rowValues[3].getTime() : 0;
 const loc = String(rowValues[5] || "").trim().toLowerCase();
  // If there's no name or date, don't generate a fingerprint (avoid false positives)
 if (!name || start === 0) return null;
  return name + "|" + start + "|" + loc;
}


/**
* HELPER: Updates the Last Synced timestamp (Col I)
*/
function updateSyncTimestamp(sheet, row) {
 // Column I is index 9
 sheet.getRange(row, 9).setValue(new Date());
}



```

# old2

Run Notes 1

- Import to Parent Lineup  
  - Functioned  
  -   
- Parent Lineup to Lineup  
  - Functioned  
- Import Performance Spaces  
  - Functioned  
- Aggregate Data  
  - Functioned with some mistakes  
  - Some dates were not in the correct century, which is odd because they came from the calendar that shows them in 2026 ex: “12/30/1899 18:30:00”  
  - Crew\_Calendar\_Log: did not include all the headers I specified  
  - Calls: My headers did not match what I said. I have updated them, but I think we need to add the step to back populate eventIDs and callIDs  
  - Performance Spaces: add step to back populate linked parentID & childID  
  - Seem to have lost some of the row and cell highlighting abilities of the original script  
  - Only 3 events linked. Oddly, one of them also had the date mismatch. I am guessing this is a date format error  
  - Items from calls had a datetime string as the “Event Name”. Instead we will use the column labeled “Title” from Calls  
  - Call “Details” will be Type | Description in crew\_Calendar\_log  
  - 

Call Types: 

* Rehearsal  
* Load In  
* Crew Call  
* Show Time  
* Sound Check  
* Construction  
* Rigging  
* Dark Time  
* Quiet Time  
* Shutdown  
* Out of Office  
* Load Out  
* Strike  
* Setup / Prep  
* Classroom  
* Tech Week

Status Info:

* Synced;Match confirmed between Sheet & Calendar.;Light Green  
* Pushed to Calendar;Update sent from Sheet to Calendar.;Green  
* Pulled from Crew Calendar;Update brought from Calendar to Sheet.;Yellow  
* Possible Duplicate;Name, Time, and Location match another row.;Yellow/Tan  
* Duplicate (ID Match);The technical Event ID is repeated.;Pink/Red  
* Recovered;Missing ID was restored by the recovery script.;Light Green  
* Manual Review;Sync error or data mismatch occurred.;Orange  
* Deleted from Calendar;Event no longer exists in Google Calendar.;Red