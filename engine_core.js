/*UPDATE_NOTES 8/17/26
ctx.maps is referenced constantly but never created
Engine.getContext() (in engine_core.js) builds ctx.sheets and gives you ctx.getMap(identifier) as a method — but it never sets a ctx.maps property.
Fix direction: either add ctx.maps = ctx.sheets mapping logic (each .map extracted) during getContext(), or replace every ctx.maps.X reference with ctx.getMap("X"). Pick one and standardize — don't keep two names for the same thing.

ctx.settings and ctx.mode are referenced but never created either



*/

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
    
    let ctx = {
      ss: ss,
      sheets: {},
      maps: {},
      schema: {},
      roles: {},
      settings: { ControlPanel: {} },
      mode: { logTypes: "", writeToCalendar: false },
      runtime: { bypassList: [], isCustom: false, reportOnly: false }
    };

    // 1. Build the Map Schema (This is the foundation)
    this.assembleSheetMap(ctx);
    this.buildLegacyMapAliases(ctx);

    // 2. Load basic config and status rules
    ctx.config = this.loadConfig(ss);
    ctx.mode = Object.assign({}, ctx.config, { logTypes: "", writeToCalendar: false });
    ctx.settings.ControlPanel = this.loadControlPanelSettings(ss);
    ctx.status = this.loadStatusRules(ss);
    
    // 3. Load Registry (Fast-lookup for Identity)
    ctx.registry = this.loadRegistry(ctx);

    // 4. Load Lookups (Now safe to use because maps are ready)
    const lookupData = this.loadLookups(ctx);
    ctx.lookup = lookupData      // This populates your lists
    ctx.calendars = lookupData.calendars; // This populates your venue IDs

    ctx.runtime.bypassList = this.loadBypassList(ctx);

    // Helpers
    ctx.get = (sheetName) => ss.getSheetByName(sheetName);
    ctx.getRole = function(roleName) {
      // 'this' refers to the active 'ctx' object
      // Why this is named getRole, Idk. It gets the sheet name based on the role. 
      const cleanRole = roleName.trim();
      const actualName = this.roles[cleanRole]; 
      
      if (!actualName) {
        console.error(`Role missing! Searched for: ${cleanRole}`, this.roles);
        return null;
      }
      
      //return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(actualName);
      return actualName;
  };

    
    /**
     * Retrieves the Map_Registry object for a given Role or Sheet Name
     * Usage: const lineupMap = ctx.getMap('LINEUPCURRENT');
     */
    ctx.getMap = function(identifier) {
      const sheetObj = this.sheets[identifier] || this.schema[identifier];
      const map = sheetObj && sheetObj.map ? sheetObj.map : this.maps[identifier];
      if (!map) {
        console.error(`Map not found for identifier: ${identifier}`);
        return null;
      }
      return map;
    };

    /**
     * Gets a specific column index by Field Name and Role/Sheet
     * Usage: const emailIdx = ctx.getCol('CREWCAL', 'Email');
     */
    ctx.getCol = function(identifier, fieldName) {
      const map = this.getMap(identifier);
      if (map && map[fieldName] !== undefined) {
        const fieldDef = map[fieldName];
        if (typeof fieldDef === "object" && fieldDef !== null && fieldDef.index !== undefined) {
          return Number(fieldDef.index);
        }
        return Number(fieldDef);
      }
      return -1;
    };

    return ctx;
  },

  /**
   * Reads 'ControlPanel' to set global variables
   */
  loadConfig: function(ss) {
    const sheet = ss.getSheetByName("ControlPanel");
    if (!sheet) {
      return { mode: "Draft 26-27", syncWindow: { start: 14, end: 365 }, defaultDuration: 2 };
    }

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
      if (key === "logTypes") config.logTypes = val;
      if (key === "writeToCalendar") config.writeToCalendar = String(val).toLowerCase() === "true" || val === true;
      if (key === "Crew Draft Calendar ID") config.crewDraftCalendarId = val;
      if (nam && nam.toLowerCase() === "mode") config.mode = val;
    });
    return config;
  },

  loadControlPanelSettings: function(ss) {
    const sheet = ss.getSheetByName("ControlPanel");
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const settings = {};

    data.forEach(row => {
      const label = row[0];
      const key = row[1] || row[0];
      const value = row[2];
      if (!key && value === undefined) return;

      const normalizedKey = String(key || label || "").trim();
      if (!normalizedKey) return;

      settings[normalizedKey] = value;
      if (label) settings[String(label).trim()] = value;
    });

    return settings;
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
  /**
   * NEW: loadLookups
   * 1. Maps Venue Names to Calendar IDs (As an Array for Sync)
   * 2. Loads Dropdown lists (Call Types, etc.)
   */
  loadLookups: function(ctx) {
    let lookups = { calendars: [], lists: {} }; // Calendars is an array now
    const ss = ctx.ss;

    // 1. Process Calendars
    const calSheet = ss.getSheetByName("Calendars");
    if (calSheet) {
      const calData = calSheet.getDataRange().getValues();
      calData.shift(); // Remove headers
      calData.forEach(row => {
        const calId = row[1];
        const venueName = row[2];
        if (venueName && calId) {
          // Push as an object for the Sync Engine
          lookups.calendars.push({ 
            id: calId, 
            venueName: venueName, 
            displayName: row[0] 
          });
        }
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
      const role = row[7]; // Your log confirmed Role is at index 7
      if (!sheetName) return;

      // Register the Role
      if (role) ctx.roles[role] = sheetName;


      //Sheet_Settings Map
      // 2. Create the configuration object
      const sheetConfig = {
        name: sheetName,
        role: role,
        settings: { idKey: row[1], behavior: row[2], syncMode: row[3], isProtected: row[4] === "Yes" },
        map: {}
      };

      // 3. Map the registry columns - SIMPLIFIED
      mapData.filter(m => m[0] === sheetName).forEach(m => {
        const fieldName = m[1];
        const colIndex = Number(m[2]);
        
        // Store the index as an object to support reads like map.Field.index
        sheetConfig.map[fieldName] = { index: colIndex };
      });

      // 4. Store by Sheet Name
      ctx.sheets[sheetName] = sheetConfig;
      
      // 5. Store a reference by Role (This is just a pointer, not a full copy)
      if (role) ctx.sheets[role] = ctx.sheets[sheetName]; 
    });
  },

  buildLegacyMapAliases: function(ctx) {
    ctx.maps = {};
    ctx.schema = {};

    Object.keys(ctx.sheets).forEach(sheetName => {
      const sheetDef = ctx.sheets[sheetName];
      const map = sheetDef && sheetDef.map ? sheetDef.map : {};
      ctx.maps[sheetName] = map;
      ctx.schema[sheetName] = sheetDef;

      if (sheetDef && sheetDef.role) {
        ctx.maps[sheetDef.role] = map;
        ctx.schema[sheetDef.role] = sheetDef;
      }
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
    },
    // ADD THESE HELPERS to prevent the "is not a function" error:
    info: function(ctx, stage, details) {
      this.write(ctx, { stage: stage, type: "INFO", details: details });
    },

    error: function(ctx, stage, details) {
      this.write(ctx, { stage: stage, type: "ERROR", details: details });
    },

    warn: function(ctx, stage, details) {
      this.write(ctx, { stage: stage, type: "WARN", details: details });
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
   * Loads the idLog into memory for fast identity/drift checks.
   */
  loadRegistry: function(ctx) {
    const sheet = ctx.ss.getSheetByName("idLog");
    if (!sheet) return {};
    
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const idIdx = headers.indexOf("UniqueID");
    const hashIdx = headers.indexOf("SyncHash");
    
    let registry = {};
    data.forEach(row => {
      const id = row[idIdx];
      if (id) {
        registry[id] = {
          SyncHash: row[hashIdx] || "N/A"
        };
      }
    });
    return registry;
  }


};