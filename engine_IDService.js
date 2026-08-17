/**
 * ID SERVICE: Manages the 'idLog' sheet (Identity & Relationships)
 */
var Engine = Engine || {};
Engine.IDService = {

  /**
   * UPSERT IDENTITY: Registers or updates a UUID in the idLog.
   */
  upsert: function(ctx, entry) {
    const sheet = ctx.sheets.ID_LOG;
    const map = ctx.maps.ID_LOG;
    const data = sheet.getDataRange().getValues();
    
    // Search for existing ID
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][map.UniqueID] === entry.id) {
        rowIdx = i + 1;
        break;
      }
    }

    const now = new Date();
    if (rowIdx === -1) {
      // Create new Record
      let newRow = new Array(11).fill("");
      newRow[map.UniqueID]      = entry.id;
      newRow[map.RecordType]    = entry.type;
      newRow[map.Title]         = entry.title;
      newRow[map.ParentID]      = entry.parentId || "N/A";
      newRow[map.SyncHash]      = entry.hash || "N/A";
      newRow[map.SheetLocation] = entry.location || "N/A";
      newRow[map.SyncStatus]    = "Active";
      newRow[map.Timestamp]     = now;
      newRow[map.LastUpdated]   = now;
      newRow[map.LogDetails]    = entry.details || "Initial Registration";
      
      sheet.appendRow(newRow);
    } else {
      // Update existing record's "current" state
      sheet.getRange(rowIdx, map.SheetLocation + 1).setValue(entry.location);
      sheet.getRange(rowIdx, map.SyncHash + 1).setValue(entry.hash);
      sheet.getRange(rowIdx, map.LastUpdated + 1).setValue(now);
      if (entry.details) sheet.getRange(rowIdx, map.LogDetails + 1).setValue(entry.details);
    }
  },
  /**
 * BATCH SYNC: Scans all sheets and reconciles with idLog.
 */
    syncAll: function(ctx) {
      const idLogSheet = ctx.sheets.ID_LOG;
      const idLogMap = ctx.maps.ID_LOG;
      const now = new Date();
      
      // 1. Load existing Registry into a Map for speed
      const registryData = idLogSheet.getDataRange().getValues();
      const registry = new Map();
      for (let i = 1; i < registryData.length; i++) {
        const id = registryData[i][idLogMap.UniqueID];
        if (id) registry.set(id, { rowIdx: i + 1, data: registryData[i] });
      }

      const newEntries = [];

      // 2. Iterate through Sheet_Settings to find sheets with IDs
      ctx.settings.forEach(setting => {
        const role = setting['Sheet.Role'];
        const idKey = setting['ID Key'];
        
        // Skip sheets that don't hold unique record identities
        if (!idKey || role === "REFERENCE" || role === "AUDIT" || role === "SETTINGS") return;

        const sheet = ss.getSheetByName(setting['Sheet Name']);
        if (!sheet) return;

        const data = sheet.getDataRange().getValues();
        const sheetMap = ctx.maps[role];
        
        // Safety: if map failed to load for this role
        if (!sheetMap || sheetMap[idKey] === undefined) return;

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const id = row[sheetMap[idKey]];
          if (!id || id === "" || id === "N/A") continue;

          const location = `${setting['Sheet Name']}!R${i + 1}`;
          const hash = sheetMap.SyncHash !== undefined ? row[sheetMap.SyncHash] : "N/A";
          const title = sheetMap.Title !== undefined ? row[sheetMap.Title] : (row[0] || "No Title");

          if (registry.has(id)) {
            // UPDATE: Check if location or hash drifted
            const existing = registry.get(id);
            const oldLoc = existing.data[idLogMap.SheetLocation];
            const oldHash = existing.data[idLogMap.SyncHash];

            if (oldLoc !== location || oldHash !== hash) {
              // Selective update to avoid heavy sheet writes
              idLogSheet.getRange(existing.rowIdx, idLogMap.SheetLocation + 1).setValue(location);
              idLogSheet.getRange(existing.rowIdx, idLogMap.SyncHash + 1).setValue(hash);
              idLogSheet.getRange(existing.rowIdx, idLogMap.LastUpdated + 1).setValue(now);
            }
          } else {
            // REGISTER: Queue new entry
            let entry = new Array(11).fill("");
            entry[idLogMap.UniqueID] = id;
            entry[idLogMap.RecordType] = role;
            entry[idLogMap.Title] = title;
            entry[idLogMap.SyncHash] = hash;
            entry[idLogMap.SheetLocation] = location;
            entry[idLogMap.SyncStatus] = "Active";
            entry[idLogMap.Timestamp] = now;
            entry[idLogMap.LastUpdated] = now;
            newEntries.push(entry);
          }
        }
      });

      // 3. Bulk append new IDs
      if (newEntries.length > 0) {
        idLogSheet.getRange(idLogSheet.getLastRow() + 1, 1, newEntries.length, 11).setValues(newEntries);
      }
      
      Engine.Log.info(ctx, "ID_SERVICE", `Registry Sync: ${newEntries.length} new IDs added.`);
    }
};