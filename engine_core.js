/**
 * FILE: Engine_Core.gs
 * PURPOSE: Central Context, Logging, and Status Management.
 */

//Standardize ctx.getMap() Usage: To resolve the ctx.maps note, maintain ctx.maps during getContext() for backward compatibility, but update all internal engine calls to consistently use ctx.getMap(identifier).

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


var Engine = {
  /**
   * Initializes the context (ctx). 
   * This is called at the top of every main function.
   */
  getContext: function(options) {
    options = options || {};
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    let ctx = {
      ss: ss,
      sheets: {},
      sheetDefs: {},
      maps: {},
      schema: {},
      roles: {},
      settings: { ControlPanel: {} },
      mode: { logTypes: "", writeToCalendar: false },
      runtime: Object.assign({ bypassList: [], isCustom: false, reportOnly: false, allowCalendarWrites: undefined }, options.runtime || {})
    };

    // 1. Build the Map Schema (This is the foundation)
    this.assembleSheetMap(ctx);
    this.buildLegacyMapAliases(ctx);

    // 2. Load basic config and status rules
    ctx.config = this.loadConfig(ss);
    const modeConfig = this.loadModeConfig(ss, options.modeName);
    ctx.mode = Object.assign({}, ctx.config, modeConfig, {
      logTypes: Array.isArray(modeConfig.logTypes) ? modeConfig.logTypes.join(", ") : (modeConfig.logTypes || ctx.config.logTypes || ""),
      writeToCalendar: modeConfig.writeToCalendar !== undefined ? Boolean(modeConfig.writeToCalendar) : Boolean(ctx.config.writeToCalendar)
    });
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
      const sheetDef = this.sheetDefs[identifier] || this.schema[identifier] || this.sheets[identifier];
      const map = (sheetDef && sheetDef.map) || this.maps[identifier] || (this.sheets[identifier] && this.sheets[identifier].map);
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
      return Engine.getColumnIndex(this.getMap(identifier), fieldName);
    };

    return ctx;
  },

  getColumnIndex: function(map, fieldName) {
    if (!map || map[fieldName] === undefined || map[fieldName] === null) return -1;

    const fieldDef = map[fieldName];
    const rawIndex = typeof fieldDef === "object" ? fieldDef.index : fieldDef;
    const columnIndex = Number(rawIndex);
    return Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : -1;
  },

  parseModeList: function(value) {
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value)
      .split(/[;,]/)
      .map(v => v.trim())
      .filter(Boolean);
  },

  coerceBoolean: function(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
      if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
    }
    return Boolean(value);
  },

  loadModeConfig: function(ss, requestedModeName) {
    const sheet = ss.getSheetByName("Mode_Config"); //hardcoded here because maps haven't been loaded to context yet?
    if (!sheet) return this.getDefaultMode();

    const data = sheet.getDataRange().getValues();
    if (!data.length) return this.getDefaultMode();

    const headers = data[0].map(h => String(h || "").trim().toLowerCase());
    const getIdx = (candidates) => {
      for (const key of candidates) {
        const idx = headers.indexOf(String(key).trim().toLowerCase());
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // 11-column schema: Mode Name, Description, IsActive, SyncMode, ConflictPolicy, PreferredTruth,
    // WriteToCalendar, WriteToSheet, UseLiveVenueMirroring, AllowedBehaviors, AllowedLogTypes
    const modeNameIdx = getIdx(["mode name", "mode", "mode_name"]);
    const isActiveIdx = getIdx(["isactive", "active", "is active"]);
    const syncModeIdx = getIdx(["syncmode", "sync_mode"]);
    const writeCalIdx = getIdx(["writetocalendar", "write_to_calendar"]);
    const writeSheetIdx = getIdx(["writetosheet", "write_to_sheet"]);
    const venueMirrorIdx = getIdx(["uselivevenuemirroring", "use_live_venue_mirroring"]);
    const behaviorsIdx = getIdx(["allowedbehaviors", "behaviors", "allowed_behaviors"]);
    const logTypesIdx = getIdx(["allowedlogtypes", "logtypes", "log_types"]);

    let activeMode = null;
    let requestedMode = null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(v => v === "" || v === null || v === undefined)) continue;

      const modeName = modeNameIdx !== -1 ? String(row[modeNameIdx] || "").trim() : "";
      if (!modeName) continue;

      const isActive = isActiveIdx !== -1 ? this.coerceBoolean(row[isActiveIdx]) : false;
      const syncMode = syncModeIdx !== -1 ? String(row[syncModeIdx] || "").trim() : "";
      const writeToCalendar = writeCalIdx !== -1 ? this.coerceBoolean(row[writeCalIdx]) : false;
      const writeToSheet = writeSheetIdx !== -1 ? this.coerceBoolean(row[writeSheetIdx]) : false;
      const useLiveVenueMirroring = venueMirrorIdx !== -1 ? this.coerceBoolean(row[venueMirrorIdx]) : false;
      const allowedBehaviors = behaviorsIdx !== -1 ? this.parseModeList(row[behaviorsIdx]) : [];
      const allowedLogTypes = logTypesIdx !== -1 ? this.parseModeList(row[logTypesIdx]) : [];

      const mode = {
        mode: modeName,
        syncMode: syncMode,
        writeToCalendar: writeToCalendar,
        writeToSheet: writeToSheet,
        useLiveVenueMirroring: useLiveVenueMirroring,
        allowedBehaviors: allowedBehaviors,
        allowedLogTypes: allowedLogTypes,
        logTypes: allowedLogTypes.join(", ")
      };

      if (isActive) {
        activeMode = mode;
      }
      if (requestedModeName && modeName.toLowerCase() === String(requestedModeName).trim().toLowerCase()) {
        requestedMode = mode;
      }
    }

    return requestedMode || activeMode || this.getDefaultMode();
  },

  getDefaultMode: function() {
    return {
      mode: "Draft 26-27",
      syncMode: "",
      writeToCalendar: false,
      writeToSheet: false,
      useLiveVenueMirroring: false,
      allowedBehaviors: ["BYPASS", "SYNC_ALLOWED"],
      allowedLogTypes: [],
      logTypes: ""
    };
  },

  /**
   * Reads 'ControlPanel' to set global variables
   */
  loadConfig: function(ss) {
    const sheet = ss.getSheetByName("ControlPanel");
    const modeConfig = this.loadModeConfig(ss);
    const defaults = { mode: modeConfig.mode || "Draft 26-27", syncWindow: { start: 14, end: 365 }, defaultDuration: 2, logTypes: modeConfig.logTypes || "", writeToCalendar: Boolean(modeConfig.writeToCalendar) };

    if (!sheet) {
      return defaults;
    }

    const data = sheet.getDataRange().getValues();
    let config = Object.assign({}, defaults);

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

    if (modeConfig.mode) config.mode = modeConfig.mode;
    if (modeConfig.logTypes) config.logTypes = modeConfig.logTypes;
    if (modeConfig.writeToCalendar !== undefined) config.writeToCalendar = Boolean(modeConfig.writeToCalendar);
    return config;
  },

  loadControlPanelSettings: function(ss) { //what is the difference between this and loadConfig? This is a more generic version that returns all key-value pairs, not just the ones we care about for config.
    const sheet = ss.getSheetByName("ControlPanel");
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const settings = {};

    data.forEach(row => {
      const label = row[0];  //why is it label as opposed to name? In loadConfig, we use row[0] as 'nam' and row[1] as 'key'. Here, we treat row[0] as label and row[1] as key. This is an inconsistency to clean up.
      const key = row[1] || row[0]; // Use key if available, otherwise fallback to label
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
    //Shouldn't this also load the "ref" sheet??
    const listSheet = ss.getSheetByName("Lookup");
    const lookupSheetDef = ctx.sheetDefs["Lookup"] || ctx.schema["Lookup"] || ctx.getMap("Lookup");
    
    if (listSheet && lookupSheetDef && lookupSheetDef.map) {
      const listData = listSheet.getDataRange().getValues();
      const map = lookupSheetDef.map;
      let cleanColumn = null;

      if (typeof SL !== "undefined" && SL.Utils && typeof SL.Utils.getCleanColumn === "function") {
        cleanColumn = SL.Utils.getCleanColumn;
      } else if (typeof scriptLib !== "undefined" && typeof scriptLib.getCleanColumn === "function") {
        cleanColumn = scriptLib.getCleanColumn;
      }

      Object.keys(map).forEach(fieldName => {
        const colIdx = this.getColumnIndex(map, fieldName);
        if (colIdx < 0) return;
        lookups.lists[fieldName] = cleanColumn
          ? cleanColumn(listData, colIdx)
          : listData.map(row => row[colIdx]).filter(value => value !== "" && value !== null && value !== undefined);
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

      if (role) ctx.roles[role] = sheetName;

      const actualSheet = ctx.ss.getSheetByName(sheetName) || null;
      if (actualSheet) {
        ctx.sheets[sheetName] = actualSheet;
      }

      const sheetConfig = {
        name: sheetName,
        role: role,
        sheet: actualSheet,
        settings: { idKey: row[1], behavior: row[2], syncMode: row[3], isProtected: row[4] === "Yes" },
        map: {}
      };

      mapData.filter(m => m[0] === sheetName).forEach(m => {
        const fieldName = m[1];
        const colIndex = Number(m[2]);
        if (fieldName && !isNaN(colIndex)) {
          sheetConfig.map[fieldName] = { index: colIndex };
        }
      });

      ctx.sheetDefs[sheetName] = sheetConfig;
      ctx.schema[sheetName] = sheetConfig;
      ctx.maps[sheetName] = sheetConfig.map;

      if (role) {
        ctx.schema[role] = sheetConfig;
        ctx.maps[role] = sheetConfig.map;
        if (actualSheet) ctx.sheets[role] = actualSheet;
      }
    });
  },

  buildLegacyMapAliases: function(ctx) { //what is this for?
    ctx.maps = ctx.maps || {};
    ctx.schema = ctx.schema || {};

    Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
      const sheetDef = ctx.sheetDefs[sheetName];
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
    apply: function(ctx, roleOrSheetName, rowIdx, statusName, logContext = {}) {
      const sheet = ctx.sheets[roleOrSheetName] || ctx.ss.getSheetByName(ctx.getRole(roleOrSheetName) || roleOrSheetName);
      const map = ctx.getMap(roleOrSheetName) || ctx.maps[roleOrSheetName];
      if (!sheet || !map) {
        Engine.Log.error(ctx, "STATUS", `Could not resolve sheet/map for "${roleOrSheetName}" while applying status "${statusName}".`);
        return;
      }

      const theme = ctx.status[statusName] || { hex: "#ffffff", behavior: "DEFAULT" };
      const now = new Date();
      const targetObj = logContext.targetObj;

      const syncStatusCol = Engine.getColumnIndex(map, "SyncStatus");
      const lastSyncedCol = Engine.getColumnIndex(map, "LastSynced");
      const updateDetailsCol = Engine.getColumnIndex(map, "UpdateDetails");

      if (targetObj) {
        if (syncStatusCol >= 0) targetObj.SyncStatus = statusName;
        if (lastSyncedCol >= 0) targetObj.LastSynced = now;
        if (logContext.details && updateDetailsCol >= 0) targetObj.UpdateDetails = logContext.details;
      } else if (rowIdx) {
        if (syncStatusCol >= 0) sheet.getRange(rowIdx, syncStatusCol + 1).setValue(statusName);
        if (lastSyncedCol >= 0) sheet.getRange(rowIdx, lastSyncedCol + 1).setValue(now);
        if (logContext.details && updateDetailsCol >= 0) {
          sheet.getRange(rowIdx, updateDetailsCol + 1).setValue(logContext.details);
        }
        sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).setBackground(theme.hex);
      } else {
        Engine.Log.error(ctx, "STATUS", `Status.apply called for "${statusName}" with neither rowIdx nor targetObj.`);
        return;
      }

      Engine.Log.write(ctx, {
        stage: logContext.stage || "STATUS_UPDATE",
        sheetName: roleOrSheetName,
        rowIdx: rowIdx || (targetObj && targetObj._rowNum) || "N/A",
        id: logContext.id || (targetObj && (targetObj.UUID || targetObj.EventID)) || "N/A",
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

Engine.Core = {
  getContext: function() {
    return Engine.getContext();
  }
};