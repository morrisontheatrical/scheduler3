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
    const uniqueIdCol = Engine.getColumnIndex(map, "UniqueID");
    
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
      const indices = Object.keys(map).map(field => Engine.getColumnIndex(map, field)).filter(index => index >= 0);
      const newRow = new Array(Math.max(...indices) + 1).fill("");
      newRow[Engine.getColumnIndex(map, "UniqueID")] = entry.id;
      newRow[Engine.getColumnIndex(map, "RecordType")] = entry.type;
      newRow[Engine.getColumnIndex(map, "Title")] = entry.title;
      newRow[Engine.getColumnIndex(map, "ParentID")] = entry.parentId || "N/A";
      newRow[Engine.getColumnIndex(map, "SyncHash")] = entry.hash || "N/A";
      newRow[Engine.getColumnIndex(map, "SheetLocation")] = entry.location || "N/A";
      newRow[Engine.getColumnIndex(map, "SyncStatus")] = "Active";
      newRow[Engine.getColumnIndex(map, "Timestamp")] = now;
      newRow[Engine.getColumnIndex(map, "LastUpdated")] = now;
      newRow[Engine.getColumnIndex(map, "LogDetails")] = entry.details || "Initial Registration";
      
      sheet.appendRow(newRow);
    } else {
      // Update existing record's "current" state
      sheet.getRange(rowIdx, Engine.getColumnIndex(map, "SheetLocation") + 1).setValue(entry.location);
      sheet.getRange(rowIdx, Engine.getColumnIndex(map, "SyncHash") + 1).setValue(entry.hash);
      sheet.getRange(rowIdx, Engine.getColumnIndex(map, "LastUpdated") + 1).setValue(now);
      if (entry.details) sheet.getRange(rowIdx, Engine.getColumnIndex(map, "LogDetails") + 1).setValue(entry.details);
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
      const uniqueIdCol = Engine.getColumnIndex(idLogMap, "UniqueID");
      const sheetLocationCol = Engine.getColumnIndex(idLogMap, "SheetLocation");
      const syncHashCol = Engine.getColumnIndex(idLogMap, "SyncHash");
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
        if (!idKey || role === "REFERENCE" || role === "AUDIT" || role === "SETTINGS") return;

        const sheet = sheetDef.sheet;
        if (!sheet) return;

        const data = sheet.getDataRange().getValues();
        const sheetMap = ctx.maps[role];
        
        // Safety: if map failed to load for this role
        if (!sheetMap || Engine.getColumnIndex(sheetMap, idKey) < 0) return;

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const id = row[Engine.getColumnIndex(sheetMap, idKey)];
          if (!id || id === "" || id === "N/A") continue;

          const location = `${sheetName}!R${i + 1}`;
          const hashCol = Engine.getColumnIndex(sheetMap, "SyncHash");
          const titleCol = Engine.getColumnIndex(sheetMap, "Title");
          const hash = hashCol >= 0 ? row[hashCol] : "N/A";
          const title = titleCol >= 0 ? row[titleCol] : (row[0] || "No Title");

          if (registry.has(id)) {
            // UPDATE: Check if location or hash drifted
            const existing = registry.get(id);
            const oldLoc = existing.data[sheetLocationCol];
            const oldHash = existing.data[syncHashCol];

            if (oldLoc !== location || oldHash !== hash) {
              // Selective update to avoid heavy sheet writes
              idLogSheet.getRange(existing.rowIdx, sheetLocationCol + 1).setValue(location);
              idLogSheet.getRange(existing.rowIdx, syncHashCol + 1).setValue(hash);
              idLogSheet.getRange(existing.rowIdx, lastUpdatedCol + 1).setValue(now);
            }
          } else {
            // REGISTER: Queue new entry
            const indices = Object.keys(idLogMap)
              .map(field => Engine.getColumnIndex(idLogMap, field))
              .filter(index => index >= 0);
            const entry = new Array(Math.max(...indices) + 1).fill("");
            entry[uniqueIdCol] = id;
            entry[Engine.getColumnIndex(idLogMap, "RecordType")] = role;
            entry[Engine.getColumnIndex(idLogMap, "Title")] = title;
            entry[syncHashCol] = hash;
            entry[sheetLocationCol] = location;
            entry[Engine.getColumnIndex(idLogMap, "SyncStatus")] = "Active";
            entry[Engine.getColumnIndex(idLogMap, "Timestamp")] = now;
            entry[lastUpdatedCol] = now;
            newEntries.push(entry);
          }
        }
      });

      // 3. Bulk append new IDs
      if (newEntries.length > 0) {
        const width = Math.max(...newEntries.map(entry => entry.length));
        const rows = newEntries.map(entry => entry.concat(new Array(width - entry.length).fill("")));
        idLogSheet.getRange(idLogSheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
      }
      
      Engine.Log.info(ctx, "ID_SERVICE", `Registry Sync: ${newEntries.length} new IDs added.`);
    }
};