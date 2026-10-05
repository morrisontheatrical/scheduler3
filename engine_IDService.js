/**
 * ID SERVICE: Manages the 'idLog' sheet (Identity & Relationships)
 */
var Engine = Engine || {};
Engine.IDService = {

  /**
   * UPSERT IDENTITY: Registers or updates a UUID in the idLog.
   */
  upsert: function(ctx, entry) {
    const sheet = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const uniqueIdCol = ctx.getCol("ID_LOG", "UniqueID");
    const fingerprintCol = ctx.getCol("ID_LOG", "Fingerprint") >= 0
      ? ctx.getCol("ID_LOG", "Fingerprint")
      : ctx.getCol("ID_LOG", "SyncHash");
    
    // Search for existing ID
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][uniqueIdCol] === entry.id) {
        rowIdx = i + 1;
        break;
      }
    }

    const now = new Date();
    if (rowIdx === -1) {
      // Create new Record
      const idMap = ctx.maps.ID_LOG || {};
      const indices = Object.keys(idMap).map(field => ctx.getCol("ID_LOG", field)).filter(index => index >= 0);
      const newRow = new Array(Math.max(...indices, 10) + 1).fill("");
      if (uniqueIdCol >= 0) newRow[uniqueIdCol] = entry.id;
      if (ctx.getCol("ID_LOG", "RecordType") >= 0) newRow[ctx.getCol("ID_LOG", "RecordType")] = entry.type;
      if (ctx.getCol("ID_LOG", "Title") >= 0) newRow[ctx.getCol("ID_LOG", "Title")] = entry.title;
      if (ctx.getCol("ID_LOG", "ParentID") >= 0) newRow[ctx.getCol("ID_LOG", "ParentID")] = entry.parentId || "N/A";
      if (fingerprintCol >= 0) newRow[fingerprintCol] = entry.hash || entry.fingerprint || "N/A";
      if (ctx.getCol("ID_LOG", "SheetLocation") >= 0) newRow[ctx.getCol("ID_LOG", "SheetLocation")] = entry.location || "N/A";
      if (ctx.getCol("ID_LOG", "SyncStatus") >= 0) newRow[ctx.getCol("ID_LOG", "SyncStatus")] = entry.status || "Active";
      if (ctx.getCol("ID_LOG", "Timestamp") >= 0) newRow[ctx.getCol("ID_LOG", "Timestamp")] = now;
      if (ctx.getCol("ID_LOG", "LastUpdated") >= 0) newRow[ctx.getCol("ID_LOG", "LastUpdated")] = now;
      if (ctx.getCol("ID_LOG", "LogDetails") >= 0) newRow[ctx.getCol("ID_LOG", "LogDetails")] = entry.details || "Initial Registration";
      const mergedIdsCol = ctx.getCol("ID_LOG", "MergedIDs") >= 0
        ? ctx.getCol("ID_LOG", "MergedIDs")
        : ctx.getCol("ID_LOG", "Merged IDs");
      if (mergedIdsCol >= 0) newRow[mergedIdsCol] = entry.mergedIds || "";
      
      sheet.appendRow(newRow);
    } else {
      // Update existing record's "current" state
      const locCol = ctx.getCol("ID_LOG", "SheetLocation");
      const updatedCol = ctx.getCol("ID_LOG", "LastUpdated");
      const detailsCol = ctx.getCol("ID_LOG", "LogDetails");
      if (locCol >= 0) sheet.getRange(rowIdx, locCol + 1).setValue(entry.location);
      if (fingerprintCol >= 0) sheet.getRange(rowIdx, fingerprintCol + 1).setValue(entry.hash || entry.fingerprint || "N/A");
      if (updatedCol >= 0) sheet.getRange(rowIdx, updatedCol + 1).setValue(now);
      if (entry.details && detailsCol >= 0) sheet.getRange(rowIdx, detailsCol + 1).setValue(entry.details);
    }
  },
  /**
 * BATCH SYNC: Scans all sheets and reconciles with idLog.
 */
    syncAll: function(ctx) {
      const idLogSheet = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
      const idLogMap = ctx.maps.ID_LOG || {};
      const now = new Date();
      if (!idLogSheet) return;
      
      // 1. Load existing Registry into a Map for speed
      const registryData = idLogSheet.getDataRange().getValues();
      const registry = new Map();
      const uniqueIdCol = Engine.getColumnIndex(idLogMap, "UniqueID");
      const sheetLocationCol = Engine.getColumnIndex(idLogMap, "SheetLocation");
      const fingerprintCol = Engine.getColumnIndex(idLogMap, "Fingerprint") >= 0
        ? Engine.getColumnIndex(idLogMap, "Fingerprint")
        : Engine.getColumnIndex(idLogMap, "SyncHash");
      const lastUpdatedCol = Engine.getColumnIndex(idLogMap, "LastUpdated");
      for (let i = 1; i < registryData.length; i++) {
        const id = registryData[i][uniqueIdCol];
        if (id) registry.set(id, { rowIdx: i + 1, data: registryData[i] });
      }

      const newEntries = [];

      // 2. Iterate through sheet definitions to find sheets with IDs
      Object.entries(ctx.sheetDefs || {}).forEach(([sheetName, sheetDef]) => {
        const role = sheetDef.role || sheetName;
        const idKey = sheetDef.settings && sheetDef.settings.idKey;
        
        // Skip sheets that don't hold unique record identities
        if (!idKey || role === "REFERENCE" || role === "AUDIT" || role === "SETTINGS" || role === "ID_LOG") return;

        const sheet = sheetDef.sheet;
        if (!sheet) return;

        const data = sheet.getDataRange().getValues();
        const sheetMap = ctx.getMap(role);
        
        // Safety: if map failed to load for this role
        if (!sheetMap || Engine.getColumnIndex(sheetMap, idKey) < 0) return;

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const id = row[Engine.getColumnIndex(sheetMap, idKey)];
          if (!id || id === "" || id === "N/A") continue;

          const location = `${sheetName}!R${i + 1}`;
          const hashCol = Engine.getColumnIndex(sheetMap, "SyncHash");
          const titleCol = Engine.getColumnIndex(sheetMap, "Title");
          const eventNameCol = Engine.getColumnIndex(sheetMap, "EventName");
          const parentIdCol = Engine.getColumnIndex(sheetMap, "ParentID") >= 0
            ? Engine.getColumnIndex(sheetMap, "ParentID")
            : Engine.getColumnIndex(sheetMap, "parentID");
          const hash = hashCol >= 0 ? row[hashCol] : "N/A";
          const title = titleCol >= 0 ? row[titleCol] : eventNameCol >= 0 ? row[eventNameCol] : (row[0] || "No Title");
          const parentId = parentIdCol >= 0 ? row[parentIdCol] : "";

          if (registry.has(id)) {
            // UPDATE: Check if location or hash drifted
            const existing = registry.get(id);
            const oldLoc = existing.data[sheetLocationCol];
            const oldHash = existing.data[fingerprintCol];

            // Keep a real source location; idLog!R... is registry self-location, never source metadata.
            const replaceLocation = !oldLoc || String(oldLoc).indexOf("idLog!R") === 0;
            if (replaceLocation || (fingerprintCol >= 0 && oldHash !== hash)) {
              if (replaceLocation) idLogSheet.getRange(existing.rowIdx, sheetLocationCol + 1).setValue(location);
              if (fingerprintCol >= 0) idLogSheet.getRange(existing.rowIdx, fingerprintCol + 1).setValue(hash);
              idLogSheet.getRange(existing.rowIdx, lastUpdatedCol + 1).setValue(now);
            }
          } else {
            // REGISTER: Queue new entry
            const indices = Object.keys(idLogMap)
              .map(field => Engine.getColumnIndex(idLogMap, field))
              .filter(index => index >= 0);
            const entry = new Array(Math.max(...indices, 10) + 1).fill("");
            entry[uniqueIdCol] = id;
            if (Engine.getColumnIndex(idLogMap, "RecordType") >= 0) entry[Engine.getColumnIndex(idLogMap, "RecordType")] = role;
            if (Engine.getColumnIndex(idLogMap, "Title") >= 0) entry[Engine.getColumnIndex(idLogMap, "Title")] = title;
            if (Engine.getColumnIndex(idLogMap, "ParentID") >= 0) entry[Engine.getColumnIndex(idLogMap, "ParentID")] = parentId;
            if (fingerprintCol >= 0) entry[fingerprintCol] = hash;
            if (sheetLocationCol >= 0) entry[sheetLocationCol] = location;
            if (Engine.getColumnIndex(idLogMap, "SyncStatus") >= 0) entry[Engine.getColumnIndex(idLogMap, "SyncStatus")] = "Active";
            if (Engine.getColumnIndex(idLogMap, "Timestamp") >= 0) entry[Engine.getColumnIndex(idLogMap, "Timestamp")] = now;
            if (lastUpdatedCol >= 0) entry[lastUpdatedCol] = now;
            newEntries.push(entry);
            registry.set(id, { rowIdx: null, data: entry });
          }
        }
      });

      // 3. Bulk append new IDs
      if (newEntries.length > 0) {
        const width = Math.max(...newEntries.map(entry => entry.length));
        const rows = newEntries.map(entry => entry.concat(new Array(width - entry.length).fill("")));
        idLogSheet.getRange(idLogSheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
      }
      
      this.applyLinks(ctx);
      Engine.Log.info(ctx, "ID_SERVICE", `Registry Sync: ${newEntries.length} new IDs added.`);
    },

  /**
   * Generates clickable HYPERLINK formulas for idLog rows
   */
  applyLinks: function(ctx) {
    const idLogSheet = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
    const idLogMap = ctx.maps.ID_LOG || {};
    if (!idLogSheet) return { linked: 0 };

    const data = idLogSheet.getDataRange().getValues();
    if (data.length <= 1) return { linked: 0 };

    const uniqueIdCol = Engine.getColumnIndex(idLogMap, "UniqueID");
    const sheetLocationCol = Engine.getColumnIndex(idLogMap, "SheetLocation");
    const parentIdCol = Engine.getColumnIndex(idLogMap, "ParentID");
    if (uniqueIdCol < 0 || sheetLocationCol < 0) return { linked: 0 };

    // Build parentID to row lookup across Parent Lineup
    const pRole = Engine.Roles ? Engine.Roles.resolve(ctx, "PARENT") : "PARENTCURRENT";
    const parentSheet = (pRole && Engine.getSheetByRole(ctx, pRole)) || ctx.ss.getSheetByName("Parent Lineup");
    const parentMap = ctx.getMap ? ctx.getMap(pRole) : (ctx.maps && ctx.maps["Parent Lineup"]);
    const parentIdIdx = parentMap ? Engine.getColumnIndex(parentMap, "parentID") : -1;
    const parentRowMap = new Map();
    if (parentSheet && parentIdIdx >= 0) {
      const pData = parentSheet.getDataRange().getValues();
      for (let i = 1; i < pData.length; i++) {
        const pid = pData[i][parentIdIdx];
        if (pid) parentRowMap.set(String(pid).trim(), i + 1);
      }
    }

    let linkedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const rowNum = i + 1;
      const uniqueId = String(data[i][uniqueIdCol] || "").trim();
      const loc = String(data[i][sheetLocationCol] || "").trim();
      const parentId = parentIdCol >= 0 ? String(data[i][parentIdCol] || "").trim() : "";

      // 1. Link UniqueID to its SheetLocation
      if (uniqueId && loc && loc !== "N/A" && loc.includes("!R")) {
        const parts = loc.split("!R");
        const targetSheetName = parts[0];
        const targetRow = parseInt(parts[1], 10);
        if (targetSheetName && !isNaN(targetRow) && targetRow > 0) {
          const targetSheet = ctx.ss.getSheetByName(targetSheetName);
          if (targetSheet) {
            idLogSheet.getRange(rowNum, uniqueIdCol + 1).setFormula(
              Engine.makeSheetRowLink(ctx, targetSheetName, targetRow, uniqueId)
            );
            linkedCount++;
          }
        }
      }

      // 2. Link ParentID to Parent Lineup if available
      if (parentId && parentId !== "N/A" && parentSheet && parentRowMap.has(parentId) && parentIdCol >= 0) {
        const pTargetRow = parentRowMap.get(parentId);
        idLogSheet.getRange(rowNum, parentIdCol + 1).setFormula(
          Engine.makeSheetRowLink(ctx, parentSheet.getName(), pTargetRow, parentId)
        );
      }
    }

    return { linked: linkedCount };
  }
};

function refreshIDRegistryLinks() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh ID Registry Links");
  const results = Engine.IDService.applyLinks(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh ID Registry Links", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}