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
/**
 * Scans physical sheet headers and updates Map_Registry to match reality.
 * Run this if columns have been moved or added.
 */
function ensureRegistryRowsForSheet(ss, sheetName, fieldNames) {
  const registrySheet = ss.getSheetByName("Map_Registry");
  if (!registrySheet) return 0;

  const data = registrySheet.getDataRange().getValues();
  if (!data.length) return 0;

  const headers = data[0];
  const colSheetName = headers.indexOf("Sheet Name");
  const colFieldName = headers.indexOf("Field Name");
  const colIndex = headers.indexOf("Column Index");
  const colRole = headers.indexOf("Role");

  const existing = new Set();
  for (let i = 1; i < data.length; i++) {
    const sName = data[i][colSheetName];
    const fName = data[i][colFieldName];
    if (sName && fName) existing.add(`${sName}::${fName}`);
  }

  let added = 0;
  fieldNames.forEach((fieldName, index) => {
    const key = `${sheetName}::${fieldName}`;
    if (existing.has(key)) return;

    const nextRow = data.length + added + 1;
    registrySheet.getRange(nextRow, colSheetName + 1).setValue(sheetName);
    registrySheet.getRange(nextRow, colFieldName + 1).setValue(fieldName);
    if (colIndex !== -1) registrySheet.getRange(nextRow, colIndex + 1).setValue(index);
    if (colRole !== -1) registrySheet.getRange(nextRow, colRole + 1).setValue("System");
    added += 1;
  });

  return added;
}

function repairMapRegistry() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName("Map_Registry");
  if (!registrySheet) {
    const newSheet = ss.insertSheet("Map_Registry");
    newSheet.appendRow(["Sheet Name", "Field Name", "Column Index", "Header Name", "Label", "Role", "Behavior", "Sync Mode"]);
    return;
  }

  const requiredSheetRows = {
    "Mode_Config": ["Mode", "SyncMode", "AllowedBehaviors", "LogTypes", "WriteToCalendar", "Description"],
    "Lookup": ["Venue", "CalendarID", "CallType", "Series", "Crew", "Options"]
  };

  let addedTotal = 0;
  Object.keys(requiredSheetRows).forEach(function(sheetName) {
    addedTotal += ensureRegistryRowsForSheet(ss, sheetName, requiredSheetRows[sheetName]);
  });

  const data = registrySheet.getDataRange().getValues();
  if (!data.length) return;

  const headers = data[0];
  const col_sheetName = headers.indexOf("Sheet Name");
  const col_fieldName = headers.indexOf("Field Name");
  const col_index = headers.indexOf("Column Index");

  let repairs = 0;

  for (let i = 1; i < data.length; i++) {
    const sName = data[i][col_sheetName];
    const fName = data[i][col_fieldName];
    if (!sName || !fName) continue;

    const targetSheet = ss.getSheetByName(sName);
    if (!targetSheet) continue;

    const actualHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    const actualIdx = actualHeaders.indexOf(fName);

    if (actualIdx !== -1 && actualIdx !== data[i][col_index]) {
      registrySheet.getRange(i + 1, col_index + 1).setValue(actualIdx);
      repairs++;
    }
  }

  console.log(`Repair Complete: Added ${addedTotal} rows and updated ${repairs} column mappings.`);
}

/**
 * Deprecated: this placeholder was left over from the old maintenance flow.
 * The engine now owns environment validation and header repair directly.
 */
function finalizeMaintenance(summary) {
  console.warn("finalizeMaintenance() is deprecated; use Engine.Maintenance.runHealthCheck() or Engine.Maintenance.resetHeaders(ctx) instead.");
  return summary || "Deprecated maintenance call";
}
/**
 * Deprecated bootstrap helper. Prefer using Engine.getContext() and the maintenance
 * primitives in Engine.Maintenance directly.
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