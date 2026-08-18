/*UPDATE_NOTES 8/17/26
It seems like much of this is now in the engine_core.gs 
What is worth keeping? 
- setControlPanelValue()
- getUIFriendlySchema()
- runSystemHealthCheck()
*/

// ==============================================================================
// FILE: Config.gs
// PURPOSE: Loads UI Settings, Status Colors, and the dynamic Map Registry.
// ==============================================================================

/**
 * Legacy compatibility wrappers.
 * These old config helpers now delegate to the canonical engine context so the
 * older scripts keep working while the engine remains the single source of truth.
 */
function getGlobalConfig() {
  const ctx = Engine.getContext();
  return ctx.config || {};
}

function loadDynamicMaps() {
  const ctx = Engine.getContext();
  return ctx.maps || {};
}
/**
 * Writes or updates a Field:Value pair in the Control Panel.
 */
function setControlPanelValue(fieldName, value) {
  //UPDATE_NOTES 8/17/26
  //KEEP

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
 * creates missing infrastructure sheets (ControlPanel/Status/Lookup) with defaults if they don't exist.
 * Run this if you ever delete a core tab by accident.
 */
function runSystemHealthCheck() {
  //UPDATE_NOTES 8/17/26
  //What is the difference between this function and Engine.Maintenance.runHealthCheck()
  //KEEP

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
  //UPDATE_NOTE 8/17/26
  //KEEP for now

  runSystemHealthCheck();
  // Add basic defaults to Control Panel if empty
  setControlPanelValue("Default Event Duration Hours", 2);
  setControlPanelValue("Start Sync Date", 14);
  setControlPanelValue("End Sync Date", 365);
}

/**
 * Legacy compatibility for older sheet-setting lookups.
 * This now delegates to the canonical engine context instead of a separate,
 * stale config cache.
 */
function loadSheetSettings() {
  const ctx = Engine.getContext();
  const out = {};

  Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
    const def = ctx.sheetDefs[sheetName];
    if (def && def.settings) {
      out[sheetName] = {
        idKey: def.settings.idKey,
        behavior: def.settings.behavior,
        syncMode: def.settings.syncMode,
        protected: def.settings.isProtected === true
      };
    }
  });

  return out;
}

/**
 * UI BRIDGE: Returns the schema for a sheet so the UI can build forms.
 */
function getUIFriendlySchema(sheetName) {
  //UPDATE_NOTE 8/17/26
  //KEEP

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