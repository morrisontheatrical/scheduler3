// ==============================================================================
// FILE: Config.gs
// PURPOSE: Loads UI Settings, Status Colors, and the dynamic Map Registry.
// ==============================================================================

/**
 * Loads the Control Panel settings into a simple object.
 */
function getGlobalConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = {};

  const cpSheet = ss.getSheetByName("ControlPanel");
  if (cpSheet) {
    const data = cpSheet.getRange("A2:B40").getValues(); 
    data.forEach(row => {
      if (row[0]) {
        let val = row[1];
        
        // Normalize Booleans
        if (val === "TRUE" || val === true) val = true;
        if (val === "FALSE" || val === false) val = false;

        const cleanKey = row[0].toString().replace(/[^a-zA-Z0-9]/g, ''); 
        config[cleanKey] = val;
        
        // Explicit Overrides
        if (row[0].includes("Start Sync Date")) config.StartSyncDate = parseInt(val) || 14;
        if (row[0].includes("End Sync Date"))   config.EndSyncDate = parseInt(val) || 365;
        if (row[0].includes("Push All"))        config.PushAll = (val === true);
        if (row[0].includes("Mode"))            config.Mode = val;
      }
    });
  }
  
  const durationHours = parseFloat(config.DefaultEventDurationHours) || 2;
  config.DefaultDurationMs = durationHours * 60 * 60 * 1000;

  return config;
}

/**
 * Loads column indices from the Map_Registry sheet.
 * Returns: { "Lineup": { "EventName": 0, "Series": 1 }, "import": { ... } }
 */
function loadDynamicMaps() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mapSheet = ss.getSheetByName("Map_Registry");
  if (!mapSheet) return {};

  const data = mapSheet.getDataRange().getValues();
  data.shift(); // Remove header row

  const maps = {};
  data.forEach(row => {
    const sheetName = String(row[0]).trim();
    const fieldName = String(row[1]).trim();
    const colIndex = parseInt(row[2], 10);

    if (sheetName && fieldName && !isNaN(colIndex)) {
      if (!maps[sheetName]) maps[sheetName] = {};
      maps[sheetName][fieldName] = colIndex;
    }
  });

  return maps;
}
/**
 * Writes or updates a Field:Value pair in the Control Panel.
 */
function setControlPanelValue(fieldName, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cpSheet = ss.getSheetByName("ControlPanel");
  
  if (!cpSheet) {
    cpSheet = ss.insertSheet("ControlPanel");
    cpSheet.appendRow(["Field", "Value"]);
  }

  const data = cpSheet.getRange("A:B").getValues();
  let found = false;

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === fieldName) {
      cpSheet.getRange(i + 1, 2).setValue(value);
      found = true;
      break;
    }
  }

  if (!found) {
    cpSheet.appendRow([fieldName, value]);
  }
}

/**
 * SYSTEM HEALTH: Verifies and repairs the infrastructure sheets.
 * Run this if you ever delete a core tab by accident.
 */
function runSystemHealthCheck() {
  //UPDATE_NOTES 8/17/26
  //What is the difference between this function and Engine.Maintenance.runHealthCheck()

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // --- 1. VERIFY CONTROL PANEL ---
  let cpSheet = ss.getSheetByName("ControlPanel");
  if (!cpSheet) {
    cpSheet = ss.insertSheet("ControlPanel");
    cpSheet.appendRow(["Setting Field", "Value", "Description"]);
    cpSheet.getRange("A1:C1").setFontWeight("bold").setBackground("#efefef");
  }

  // --- 2. VERIFY STATUS SHEET ---
  let statusSheet = ss.getSheetByName("Status");
  if (!statusSheet) {
    statusSheet = ss.insertSheet("Status");
  }

  // Required Statuses for the Engine (Based on your CSVs)
  const statusHeaders = [["Status", "Notes", "Hex", "Color", "Behavior / Option"]];
  const defaultStatuses = [
    ["Synced", "Match confirmed.", "#d9ead3", "Light Green", "SYNC_ALLOWED"],
    ["Manual Review", "Sync error.", "#f9cb9c", "Orange", "Manual Review"],
    ["Bypassed", "Don't Overwrite", "#fff2cc", "Yellow/Tan", "BYPASS"]
  ];

  if (statusSheet.getLastRow() < 1) {
    statusSheet.getRange(1, 1, 1, 5).setValues(statusHeaders)
               .setFontWeight("bold").setBackground("#efefef");
    statusSheet.getRange(2, 1, defaultStatuses.length, 5).setValues(defaultStatuses);
  }

  // --- 3. VERIFY LOOKUP SHEET ---
  let lookupSheet = ss.getSheetByName("Lookup");
  if (!lookupSheet) {
    lookupSheet = ss.insertSheet("Lookup");
  }

  if (lookupSheet.getLastRow() < 1) {
    // We use the headers from your Tester-Lookup.csv
    const lookupHeaders = [["Venue", "CalendarID", "Call Type", "Series", "Crew", "Options"]];
    lookupSheet.getRange(1, 1, 1, 6).setValues(lookupHeaders)
               .setFontWeight("bold").setBackground("#efefef");
  }

  // Final Cleanup
  cpSheet.setFrozenRows(1);
  statusSheet.setFrozenRows(1);
  lookupSheet.setFrozenRows(1);

  SpreadsheetApp.getUi().alert("System Health Verified", 
    "Infrastructure sheets are initialized.\n\nNext Step: Ensure your Map_Registry matches these headers.", 
    SpreadsheetApp.getUi().ButtonSet.OK);
}


/**
 * Maintenance: Run this to align all log sheets to the current Maps.
 */
function runMasterHeaderReset() {
  const ctx = Engine.getContext();
  Engine.Maintenance.resetHeaders(ctx);
}

// Ensure ALL setup logic is inside this function, not floating in the file
function runFirstTimeSetup() {
  runSystemHealthCheck();
  // Add basic defaults to Control Panel if empty
  setControlPanelValue("Default Event Duration Hours", 2);
  setControlPanelValue("Start Sync Date", 14);
  setControlPanelValue("End Sync Date", 365);
}

/**
 * RECONCILER: Loads the Sheet_Settings (ID Keys and Behaviors).
 * This tells the engine which column acts as the Unique ID for each sheet.
 */
function loadSheetSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const setSheet = ss.getSheetByName("Sheet_Settings");
  if (!setSheet) return {};

  const data = setSheet.getDataRange().getValues();
  data.shift(); // Remove headers

  const settings = {};
  data.forEach(row => {
    const [sheetName, idKey, behavior, syncMode, protectedStatus] = row;
    if (sheetName) {
      settings[sheetName] = { 
        idKey: idKey, 
        behavior: behavior, 
        syncMode: syncMode,
        protected: (protectedStatus === "Yes" || protectedStatus === true)
      };
    }
  });
  return settings;
}

/**
 * UI BRIDGE: Returns the schema for a sheet so the UI can build forms.
 */
function getUIFriendlySchema(sheetName) {
  const ctx = Engine.getContext();
  const map = ctx.maps[sheetName];
  const registrySheet = ctx.ss.getSheetByName("Map_Registry");
  const regData = registrySheet.getDataRange().getValues();
  
  // Filter registry for only this sheet's fields
  return regData.filter(row => row[0] === sheetName).map(row => {
    return {
      field: row[1],        // Technical Key (e.g., "EventName")
      index: row[2],        // Column Index
      label: row[4] || row[1] // Display Name for UI (e.g., "Show Title")
    };
  });
}