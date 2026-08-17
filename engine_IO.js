/**
 * Converts a sheet into an array of objects based on the Map_Registry
 */
function scanSheet(role, ctx) {
  const sheet = ctx.sheets[role];
  const map = ctx.maps[role];
  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // Remove headers
  
  return data.map((row, index) => {
    const obj = { _rowNum: index + 2 }; // Keep track of the actual row for individual updates
    for (const field in map) {
      obj[field] = row[map[field]];
    }
    return obj;
  });
}

/**
 * Writes a batch of objects back to the sheet and automatically updates SyncHashes.
 */
function batchWrite(role, dataObjects, ctx) {
  const sheetName = ctx.getRole(role);
  const sheet = ctx.ss.getSheetByName(sheetName);
  const map = ctx.getMap(role);
  
  if (!sheet || !map) {
    Engine.Log.error(ctx, "BATCH_WRITE", `Failed to find sheet or map for role: ${role}`);
    return;
  }

  // FIX: Extract the .index property from the map objects to find the max index
  const indices = Object.values(map).map(m => m.index);
  const lastCol = Math.max(...indices) + 1;
  
  const output = dataObjects.map(obj => {
    // 1. Generate Identity Hash (using scriptLib / SL)
    if (map.SyncHash !== undefined) {
      const identity = scriptLib.Identity.generate({
        title: obj.Title || obj.EventName, // Handle naming discrepancies
        date: obj.Date,
        time: obj.Start || obj.CallTime,
        venue: obj.Location || obj.Venue
      });
      obj.SyncHash = identity.hash;
    }

    // 2. Map object properties to the correct column 0-based indices
    const row = new Array(lastCol).fill("");
    for (const field in map) {
      const colIdx = map[field].index;
      // Only write if the object actually has a value for this field
      if (obj.hasOwnProperty(field)) {
        row[colIdx] = obj[field];
      }
    }
    return row;
  });

  // 3. Write to sheet (starting at row 2)
  if (output.length > 0) {
    sheet.getRange(2, 1, output.length, lastCol).setValues(output);
    Engine.Log.info(ctx, "BATCH_WRITE", `Successfully wrote ${output.length} rows to ${sheetName}`);
  }
}

function patchRows(role, updatedObjects, ctx) {
  const sheet = ctx.sheets[role];
  const map = ctx.maps[role];
  
  updatedObjects.forEach(obj => {
    if (!obj._rowNum) return; // We need to know which row to hit
    
    // Auto-hash before patching
    const identity = SL.Identity.generate({
      title: obj.Title, date: obj.Date, time: obj.Start, venue: obj.Location
    });
    obj.SyncHash = identity.hash;

    const rowArray = new Array(Math.max(...Object.values(map)) + 1).fill("");
    for (const field in map) {
      rowArray[map[field]] = obj[field];
    }
    
    // Update only this specific row
    sheet.getRange(obj._rowNum, 1, 1, rowArray.length).setValues([rowArray]);
  });
}