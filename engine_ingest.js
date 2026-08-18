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

  // Map existing Parent events by Name for quick lookup
  const pLookup = {};
  pData.forEach((row, idx) => {
    const name = row[pMap.EventName];
    if (name) pLookup[name] = { rowIdx: idx + 1, id: row[pMap.parentID] };
  });

  iData.forEach((iRow) => {
    const eventName = iRow[iMap.EventName]; // Match Registry: "EventName"
    if (!eventName) return;

    const existing = pLookup[eventName];
    let rowArray = new Array(Object.keys(pMap).length).fill("");

    rowArray[pMap.EventName]    = eventName;
    rowArray[pMap.Series]       = iRow[iMap.Series];
    rowArray[pMap.Opening]      = iRow[iMap.Opening];
    rowArray[pMap.Range]        = iRow[iMap.Range];
    rowArray[pMap.DatesAndTimes]= iRow[iMap.DatesAndTimes]; // Registry says "DatesAndTimes"
    rowArray[pMap.Venue]        = iRow[iMap.Venue];
    rowArray[pMap.Pricing]      = iRow[iMap.Pricing];
    rowArray[pMap.ShowNotes]    = iRow[iMap.ShowNotes];

    if (existing) {
      // UPDATE: Record already exists
      rowArray[pMap.parentID] = existing.id;
      pSheet.getRange(existing.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
    } else {
      // INSERT: New event
      rowArray[pMap.parentID] = "P-" + Utilities.getUuid().split('-')[0].toUpperCase();
      rowArray[pMap.SyncStatus] = "Active";
      pSheet.appendRow(rowArray);
    }
  });

  Engine.Log.write("Parent Lineup Updated", "Success");
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

  // Create lookup for existing children to avoid duplicates
  const existingRecords = {};
  lData.forEach((row, idx) => {
    const key = `${row[lMap.parentID]}|${row[lMap.RawDateStr]}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lMap.UUID] };
  });

  pData.forEach((pRow) => {
    const parentID = pRow[pMap.parentID];
    const rawDates = pRow[pMap.DatesAndTimes];
    if (!parentID || !rawDates) return;

    // parseDatesFromRange is assumed to be in your scriptLib 
    const performanceDates = parseDatesFromRange(String(rawDates));

    performanceDates.forEach((dObj, index) => {
      const dateStr = Utilities.formatDate(dObj, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${dateStr}`;
      const record = existingRecords[lookupKey];

      let rowArray = new Array(Object.keys(lMap).length).fill("");
      rowArray[lMap.EventName]    = pRow[pMap.EventName];
      rowArray[lMap.parentID]     = parentID;
      rowArray[lMap.Date]         = dObj;
      rowArray[lMap.RawDateStr]   = dateStr;
      rowArray[lMap.EventOfTotal] = `${index + 1} of ${performanceDates.length}`;
      rowArray[lMap.Venue]        = pRow[pMap.Venue];

      if (record) {
        rowArray[lMap.UUID] = record.uuid; // Preserve UUID
        lSheet.getRange(record.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
      } else {
        rowArray[lMap.UUID] = Lib.uuid(); // Generate new child ID [cite: 13]
        rowArray[lMap.SyncStatus] = "Draft";
        lSheet.appendRow(rowArray);
      }
    });
  });

  Lib.notify("Lineup Explosion Complete", "Success");
}