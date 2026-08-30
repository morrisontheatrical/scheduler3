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
      const sheetDef = (ctx.sheetDefs && ctx.sheetDefs[sheetName]) || ctx.schema[sheetName];
      if (sheetDef && sheetDef.settings && sheetDef.settings.isProtected) return; // Sheet_Settings.isProtected

      const sheet = ctx.ss.getSheetByName(sheetName);
      if (!sheet) {
        reports.push(`❌ Missing Sheet: ${sheetName}`);
        return;
      }

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const map = sheetDef.map;
      const displayNames = new Set();

      Object.keys(map).forEach(fieldName => {
        const columnIndex = Engine.getColumnIndex(map, fieldName);
        const expectedDisplay = Engine.getDisplayName(sheetDef, fieldName);
        displayNames.add(expectedDisplay);
        if (columnIndex < 0 || headers[columnIndex] !== expectedDisplay) {
          reports.push(`⚠️ Header Mismatch in ${sheetName}: Expected "${expectedDisplay}" (field: ${fieldName}) at index ${columnIndex}, found "${headers[columnIndex] || ""}"`);
        }
      });

      headers.forEach(header => {
        const headerText = String(header || "").trim();
        if (headerText && !displayNames.has(headerText)) {
          reports.push(`⚠️ Unmapped physical header in ${sheetName}: "${headerText}"`);
        }
      });
    });

    // Status coverage check — derived entirely from the sheets (no hardcoded
    // status list): every SyncStatus value actually present on any data sheet
    // must resolve to a row on the Status sheet, otherwise that row paints
    // nothing. The Status sheet remains the single source of truth.
    const statusesInData = {};
    Object.keys(ctx.sheetDefs || ctx.schema || {}).forEach(sheetName => {
      const sheetDef = (ctx.sheetDefs && ctx.sheetDefs[sheetName]) || ctx.schema[sheetName];
      if (!sheetDef || !sheetDef.map) return;
      const syncIdx = Engine.getColumnIndex(sheetDef.map, "SyncStatus");
      if (syncIdx < 0) return;
      const sheet = ctx.ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;
      sheet.getRange(2, syncIdx + 1, sheet.getLastRow() - 1, 1).getValues().forEach(([v]) => {
        const name = String(v || "").trim();
        if (name) statusesInData[name] = true;
      });
    });
    Object.keys(statusesInData).forEach(statusName => {
      if (!ctx.status || !ctx.status[statusName]) {
        reports.push(`❌ Status sheet is missing a row for status found in data: "${statusName}"`);
      }
    });

    return reports.length > 0 ? reports : ["✅ System Healthy"];
  },

  /**
   * 2. GRANULAR RESET
   * options: { target: "SHEET_NAME", type: "HEADERS" | "CONTENT" | "FULL" }
   * Single-target, interactive (UI-confirmed), and the only one of the
   * maintenance functions that can touch actual row data — deliberately
   * separate from the automated repair/reset-header functions above.
   */
  reset: function(options) {
    const ui = SpreadsheetApp.getUi();
    const ctx = Engine.getContext();
    const sheetDef = ctx.schema[options.target];

    if (sheetDef && sheetDef.settings && sheetDef.settings.isProtected) {
      ui.alert('Blocked', `${options.target} is marked isProtected in Sheet_Settings and can't be reset from here.`, ui.ButtonSet.OK);
      return;
    }

    const response = ui.alert('CAUTION', `Are you sure you want to reset ${options.target} (${options.type})?`, ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) return;

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(options.target);
    const map = sheetDef.map;

    switch (options.type) {
      case "HEADERS": {
        const headerRow = [];
        Object.keys(map).forEach(fieldName => {
          const columnIndex = Engine.getColumnIndex(map, fieldName);
          if (columnIndex >= 0) headerRow[columnIndex] = Engine.getDisplayName(sheetDef, fieldName);
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

  /**
   * 3. SURGICAL HEADER REPAIR
   * Fixes only the cells that don't match Map_Registry's Header DisplayName
   * — leaves everything else in row 1 untouched. Safe to run broadly;
   * skips anything Sheet_Settings marks isProtected.
   */
  repairHeaders: function(options) {
    const ctx = Engine.getContext();
    const results = [];
    options = options || {};

    Object.keys(ctx.schema).forEach(sheetName => {
      const sheetDef = ctx.schema[sheetName];
      if (!sheetDef) return;
      if (sheetDef.settings && sheetDef.settings.isProtected) {
        if (!options.confirmProtected) return;
        const ui = SpreadsheetApp.getUi();
        const response = ui.alert(
          "Confirm protected sheet overwrite",
          `Rewrite headers on protected sheet ${sheetName} from Map_Registry?`,
          ui.ButtonSet.YES_NO
        );
        if (response !== ui.Button.YES) return;
      }

      const sheet = ctx.ss.getSheetByName(sheetName);
      if (!sheet) return;

      const map = sheetDef.map;
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

      let updated = false;
      Object.keys(map).forEach(fieldName => {
        const colIdx = Engine.getColumnIndex(map, fieldName);
        const displayName = Engine.getDisplayName(sheetDef, fieldName);
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

    const lData = lookupSheet.getDataRange().getValues().slice(1);
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

    const targets = {
      "Lineup": {
        "Venue": venueList
      },
      "Crew_Calendar_Log": {
        "Location": venueList,
        "Options": optionsList
      }
    };

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
  },

  /**
   * 4. WHOLESALE HEADER REWRITE
   * Rebuilds row 1 entirely from Map_Registry, for every non-protected
   * managed sheet, in one bulk write per sheet. Heavier than repairHeaders()
   * — overwrites even cells that already matched. Skips anything
   * Sheet_Settings marks isProtected.
   */
  resetHeaders: function(ctx, options) {
    const ss = ctx.ss;
    const sheetDefs = ctx.sheetDefs || {};
    options = options || {};

    for (const [sheetName, sheetDef] of Object.entries(sheetDefs)) {
      if (sheetDef.settings && sheetDef.settings.isProtected) {
        if (!options.confirmProtected) {
          console.warn(`Maintenance: Skipping header reset for protected sheet "${sheetName}" (Sheet_Settings.isProtected).`);
          continue;
        }
        const ui = SpreadsheetApp.getUi();
        const response = ui.alert(
          "Confirm protected sheet overwrite",
          `Rewrite headers on protected sheet ${sheetName} from Map_Registry?`,
          ui.ButtonSet.YES_NO
        );
        if (response !== ui.Button.YES) continue;
      }

      const sheet = sheetDef.sheet || ss.getSheetByName(sheetName);
      const columnMap = sheetDef.map || {};
      if (!sheet) {
        console.warn(`Maintenance: Sheet "${sheetName}" defined in Map_Registry not found.`);
        continue;
      }

      const indices = Object.keys(columnMap)
        .map(fieldName => Engine.getColumnIndex(columnMap, fieldName))
        .filter(index => index >= 0);
      if (!indices.length) continue;
      const maxCol = Math.max(...indices);

      const newHeaders = new Array(maxCol + 1).fill("");
      for (const fieldName of Object.keys(columnMap)) {
        const colIdx = Engine.getColumnIndex(columnMap, fieldName);
        if (colIdx < 0) continue;
        newHeaders[colIdx] = Engine.getDisplayName(sheetDef, fieldName);
      }

      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      //sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight("bold").setBackground("#eeeeee");

      Engine.Log.write(ctx, {
        stage: "MAINTENANCE",
        sheetName: sheetName,
        type: "HEADER_RESET",
        details: "Headers synchronized with Map_Registry."
      });
    }
    console.log("All eligible sheet headers have been calibrated to the Map_Registry.");
  },

  /**
   * 5. MAP_REGISTRY <-> PHYSICAL HEADER DIFF (private helper)
   * Header DisplayName is intent, never identity — a registry row is
   * considered present as long as ITS OWN recorded Column Index still holds
   * a non-blank physical header, regardless of what that text says. Field
   * Name (the stable cross-sheet identity key) is used only as a fallback,
   * to reunite a row with its column if something got reordered.
   * Stays local to this file while it's still being proven out — candidate
   * for scriptLib promotion once stable and genuinely reused elsewhere.
   *
   * registryEntries: [{ fieldName, displayName, rowNumber, notes, index }]
   * physicalHeaders: [ "Header Text", ... ]
   */
  _diffHeaders: function(physicalHeaders, registryEntries) {
    const matched = [];
    const orphaned = [];
    const duplicateEntries = [];
    const claimedIndices = new Set();
    const seenEntries = new Map();

    registryEntries.forEach(entry => {
      const identity = `${entry.fieldName.toLowerCase()}|${entry.index}`;
      if (seenEntries.has(identity)) {
        duplicateEntries.push({ entry: entry, original: seenEntries.get(identity) });
        return;
      }
      seenEntries.set(identity, entry);

      const text = String(physicalHeaders[entry.index] || "").trim();
      if (text && !claimedIndices.has(entry.index)) {
        matched.push({ entry: entry, physicalText: text });
        claimedIndices.add(entry.index);
      } else {
        orphaned.push(entry);
      }
    });

    const unclaimed = [];
    physicalHeaders.forEach((text, physicalIndex) => {
      const headerText = String(text || "").trim();
      if (headerText && !claimedIndices.has(physicalIndex)) {
        unclaimed.push({ physicalIndex, physicalText: headerText });
      }
    });

    const reunited = [];
    const stillOrphaned = [];
    orphaned.forEach(entry => {
      const displayName = String(entry.displayName || "").trim().toLowerCase();
      const fieldName = String(entry.fieldName || "").trim().toLowerCase();
      let matchIdx = unclaimed.findIndex(u => u.physicalText.toLowerCase() === displayName);
      if (matchIdx === -1) {
        matchIdx = unclaimed.findIndex(u => u.physicalText.toLowerCase() === fieldName);
      }
      if (matchIdx === -1) {
        stillOrphaned.push(entry);
      } else {
        reunited.push({ entry: entry, physicalIndex: unclaimed[matchIdx].physicalIndex });
        unclaimed.splice(matchIdx, 1);
      }
    });

    return {
      matched: matched,
      reunited: reunited,
      newPhysical: unclaimed,
      staleRegistry: stillOrphaned,
      duplicateEntries: duplicateEntries
    };
  },

  /**
   * 6. MAP_REGISTRY REPAIR
   * Scans physical sheet headers and updates Map_Registry to match reality.
   * Run this if columns have been moved or added. Never silently deletes
   * registry rows or overwrites physical workbook headers.
   */
  repairMapRegistry: function() {
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
    const protectedSheetNames = new Set();
    if (settingsSheet && settingsSheet.getLastRow() > 1) {
      // Column E (index 4) is isProtected on Sheet_Settings.
      const settings = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 5).getValues();
      settings.forEach(row => {
        const sheetName = String(row[0] || "").trim();
        if (!sheetName) return;
        managedSheetNames.add(sheetName);
        if (String(row[4] || "").trim() === "Yes") protectedSheetNames.add(sheetName);
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
        notes: String(data[i][colNotes] || ""),
        index: Number(data[i][colIndex])
      });
    }

    const reports = [];
    let added = 0, updated = 0, staleFlagged = 0;
    const staleTag = "[STALE: no matching column]";

    // ONE pass over managed sheets — do not nest a second forEach here.
    managedSheetNames.forEach(sheetName => {
      const targetSheet = ss.getSheetByName(sheetName);
      if (!targetSheet) {
        reports.push(`Managed sheet not found: ${sheetName}`);
        return;
      }
      if (protectedSheetNames.has(sheetName)) return; // Sheet_Settings.isProtected — import/Lookup/Status/ref

      const physicalHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
      const registryEntries = bySheet.get(sheetName) || [];

      const diff = Engine.Maintenance._diffHeaders(physicalHeaders, registryEntries);

      // A column at its recorded index is the association. The physical header
      // is authoritative for Header DisplayName; Field Name remains stable.
      diff.matched.forEach(({ entry, physicalText }) => {
        if (entry.displayName === physicalText) return;
        registrySheet.getRange(entry.rowNumber, colDisplayName + 1).setValue(physicalText);
        updated++;
        reports.push(`Updated display name in ${sheetName}: field "${entry.fieldName}" is now "${physicalText}".`);
      });

      diff.reunited.forEach(({ entry, physicalIndex }) => {
        registrySheet.getRange(entry.rowNumber, colIndex + 1).setValue(physicalIndex);
        updated++;
        if (entry.notes.indexOf(staleTag) === 0) {
          registrySheet.getRange(entry.rowNumber, colNotes + 1).setValue(entry.notes.replace(staleTag, "").trim());
        }
        reports.push(`Reunited in ${sheetName}: "${entry.fieldName}" now at column ${physicalIndex}.`);
      });

      diff.duplicateEntries.forEach(({ entry, original }) => {
        reports.push(`Duplicate registry entry in ${sheetName}: "${entry.fieldName}" at index ${entry.index} duplicates row ${original.rowNumber}; no row was deleted.`);
      });

      diff.newPhysical.forEach(({ physicalIndex, physicalText }) => {
        const newRow = new Array(headers.length).fill("");
        newRow[colSheetName] = sheetName;
        newRow[colFieldName] = physicalText;
        newRow[colIndex] = physicalIndex;
        newRow[colDisplayName] = physicalText;
        newRow[colNotes] = "[NEW: verify Field Name — auto-filled from physical header]";
        registrySheet.appendRow(newRow);
        added++;
        reports.push(`New physical header in ${sheetName} at index ${physicalIndex}: "${physicalText}" — added, please confirm Field Name.`);
      });

      diff.staleRegistry.forEach(entry => {
        if (entry.notes.indexOf(staleTag) === 0) return;
        const combinedNotes = entry.notes ? `${staleTag} ${entry.notes}` : staleTag;
        registrySheet.getRange(entry.rowNumber, colNotes + 1).setValue(combinedNotes);
        staleFlagged++;
        reports.push(`Stale registry entry in ${sheetName}: "${entry.fieldName}" — no column at its recorded index, and no unclaimed column with a matching Field Name. Flagged, not deleted.`);
      });
    });

    const summary = `Repair Complete: Added ${added}, reunited/updated ${updated} column indices, flagged ${staleFlagged} stale.`;
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
};

Engine.Maintenance.repairBlankHashes = function(ctx, options) {
  ctx = ctx || Engine.getContext();
  options = options || {};
  const hashMaintenance = Engine.getLibraryModule("HashMaintenance");
  if (!hashMaintenance || typeof hashMaintenance.repopulateSheetHashes !== "function") {
    throw new Error("scriptLib.SL.HashMaintenance.repopulateSheetHashes is unavailable");
  }

  const identityFieldsBySheet = {
    "Lineup": { title: "EventName", date: "Date", time: "Time", venue: "Venue" },
    "Parent Lineup": { title: "EventName", date: "Opening", time: "DatesAndTimes", venue: "Venue" },
    "import": { title: "EventName", date: "Opening", time: "DatesAndTimes", venue: "Venue" },
    "Calls": { title: "Title", date: "Date", time: "CallTime", venue: "Location" },
    "Crew_Calendar_Log": { title: "Title", date: "Date", time: "Start", venue: "Location" },
    "Venue_Cal_Log": { title: "Title", date: "Date", time: "Start", venue: "Location" }
  };
  const reports = [];
  let repaired = 0;

  Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
    const sheetDef = ctx.sheetDefs[sheetName];
    const sheet = sheetDef && sheetDef.sheet;
    const map = sheetDef && sheetDef.map;
    const hashCol = Engine.getColumnIndex(map, "SyncHash");
    if (!sheet || !map || hashCol < 0) return;
    if (sheetDef.settings && sheetDef.settings.isProtected && !options.confirmProtected) {
      reports.push(`Skipped protected sheet ${sheetName}`);
      return;
    }

    const data = sheet.getDataRange().getValues();
    const blankRows = [];
    data.slice(1).forEach((row, index) => {
      if (row[hashCol] === "" || row[hashCol] === null || row[hashCol] === undefined) blankRows.push(index + 2);
    });
    if (!blankRows.length) return;

    const fieldNames = identityFieldsBySheet[sheetName] || { title: "Title", date: "Date", time: "Start", venue: "Location" };
    const count = hashMaintenance.repopulateSheetHashes(
      sheetName,
      map,
      ctx.ss,
      fieldNames,
      { blankOnly: true }
    );
    const now = new Date();
    const lastSyncedCol = Engine.getColumnIndex(map, "LastSynced");
    const lastUpdatedCol = Engine.getColumnIndex(map, "LastUpdated");
    blankRows.forEach(rowNumber => {
      if (lastSyncedCol >= 0) sheet.getRange(rowNumber, lastSyncedCol + 1).setValue(now);
      if (lastUpdatedCol >= 0) sheet.getRange(rowNumber, lastUpdatedCol + 1).setValue(now);
    });
    repaired += count;
    reports.push(`Repaired ${count} blank hash(es) in ${sheetName}`);
  });

  Engine.Log.write(ctx, {
    stage: "MAINTENANCE",
    type: "HASH_REPAIR",
    details: `Blank hash repair completed: ${repaired} row(s). ${reports.join(" | ")}`
  });
  return { repaired: repaired, reports: reports };
};

// Explicit registry operations. These are intentionally separate from repair:
// repair may add or move metadata, but it never deletes registry rows.
Engine.Maintenance.readHeadersToRegistry = function() {
  return Engine.Maintenance.repairMapRegistry();
};

Engine.Maintenance.writeHeadersFromRegistry = function(ctx, options) {
  ctx = ctx || Engine.getContext();
  return Engine.Maintenance.resetHeaders(ctx, options);
};

Engine.Maintenance.createRegistry = function() {
  return Engine.Maintenance.repairMapRegistry();
};

Engine.Maintenance.deleteRegistry = function(options) {
  options = options || {};
  if (!options.sheetName || !options.fieldName) {
    throw new Error("deleteRegistry requires sheetName and fieldName");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName("Map_Registry");
  if (!registrySheet) return false;
  const data = registrySheet.getDataRange().getValues();
  const headers = data[0] || [];
  const sheetCol = headers.indexOf("Sheet Name");
  const fieldCol = headers.indexOf("Field Name");
  if (sheetCol < 0 || fieldCol < 0) throw new Error("Map_Registry is missing Sheet Name or Field Name");

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][sheetCol]).trim() === options.sheetName && String(data[i][fieldCol]).trim() === options.fieldName) {
      registrySheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
};

// Thin global wrappers — required so Apps Script custom menus (0_OnOpen.js
// uses .addItem('...', 'repairMapRegistry') / 'resetHeadersMenu') can resolve
// them. Menu bindings need top-level function names; they cannot call a
// dotted path like Engine.Maintenance.repairMapRegistry directly. This is
// what "repairMapRegistry is defined but never used" was pointing at once
// the implementation moved under Engine.Maintenance.
function repairMapRegistry() {
  return Engine.Maintenance.repairMapRegistry();
}

function resetHeadersMenu() {
  const ctx = Engine.getContext();
  Engine.Maintenance.resetHeaders(ctx);
}

function repairHeadersMenu() {
  return Engine.Maintenance.repairHeaders();
}

function writeHeadersFromRegistryMenu() {
  const ctx = Engine.getContext();
  return Engine.Maintenance.writeHeadersFromRegistry(ctx);
}

function readHeadersToRegistry() {
  return Engine.Maintenance.readHeadersToRegistry();
}

function writeHeadersFromRegistry(confirmProtected) {
  const ctx = Engine.getContext();
  return Engine.Maintenance.writeHeadersFromRegistry(ctx, { confirmProtected: Boolean(confirmProtected) });
}

function createRegistry() {
  return Engine.Maintenance.createRegistry();
}

function deleteRegistry(sheetName, fieldName) {
  return Engine.Maintenance.deleteRegistry({ sheetName: sheetName, fieldName: fieldName });
}

function repairBlankHashes() {
  return Engine.Maintenance.repairBlankHashes(Engine.getContext());
}

/**
 * Deprecated: this placeholder was left over from the old maintenance flow.
 * The engine now owns environment validation and header repair directly.
 */
function finalizeMaintenance(summary) {
  console.warn("finalizeMaintenance() is deprecated; use Engine.Maintenance.runHealthCheck() or Engine.Maintenance.resetHeaders(ctx) instead.");
  return summary || "Deprecated maintenance call";
}

function getSheetByRole(roleName) {
  const ctx = Engine.getContext();
  const sheetName = ctx.getRole(roleName);
  if (!sheetName) throw new Error(`No sheet found for role "${roleName}"`);
  const sheet = ctx.ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" (role "${roleName}") not found in spreadsheet`);
  return sheet;
}

/**
 * Canonical color palette for the Status sheet. Add a row here if you
 * introduce a new Color name; both directions of sync key off this list.
 * Scoped to the 7 named colors the Status sheet already uses.
 */
Engine.ColorPalette = {
  entries: [
    { name: "Light Green", hex: "#d9ead3" },
    { name: "Yellow/Tan",  hex: "#fff2cc" },
    { name: "Pink/Red",    hex: "#f4cccc" },
    { name: "Orange",      hex: "#f9cb9c" },
    { name: "Red",         hex: "#ea9999" },
    { name: "Yellow",      hex: "#ffd966" },
    { name: "Green",       hex: "#93c47d" }
  ],

  hexForName: function(name) {
    const match = this.entries.find(e => e.name.toLowerCase() === String(name || "").trim().toLowerCase());
    return match ? match.hex : "";
  },

  // Exact match first; otherwise nearest palette entry by RGB distance, so a
  // manually-typed close-but-not-exact hex still resolves to a known name.
  nameForHex: function(hex) {
    const clean = String(hex || "").trim().toLowerCase();
    if (!/^#?[0-9a-f]{6}$/i.test(clean)) return "";
    const normalized = clean.startsWith("#") ? clean : `#${clean}`;
    const exact = this.entries.find(e => e.hex.toLowerCase() === normalized);
    if (exact) return exact.name;

    const toRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const targetRgb = toRgb(normalized);
    let best = "", bestDist = Infinity;
    this.entries.forEach(e => {
      const rgb = toRgb(e.hex.toLowerCase());
      const dist = rgb.reduce((sum, c, i) => sum + Math.pow(c - targetRgb[i], 2), 0);
      if (dist < bestDist) { bestDist = dist; best = e.name; }
    });
    return best;
  }
};

/**
 * Installable edit trigger — keeps Hex and Color columns on the Status sheet
 * in sync with each other. Must be added manually: Apps Script editor >
 * Triggers > Add Trigger > Function: onEditStatusColorSync > Event: On edit.
 * (Not the bare global onEdit(e), so it doesn't collide with other
 * sheet-wide edit handling.)
 */
function onEditStatusColorSync(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== "Status") return;

  const editedRow = e.range.getRow();
  if (editedRow === 1) return; // header row

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hexCol = headers.indexOf("Hex") + 1;
  const colorCol = headers.indexOf("Color") + 1;
  if (!hexCol || !colorCol) return;

  const editedCol = e.range.getColumn();
  if (editedCol === hexCol) {
    const name = Engine.ColorPalette.nameForHex(sheet.getRange(editedRow, hexCol).getValue());
    if (name) sheet.getRange(editedRow, colorCol).setValue(name);
  } else if (editedCol === colorCol) {
    const hex = Engine.ColorPalette.hexForName(sheet.getRange(editedRow, colorCol).getValue());
    if (hex) sheet.getRange(editedRow, hexCol).setValue(hex);
  }
}

/**
 * Bulk resync — run once after installing the trigger, or any time the
 * Status sheet is edited outside the trigger (e.g. pasted values).
 */
function resyncStatusColors() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Status");
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hexCol = headers.indexOf("Hex") + 1;
  const colorCol = headers.indexOf("Color") + 1;
  if (!hexCol || !colorCol) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const hexValues = sheet.getRange(2, hexCol, lastRow - 1, 1).getValues();
  const colorValues = hexValues.map(([hex]) => [Engine.ColorPalette.nameForHex(hex) || ""]);
  sheet.getRange(2, colorCol, colorValues.length, 1).setValues(colorValues);
}

