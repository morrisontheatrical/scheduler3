// At the top of engine_calendar.gs, engine_sync.gs, etc.
var Engine = Engine || {};

/**
 * STAGE 1 & 2: Moves data from 'import' to 'Parent Lineup'.
 * Fixes: ReferenceError by initializing 'ctx'.
 */
function goParent() {
  const ctx = Engine.getContext();
  const ss = ctx.ss;
  const iSheet = ss.getSheetByName("import");
  const pSheet = ss.getSheetByName("Parent Lineup");

  
  if (!iSheet || !pSheet) {
    SL.notify("Import or Parent Lineup sheet not found.", "Error");
    return;
  }

  const iMap = ctx.getMap("import");
  const pMap = ctx.getMap("Parent Lineup");
  const iData = iSheet.getDataRange().getValues();
  const pData = pSheet.getDataRange().getValues();
  
  iData.shift(); // Remove headers

  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const pWidth = Math.max(...Object.keys(pMap).map(fieldName => pCol(fieldName)).filter(index => index >= 0)) + 1;

  // Map existing Parent events by Name for quick lookup
  const pLookup = {};
  pData.forEach((row, idx) => {
    const name = row[pCol("EventName")];
    if (name) pLookup[name] = { rowIdx: idx + 1, id: row[pCol("parentID")] };
  });

  iData.forEach((iRow) => {
    const eventName = iRow[iCol("EventName")];
    if (!eventName) return;

    const existing = pLookup[eventName];
    const rowArray = new Array(pWidth).fill("");

    rowArray[pCol("EventName")] = eventName;
    rowArray[pCol("Series")] = iRow[iCol("Series")];
    rowArray[pCol("Opening")] = iRow[iCol("Opening")];
    rowArray[pCol("Range")] = iRow[iCol("Range")];
    rowArray[pCol("DatesAndTimes")] = iRow[iCol("DatesAndTimes")];
    rowArray[pCol("Venue")] = iRow[iCol("Venue")];
    rowArray[pCol("Pricing")] = iRow[iCol("Pricing")];
    rowArray[pCol("ShowNotes")] = iRow[iCol("ShowNotes")];

    if (existing) {
      // UPDATE: Record already exists
      rowArray[pCol("parentID")] = existing.id;
      pSheet.getRange(existing.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
    } else {
      // INSERT: New event
      rowArray[pCol("parentID")] = "P-" + Utilities.getUuid().split('-')[0].toUpperCase();
      rowArray[pCol("SyncStatus")] = "Active";
      pSheet.appendRow(rowArray);
    }
  });

  Engine.Log.write(ctx, { stage: "INGEST", type: "SUCCESS", details: "Parent Lineup Updated" });
}

/**
 * STAGE 3: Explodes Parent Lineup into individual events in the Lineup sheet.
 */
function goLineup() {
  const ctx = Engine.getContext();
  const ss = ctx.ss;
  const pSheet = ss.getSheetByName("Parent Lineup");
  const lSheet = ss.getSheetByName("Lineup");
  
  const pMap = ctx.maps["Parent Lineup"];
  const lMap = ctx.maps["Lineup"];
  const pData = pSheet.getDataRange().getValues();
  const lData = lSheet.getDataRange().getValues();
  
  pData.shift();

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const lWidth = Math.max(...Object.keys(lMap).map(fieldName => lCol(fieldName)).filter(index => index >= 0)) + 1;

  // Create lookup for existing children to avoid duplicates
  const existingRecords = {};
  lData.forEach((row, idx) => {
    const key = `${row[lCol("parentID")]}|${row[lCol("RawDateStr")]}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lCol("UUID")] };
  });

  pData.forEach((pRow) => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    if (!parentID || !rawDates) return;

    // parseDatesFromRange is assumed to be in your scriptLib 
    const performanceDates = parseDatesFromRange(String(rawDates));

    performanceDates.forEach((dObj, index) => {
      const dateStr = Utilities.formatDate(dObj, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${dateStr}`;
      const record = existingRecords[lookupKey];

      const rowArray = new Array(lWidth).fill("");
      rowArray[lCol("EventName")] = pRow[pCol("EventName")];
      rowArray[lCol("parentID")] = parentID;
      rowArray[lCol("Date")] = dObj;
      rowArray[lCol("RawDateStr")] = dateStr;
      rowArray[lCol("EventOfTotal")] = `${index + 1} of ${performanceDates.length}`;
      rowArray[lCol("Venue")] = pRow[pCol("Venue")];

      if (record) {
        rowArray[lCol("UUID")] = record.uuid;
        lSheet.getRange(record.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
      } else {
        rowArray[lCol("UUID")] = Utilities.getUuid();
        rowArray[lCol("SyncStatus")] = "Draft";
        lSheet.appendRow(rowArray);
      }
    });
  });

  SL.notify("Lineup Explosion Complete", "Success");
}