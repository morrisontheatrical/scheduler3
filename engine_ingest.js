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

/**
 * STAGE 4: Pushes exploded Lineup rows into the crew log.
 * Targets the "CREWCAL" role by default. Once a dedicated Draft Season sheet/role
 * exists, pass { targetRole: "DRAFTSEASON" } (or change the default below) — the map
 * lookups and status handling here don't need to change, only the role name.
 */
function goCrewLog(options) {
  const ctx = Engine.getContext();
  return Engine.Ingest.syncLineupToLog(ctx, options);
}

Engine.Ingest = Engine.Ingest || {};

Engine.Ingest.syncLineupToLog = function(ctx, options) {
  options = options || {};
  const targetRole = options.targetRole || "CREWCAL"; // <-- swap default here once Draft Season sheet/role exists

  const lSheet = ctx.ss.getSheetByName("Lineup");
  const lMap = ctx.maps["Lineup"];
  const logSheet = ctx.sheets[targetRole] || ctx.ss.getSheetByName(ctx.getRole(targetRole));
  const logMap = ctx.getMap(targetRole);

  if (!lSheet || !lMap) {
    Engine.Log.error(ctx, "INGEST", "Lineup sheet or map not found.");
    return;
  }
  if (!logSheet || !logMap) {
    Engine.Log.error(ctx, "INGEST", `Target sheet/map for role "${targetRole}" not found.`);
    return;
  }

  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const lData = lSheet.getDataRange().getValues();
  lData.shift();

  // Anchor identity: a log row is linked to its Lineup row via Source="Lineup" + matching UUID.
  const logRows = scanSheet(targetRole, ctx);
  const existingByUUID = {};
  logRows.forEach(row => {
    if (row.Source === "Lineup" && row.UUID) existingByUUID[row.UUID] = row;
  });

  const defaultDuration = (ctx.mode && ctx.mode.defaultDuration) || 2;
  const newRows = [];
  const changedRows = [];
  let skippedLocked = 0;

  lData.forEach(lRow => {
    const uuid = lRow[lCol("UUID")];
    const title = lRow[lCol("EventName")];
    const date = lRow[lCol("Date")];
    if (!uuid || !title || !date) return;

    const location = lRow[lCol("Venue")];
    const eventOfTotal = lRow[lCol("EventOfTotal")];
    const start = new Date(date);
    const end = new Date(start.getTime() + defaultDuration * 60 * 60 * 1000);

    const existing = existingByUUID[uuid];

    // NEW: no log row yet for this Lineup event.
    if (!existing) {
      newRows.push({
        Title: title,
        Date: start,
        Start: start,
        End: end,
        Location: location,
        Description: eventOfTotal ? `Auto-synced from Lineup (${eventOfTotal})` : "Auto-synced from Lineup",
        Source: "Lineup",
        UUID: uuid,
        SyncStatus: "Manual Review",
        LastSynced: new Date()
      });
      return;
    }

    // Respect rows a human has locked/bypassed; just note that changes were skipped.
    const statusDef = ctx.status[existing.SyncStatus];
    const behaviors = statusDef ? Engine.parseModeList(statusDef.behavior) : [];
    if (behaviors.includes("LOCKED") || behaviors.includes("BYPASS")) {
      skippedLocked++;
      return;
    }

    const titleDrift = String(existing.Title || "").trim() !== String(title || "").trim();
    const startDrift = !existing.Start || new Date(existing.Start).getTime() !== start.getTime();
    const locationDrift = String(existing.Location || "").trim() !== String(location || "").trim();

    if (titleDrift || startDrift || locationDrift) {
      existing.Title = title;
      existing.Date = start;
      existing.Start = start;
      existing.Location = location;
      Engine.Status.apply(ctx, targetRole, null, "Data Drift Detected", {
        details: "Lineup changed since the last sync.",
        targetObj: existing
      });
      changedRows.push(existing);
    }
  });

  if (newRows.length > 0) {
    const indices = Object.keys(logMap).map(field => Engine.getColumnIndex(logMap, field)).filter(index => index >= 0);
    const width = Math.max(...indices) + 1;
    newRows.forEach(obj => {
      const rowArray = new Array(width).fill("");
      for (const field in logMap) {
        const idx = Engine.getColumnIndex(logMap, field);
        if (idx < 0 || !obj.hasOwnProperty(field)) continue;
        rowArray[idx] = obj[field];
      }
      logSheet.appendRow(rowArray);
    });
  }

  if (changedRows.length > 0) {
    patchRows(targetRole, changedRows, ctx);
  }

  Engine.Log.write(ctx, {
    stage: "INGEST",
    type: "LINEUP_TO_LOG",
    details: `Added ${newRows.length} new row(s), updated ${changedRows.length} drifted row(s), skipped ${skippedLocked} locked/bypassed row(s).`
  });

  return { added: newRows.length, updated: changedRows.length, skippedLocked: skippedLocked };
};