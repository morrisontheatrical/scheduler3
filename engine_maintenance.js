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

    Object.keys(ctx.sheetDefs || ctx.schema).forEach(sheetName => {
      const sheet = ctx.ss.getSheetByName(sheetName);
      if (!sheet) {
        reports.push(`❌ Missing Sheet: ${sheetName}`);
        return;
      }

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const map = (ctx.sheetDefs[sheetName] || ctx.schema[sheetName]).map;
      const mappedFields = new Set();

      // Lookup is a headerless validation-data sheet by design.
      if (sheetName === "Lookup") return;

      Object.keys(map).forEach(fieldName => {
        const columnIndex = Engine.getColumnIndex(map, fieldName);
        mappedFields.add(fieldName);
        if (columnIndex < 0 || headers[columnIndex] !== fieldName) {
          reports.push(`⚠️ Header Mismatch in ${sheetName}: Expected "${fieldName}" at index ${columnIndex}, found "${headers[columnIndex] || ""}"`);
        }
      });

      headers.forEach(header => {
        const fieldName = String(header || "").trim();
        if (fieldName && !mappedFields.has(fieldName)) {
          reports.push(`⚠️ Unmapped physical header in ${sheetName}: "${fieldName}"`);
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

    switch (options.type) {
      case "HEADERS": {
        const headerRow = [];
        Object.keys(map).forEach(fieldName => {
          const columnIndex = Engine.getColumnIndex(map, fieldName);
          if (columnIndex >= 0) headerRow[columnIndex] = fieldName;
        });
        sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
        break;
      }

      case "SYNC_ONLY":
        ["SyncStatus", "LastSynced", "UpdateDetails"].forEach(fieldName => {
          const columnIndex = Engine.getColumnIndex(map, fieldName);
          if (columnIndex >= 0) sheet.getRange(2, columnIndex + 1, sheet.getLastRow(), 1).clearContent();
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
      Object.keys(map).forEach(fieldName => {
        const colIdx = Engine.getColumnIndex(map, fieldName);
        if (colIdx >= 0 && headers[colIdx] !== fieldName) {
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
      if (colIdx < 0) return [];
      return lData
        .map(row => row[colIdx])
        .filter(val => val !== "" && val !== null && val !== undefined);
    };

    const venueList = getList(Engine.getColumnIndex(lMap, "Venue"));
    const crewList = getList(Engine.getColumnIndex(lMap, "CrewStaff"));
    const callTypeList = getList(Engine.getColumnIndex(lMap, "CallType"));
    const optionsList = getList(Engine.getColumnIndex(lMap, "Options"));

    // 2. Define Targets (Which sheets get which dropdowns)
    // Format: { sheetName: { columnName: list } }
    const targets = {
      "Lineup": {
        "Venue": venueList
      },
      "Crew_Calendar_Log": {
        "Location": venueList,
        "Options": optionsList
      }
    };

    // 3. Apply Validation
    for (const [sheetName, config] of Object.entries(targets)) {
      const targetSheet = ss.getSheetByName(sheetName);
      const targetMap = ctx.maps[sheetName];
      if (!targetSheet || !targetMap) continue;

      for (const [colName, list] of Object.entries(config)) {
        const colIdx = Engine.getColumnIndex(targetMap, colName);
        if (colIdx < 0) continue;

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
  const sheetDefs = ctx.sheetDefs || {};
  const headerlessSheets = new Set(["Lookup", "import"]);

  for (const [sheetName, sheetDef] of Object.entries(sheetDefs)) {
    if (headerlessSheets.has(sheetName)) {
      console.warn(`Maintenance: Skipping header reset for headerless/raw sheet "${sheetName}".`);
      continue;
    }

    const sheet = sheetDef.sheet || ss.getSheetByName(sheetName);
    const columnMap = sheetDef.map || {};
    if (!sheet) {
      console.warn(`Maintenance: Sheet "${sheetName}" defined in Map_Registry not found.`);
      continue;
    }

    // Determine the max column index defined in the map
    const indices = Object.keys(columnMap)
      .map(fieldName => Engine.getColumnIndex(columnMap, fieldName))
      .filter(index => index >= 0);
    if (!indices.length) continue;
    const maxCol = Math.max(...indices);
    
    // Create a header array of the necessary length
    const newHeaders = new Array(maxCol + 1).fill("");

    // Fill the header array based on the Map_Registry keys
    for (const headerName of Object.keys(columnMap)) {
      const colIdx = Engine.getColumnIndex(columnMap, headerName);
      if (colIdx < 0) continue;
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
  console.log("All eligible sheet headers have been calibrated to the Map_Registry.");
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
function repairMapRegistry() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let registrySheet = ss.getSheetByName("Map_Registry");
  if (!registrySheet) {
    registrySheet = ss.insertSheet("Map_Registry");
    registrySheet.appendRow(["Sheet Name", "Field Name", "Column Index", "Header Name", "Label", "Role", "Behavior", "Sync Mode"]);
  }

  const data = registrySheet.getDataRange().getValues();
  if (!data.length) return ["Map_Registry has no header row."];

  const headers = data[0];
  const colSheetName = headers.indexOf("Sheet Name");
  const colFieldName = headers.indexOf("Field Name");
  const colIndex = headers.indexOf("Column Index");
  const colRole = headers.indexOf("Role");
  const reports = [];

  if (colSheetName === -1 || colFieldName === -1 || colIndex === -1) {
    return ["Map_Registry is missing Sheet Name, Field Name, or Column Index headers."];
  }

  const settingsSheet = ss.getSheetByName("Sheet_Settings");
  const managedSheetNames = new Set();
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    const settings = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 1).getValues();
    settings.forEach(row => {
      const sheetName = String(row[0] || "").trim();
      if (sheetName) managedSheetNames.add(sheetName);
    });
  }

  const registrySheetNames = new Set();
  const registryRows = new Map();
  for (let i = 1; i < data.length; i++) {
    const sheetName = String(data[i][colSheetName] || "").trim();
    const fieldName = String(data[i][colFieldName] || "").trim();
    if (!sheetName || !fieldName) continue;

    registrySheetNames.add(sheetName);
    const key = `${sheetName}::${fieldName}`;
    if (!registryRows.has(key)) registryRows.set(key, []);
    registryRows.get(key).push({ rowNumber: i + 1, row: data[i] });
  }

  const sheetNames = managedSheetNames.size ? managedSheetNames : registrySheetNames;
  registrySheetNames.forEach(sheetName => {
    if (!sheetNames.has(sheetName)) reports.push(`Registry entry has no managed sheet: ${sheetName}`);
  });

  let added = 0;
  let updated = 0;

  sheetNames.forEach(sheetName => {
    const targetSheet = ss.getSheetByName(sheetName);
    if (!targetSheet) {
      reports.push(`Managed sheet not found: ${sheetName}`);
      return;
    }

    const actualHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    const physicalFields = new Map();
    actualHeaders.forEach((header, index) => {
      const fieldName = String(header || "").trim();
      if (!fieldName) return;
      if (physicalFields.has(fieldName)) {
        reports.push(`Duplicate header in ${sheetName}: ${fieldName}`);
      } else {
        physicalFields.set(fieldName, index);
      }
    });

    physicalFields.forEach((physicalIndex, fieldName) => {
      const key = `${sheetName}::${fieldName}`;
      const matches = registryRows.get(key) || [];
      if (matches.length > 1) reports.push(`Duplicate registry entry: ${key}`);

      if (!matches.length) {
        const newRow = new Array(headers.length).fill("");
        newRow[colSheetName] = sheetName;
        newRow[colFieldName] = fieldName;
        newRow[colIndex] = physicalIndex;
        if (colRole !== -1) newRow[colRole] = "System";
        registrySheet.appendRow(newRow);
        added++;
        return;
      }

      const registryRow = matches[0];
      if (Number(registryRow.row[colIndex]) !== physicalIndex) {
        registrySheet.getRange(registryRow.rowNumber, colIndex + 1).setValue(physicalIndex);
        updated++;
      }
    });

    registryRows.forEach((matches, key) => {
      if (!key.startsWith(`${sheetName}::`)) return;
      const fieldName = key.slice(sheetName.length + 2);
      if (!physicalFields.has(fieldName)) reports.push(`Registry field not found in ${sheetName}: ${fieldName}`);
    });
  });

  const details = `Repair Complete: Added ${added} rows and updated ${updated} column mappings.`;
  console.log(details);
  reports.forEach(report => console.warn(report));

  try {
    const ctx = Engine.getContext();
    Engine.Log.write(ctx, {
      stage: "MAINTENANCE",
      type: "MAP_REPAIR",
      details: `${details}${reports.length ? ` Warnings: ${reports.join(" | ")}` : ""}`
    });
  } catch (error) {
    console.warn(`Map registry repair completed, but Audit_Log could not be updated: ${error.message}`);
  }

  return [details].concat(reports);
}

/**
 * Deprecated: this placeholder was left over from the old maintenance flow.
 * The engine now owns environment validation and header repair directly.
 */
function finalizeMaintenance(summary) {
  console.warn("finalizeMaintenance() is deprecated; use Engine.Maintenance.runHealthCheck() or Engine.Maintenance.resetHeaders(ctx) instead.");
  return summary || "Deprecated maintenance call";
}