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
        const colIdx = Engine.getColumnIndex(map, fieldName); //update to Header DisplayName?

        const displayName = Engine.getDisplayName(map, fieldName);
        if (colIdx >= 0 && headers[colIdx] !== displayName) {
          sheet.getRange(1, colIdx + 1).setValue(displayName);
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
    for (const fieldName of Object.keys(columnMap)) {
  const colIdx = Engine.getColumnIndex(columnMap, fieldName);
  if (colIdx < 0) continue;
  newHeaders[colIdx] = Engine.getDisplayName(columnMap, fieldName);
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

// Private helper — stays local to this file while it's still being proven out.
// Candidate for promotion to scriptLib once it's stable and genuinely reused elsewhere; not before.
Engine.Maintenance._diffHeaders = function(physicalHeaders, registryEntries) {
  const remaining = registryEntries.slice();
  const matched = [];
  const newPhysical = [];

  physicalHeaders.forEach((text, physicalIndex) => {
    const headerText = String(text || "").trim();
    if (!headerText) return;

    const matchIdx = remaining.findIndex(entry => {
      const display = String(entry.displayName || entry.fieldName || "").trim();
      return display === headerText;
    });

    if (matchIdx === -1) {
      newPhysical.push({ physicalIndex, physicalText: headerText });
    } else {
      matched.push({ entry: remaining[matchIdx], physicalIndex, physicalText: headerText });
      remaining.splice(matchIdx, 1);
    }
  });

  return { matched: matched, newPhysical: newPhysical, staleRegistry: remaining };
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
    registrySheet.appendRow(["Sheet Name", "Field Name", "Column Index", "Notes", "Header DisplayName", "Data Type", "Sync Behavior"]);
  }

  const data = registrySheet.getDataRange().getValues();
  if (!data.length) return ["Map_Registry has no header row."];

  const headers = data[0];
  const colSheetName = headers.indexOf("Sheet Name");
  const colFieldName = headers.indexOf("Field Name");
  const colIndex = headers.indexOf("Column Index");
  const colNotes = headers.indexOf("Notes");
  const colDisplayName = headers.indexOf("Header DisplayName");

  if ([colSheetName, colFieldName, colIndex, colDisplayName].includes(-1)) {
    return ["Map_Registry is missing one of: Sheet Name, Field Name, Column Index, Header DisplayName."];
  }

  const settingsSheet = ss.getSheetByName("Sheet_Settings");
  const managedSheetNames = new Set();
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 1).getValues().forEach(row => {
      const sheetName = String(row[0] || "").trim();
      if (sheetName) managedSheetNames.add(sheetName);
    });
  }

  // Group existing registry rows by sheet.
  const bySheet = new Map();
  for (let i = 1; i < data.length; i++) {
    const sheetName = String(data[i][colSheetName] || "").trim();
    const fieldName = String(data[i][colFieldName] || "").trim();
    if (!sheetName || !fieldName) continue;
    if (!bySheet.has(sheetName)) bySheet.set(sheetName, []);
    bySheet.get(sheetName).push({
      rowNumber: i + 1,
      fieldName: fieldName,
      displayName: String(data[i][colDisplayName] || "").trim(),
      notes: String(data[i][colNotes] || "")
    });
  }

  const reports = [];
  let added = 0, updated = 0, staleFlagged = 0;
  const staleTag = "[STALE: no matching header]";

  managedSheetNames.forEach(sheetName => {
    const targetSheet = ss.getSheetByName(sheetName);
    if (!targetSheet) {
      reports.push(`Managed sheet not found: ${sheetName}`);
      return;
    }
    // Headerless sheets (Lookup) get no automated repair — the header
    // convention differs, and treating row 1 as headers here would corrupt
    // dropdown data. Repair those by hand, or once Lookup has a real header
    // row (per your latest export), remove this sheet from this skip-list.
    if (sheetName === "Lookup") return;

    const physicalHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
    const registryEntries = bySheet.get(sheetName) || [];

    const diff = Engine.Maintenance._diffHeaders(physicalHeaders, registryEntries);

    diff.matched.forEach(({ entry, physicalIndex }) => {
      const currentIndex = Number(data[entry.rowNumber - 1][colIndex]);
      if (currentIndex !== physicalIndex) {
        registrySheet.getRange(entry.rowNumber, colIndex + 1).setValue(physicalIndex);
        updated++;
      }
      // Clear a stale tag if this field reappeared (e.g. an undo, or a
      // reordered-then-restored column).
      if (entry.notes.indexOf(staleTag) === 0) {
        registrySheet.getRange(entry.rowNumber, colNotes + 1).setValue(entry.notes.replace(staleTag, "").trim());
      }
    });

    diff.newPhysical.forEach(({ physicalIndex, physicalText }) => {
      const newRow = new Array(headers.length).fill("");
      newRow[colSheetName] = sheetName;
      newRow[colFieldName] = physicalText; // best guess — needs human review, flagged below
      newRow[colIndex] = physicalIndex;
      newRow[colDisplayName] = physicalText;
      newRow[colNotes] = "[NEW: verify Field Name — auto-filled from physical header]";
      registrySheet.appendRow(newRow);
      added++;
      reports.push(`New physical header in ${sheetName} at index ${physicalIndex}: "${physicalText}" — added, please confirm Field Name.`);
    });

    diff.staleRegistry.forEach(entry => {
      if (entry.notes.indexOf(staleTag) === 0) return; // already flagged, don't re-stamp every run
      const combinedNotes = entry.notes ? `${staleTag} ${entry.notes}` : staleTag;
      registrySheet.getRange(entry.rowNumber, colNotes + 1).setValue(combinedNotes);
      staleFlagged++;
      reports.push(`Stale registry entry in ${sheetName}: "${entry.fieldName}" (display: "${entry.displayName || entry.fieldName}") — no matching physical header. Flagged, not deleted.`);
    });
  });

  const summary = `Repair Complete: Added ${added}, updated ${updated} column indices, flagged ${staleFlagged} stale.`;
  console.log(summary);
  reports.forEach(r => console.warn(r));

  try {
    const ctx = Engine.getContext();
    Engine.Log.write(ctx, {
      stage: "MAINTENANCE", type: "MAP_REPAIR",
      details: `${summary}${reports.length ? ` | ${reports.join(" | ")}` : ""}`
    });
  } catch (e) {
    console.warn(`Repair completed, but Audit_Log could not be updated: ${e.message}`);
  }

  return [summary].concat(reports);
}

/**
 * Deprecated: this placeholder was left over from the old maintenance flow.
 * The engine now owns environment validation and header repair directly.
 */
function finalizeMaintenance(summary) {
  console.warn("finalizeMaintenance() is deprecated; use Engine.Maintenance.runHealthCheck() or Engine.Maintenance.resetHeaders(ctx) instead.");
  return summary || "Deprecated maintenance call";
}