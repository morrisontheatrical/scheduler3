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

  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");

  const pSheet = ctx.sheets[pRole] || ss.getSheetByName(ctx.getRole(pRole));
  const lSheet = ctx.sheets[lRole] || ss.getSheetByName(ctx.getRole(lRole));

  const pMap = ctx.getMap(pRole);
  const lMap = ctx.getMap(lRole);

  if (!pSheet || !lSheet || !pMap || !lMap) {
    SL.notify("Parent Lineup or Lineup sheet/map not found.", "Error");
    return;
  }
  
  const pData = pSheet.getDataRange().getValues();
  const lData = lSheet.getDataRange().getValues();

  pData.shift();

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const lWidth = Math.max(...Object.keys(lMap).map(fieldName => lCol(fieldName)).filter(index => index >= 0)) + 1;
  const spanOverrideCol = pCol("SpanOverride");

  // ...rest is unchanged — everything downstream already goes through pCol/lCol

  const existingRecords = {};
  lData.forEach((row, idx) => {
    const key = `${row[lCol("parentID")]}|${row[lCol("RawDateStr")]}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lCol("UUID")] };
  });

  pData.forEach((pRow, idx) => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    if (!parentID || !rawDates) return;

    const rowIdx = idx + 2;
    const parsedDates = Engine.Ingest.parseParentDatesAndTimes(rawDates);

    if (parsedDates.dates.length === 0 && parsedDates.spans.length === 0) {
      Engine.Log.write(ctx, {
        stage: "INGEST", sheetName: "Parent Lineup", rowIdx: rowIdx, id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || "unknown format"}`
      });
      return;
    }

    // Build the final set of Lineup entries this row should produce.
    const entries = parsedDates.dates.map(d => ({ date: d, endDate: null }));

    parsedDates.spans.forEach(span => {
      const override = spanOverrideCol >= 0 ? String(pRow[spanOverrideCol] || "").trim().toUpperCase() : "";
      const policy = override || ctx.mode.spanDatePolicy || "BYPASS";

      if (policy === "MULTI_DAY") {
        entries.push({ date: span.start, endDate: span.end });
        return;
      }

      if (policy === "DAY_BY_DAY") {
        for (let d = new Date(span.start); d <= span.end; d.setDate(d.getDate() + 1)) {
          entries.push({ date: new Date(d), endDate: null });
        }
        return;
      }

      // BYPASS, or an unrecognized policy value — fail safe to manual review
      // rather than guessing what the operator wanted.
      Engine.Status.apply(ctx, "Parent Lineup", rowIdx, "Date Span - Manual Review", {
        stage: "INGEST",
        id: parentID,
        details: `Span not exploded (policy: ${policy}): ${span.raw}`
      });
    });

    if (entries.length === 0) return; // every span on this row was bypassed

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    entries.forEach((entry, index) => {
      const dateStr = Utilities.formatDate(entry.date, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${dateStr}`;
      const record = existingRecords[lookupKey];

      const rowArray = new Array(lWidth).fill("");
      rowArray[lCol("EventName")] = pRow[pCol("EventName")];
      rowArray[lCol("parentID")] = parentID;
      rowArray[lCol("Date")] = entry.date;
      rowArray[lCol("RawDateStr")] = dateStr;
      rowArray[lCol("EventOfTotal")] = `${index + 1} of ${entries.length}`;
      rowArray[lCol("Venue")] = pRow[pCol("Venue")];
      if (entry.endDate && lCol("EndDate") >= 0) rowArray[lCol("EndDate")] = entry.endDate;

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

/**
 * Parses the multiline DatesAndTimes cells used by Parent Lineup.
 */
Engine.Ingest.parseParentDatesAndTimes = function(rawDates) {
  const result = { dates: [], spans: [], errors: [] };
  const parser = typeof SL !== "undefined" && SL.TheatricalParser && SL.TheatricalParser.parse;
  if (!parser || !rawDates) {
    if (rawDates) result.errors.push("Theatrical parser unavailable");
    return result;
  }

  const rawLines = String(rawDates)
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const lines = [];
  rawLines.forEach(line => {
    if (/^through\b/i.test(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`;
    } else {
      lines.push(line);
    }
  });

  lines.forEach(line => {
    if (/^\(.*\)$/.test(line)) return; // parenthetical annotation, not a date

    const content = line.replace(/^(Performance|Session\s*\d+|Sensory-Friendly Performance|School Performance)\s*:\s*/i, "").trim();
    if (!content || /^(Performance|Session\s*\d+|Sensory-Friendly Performance|School Performance)\s*:?$/i.test(content)) return;

    const spanMatch = content.match(/^(?:[A-Za-z]+,\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?\s+through\s+(?:[A-Za-z]+,\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?$/i);
    if (spanMatch) {
      const start = new Date(spanMatch[1]);
      const end = new Date(spanMatch[2]);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
        result.spans.push({ raw: content, start: start, end: end });
      } else {
        result.errors.push(content);
      }
      return;
    }

    const parsed = parser(content);
    if (parsed && parsed.startDate && !isNaN(parsed.startDate.getTime())) {
      result.dates.push(parsed.startDate);
    } else if (!(parsed && parsed.isTBD)) {
      result.errors.push(content);
    }
  });

  result.dates.sort((a, b) => a.getTime() - b.getTime());
  return result;
};

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
  let flaggedBadDate = 0;

  lData.forEach(lRow => {
    const uuid = lRow[lCol("UUID")];
    const title = lRow[lCol("EventName")];
    if (!uuid || !title) return;

    const location = lRow[lCol("Venue")];
    const eventOfTotal = lRow[lCol("EventOfTotal")];
    const existing = existingByUUID[uuid];

    let start = new Date(lRow[lCol("Date")]);
    let dateInvalid = isNaN(start.getTime());
    if (dateInvalid) {
      const parentID = lRow[lCol("parentID")];
      const reparsed = Engine.Ingest._reparseDateFromParent(ctx, parentID, eventOfTotal);
      if (reparsed) { start = reparsed; dateInvalid = false; }
    }

    // Prefer an empty/unsynced date over a wrong one; flag for a human to fix upstream.
    if (dateInvalid) {
      flaggedBadDate++;
      if (existing) {
        Engine.Status.apply(ctx, targetRole, null, "Manual Review", {
          details: "Could not parse a valid date from Lineup (or its Parent Lineup row).",
          targetObj: existing
        });
        changedRows.push(existing);
      }
      return; // Don't create a new row until the date is fixable.
    }

    const end = new Date(start.getTime() + defaultDuration * 60 * 60 * 1000);

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
    details: `Added ${newRows.length} new row(s), updated ${changedRows.length} drifted row(s), skipped ${skippedLocked} locked/bypassed row(s), flagged ${flaggedBadDate} row(s) with an unparseable date.`
  });

  return { added: newRows.length, updated: changedRows.length, skippedLocked: skippedLocked, flaggedBadDate: flaggedBadDate };
};

/**
 * Re-derives a single performance date from the Parent Lineup's DatesAndTimes range,
 * used when a Lineup row's own Date cell failed to parse.
 */
Engine.Ingest._reparseDateFromParent = function(ctx, parentID, eventOfTotal) {
  if (!parentID || !eventOfTotal) return null;
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const pMap = ctx.maps["Parent Lineup"];
  if (!pSheet || !pMap) return null;

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const pData = pSheet.getDataRange().getValues();
  const row = pData.find(r => r[pCol("parentID")] === parentID);
  if (!row) return null;

  const rawDates = row[pCol("DatesAndTimes")];
  if (!rawDates) return null;

  const index = parseInt(String(eventOfTotal).split(" of ")[0], 10) - 1;
  if (isNaN(index) || index < 0) return null;

  const candidate = Engine.Ingest.parseParentDatesAndTimes(rawDates).dates[index];
  return candidate && !isNaN(candidate.getTime()) ? new Date(candidate) : null;
};

/**
 * VERIFY (read-only): Flags Parent Lineup rows whose key fields no longer match
 * their source row in "import". Does not overwrite anything — just flags for review.
 */
function goVerifyImportToParent() {
  const ctx = Engine.getContext();
  return Engine.Ingest.verifyImportToParent(ctx);
}

Engine.Ingest.verifyImportToParent = function(ctx) {
  const iSheet = ctx.ss.getSheetByName("import");
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const iMap = ctx.maps["import"];
  const pMap = ctx.maps["Parent Lineup"];
  if (!iSheet || !pSheet || !iMap || !pMap) {
    Engine.Log.error(ctx, "VERIFY_IMPORT", "import or Parent Lineup sheet/map not found.");
    return;
  }

  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const iData = iSheet.getDataRange().getValues();
  iData.shift();
  const pData = pSheet.getDataRange().getValues();
  pData.shift();

  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });

  const fieldsToCompare = ["Series", "Opening", "Range", "Venue", "Pricing"];
  let flagged = 0;
  let importOnly = 0;
  let parentOnly = 0;
  let renamedCandidate = 0;
  const matchedParentRows = {};

  iData.forEach((iRow, index) => {
    const name = iRow[iCol("EventName")];
    if (!name) return;
    let match = pByName[normalize(name)];
    let isRenameCandidate = false;

    if (!match) {
      const candidates = pData
        .map((row, rowIndex) => ({ row: row, rowIdx: rowIndex + 2 }))
        .filter(candidate => ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iRow[iIdx]) === normalize(candidate.row[pIdx]);
        }));
      if (candidates.length === 1) {
        match = candidates[0];
        isRenameCandidate = true;
        renamedCandidate++;
      } else {
        importOnly++;
        Engine.Log.write(ctx, {
          stage: "VERIFY_IMPORT",
          sheetName: "import",
          rowIdx: index + 2,
          id: name,
          type: "IMPORT_ONLY",
          details: "No matching Parent Lineup row found."
        });
        return;
      }
    }

    matchedParentRows[match.rowIdx] = true;

    const drifted = fieldsToCompare.some(field => {
      const iIdx = iCol(field);
      const pIdx = pCol(field);
      if (iIdx < 0 || pIdx < 0) return false;
      return String(iRow[iIdx] || "").trim() !== String(match.row[pIdx] || "").trim();
    });

    if (drifted || isRenameCandidate) {
      flagged++;
      const statusCol = pCol("SyncStatus");
      if (statusCol >= 0) pSheet.getRange(match.rowIdx, statusCol + 1).setValue("Manual Review");
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: "Parent Lineup",
        rowIdx: match.rowIdx,
        id: name,
        type: isRenameCandidate ? "RENAME_CANDIDATE" : "DRIFT_DETECTED",
        details: isRenameCandidate
          ? `Possible renamed event: import "${name}" vs Parent Lineup "${match.row[pCol("EventName")]}".`
          : "Parent Lineup no longer matches import for this event."
      });
    }
  });

  pData.forEach((pRow, index) => {
    const rowIdx = index + 2;
    if (matchedParentRows[rowIdx]) return;
    parentOnly++;
    Engine.Log.write(ctx, {
      stage: "VERIFY_IMPORT",
      sheetName: "Parent Lineup",
      rowIdx: rowIdx,
      id: pRow[pCol("parentID")] || pRow[pCol("EventName")],
      type: "PARENT_ONLY",
      details: "No matching import row found."
    });
  });

  Engine.Log.write(ctx, {
    stage: "VERIFY_IMPORT",
    type: "VERIFY_IMPORT_COMPLETE",
    details: `Checked ${iData.length} import rows. ${flagged} flagged (${renamedCandidate} possible rename), ${importOnly} import-only, ${parentOnly} Parent Lineup-only.`
  });

  return { checked: iData.length, flagged: flagged, renamedCandidate: renamedCandidate, importOnly: importOnly, parentOnly: parentOnly };
};

/**
 * VERIFY (read-only): Flags Lineup rows whose Date/Venue no longer match a
 * re-parse of their Parent Lineup row's DatesAndTimes range. Does not overwrite.
 */
function goVerifyParentToLineup() {
  const ctx = Engine.getContext();
  return Engine.Ingest.verifyParentToLineup(ctx);
}

Engine.Ingest.verifyParentToLineup = function(ctx) {
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const lSheet = ctx.ss.getSheetByName("Lineup");
  const pMap = ctx.maps["Parent Lineup"];
  const lMap = ctx.maps["Lineup"];
  if (!pSheet || !lSheet || !pMap || !lMap) {
    Engine.Log.error(ctx, "VERIFY_PARENT", "Parent Lineup or Lineup sheet/map not found.");
    return;
  }

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const pData = pSheet.getDataRange().getValues();
  pData.shift();
  const lData = lSheet.getDataRange().getValues();
  lData.shift();

  // Group Lineup rows by parentID, in sheet order, to line up against the parsed date range.
  const lByParent = {};
  lData.forEach((row, idx) => {
    const pid = row[lCol("parentID")];
    if (!pid) return;
    if (!lByParent[pid]) lByParent[pid] = [];
    lByParent[pid].push({ row: row, rowIdx: idx + 2 });
  });

  let checked = 0;
  let flagged = 0;
  let unparseable = 0;

  pData.forEach(pRow => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    const venue = pRow[pCol("Venue")];
    if (!parentID || !rawDates) return;

    const parsedDates = Engine.Ingest.parseParentDatesAndTimes(rawDates);
    const expectedDates = parsedDates.dates;
    if (expectedDates.length === 0) {
      unparseable++;
      Engine.Log.write(ctx, {
        stage: "VERIFY_PARENT",
        sheetName: "Parent Lineup",
        rowIdx: pData.indexOf(pRow) + 2,
        id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || "unknown format"}`
      });
      return;
    }

    const children = lByParent[parentID] || [];
    children.forEach((child, index) => {
      checked++;
      const expected = expectedDates[index];
      const childDate = child.row[lCol("Date")];
      const childVenue = child.row[lCol("Venue")];
      const expectedValid = expected && !isNaN(new Date(expected).getTime());
      const dateDrift = expectedValid && new Date(childDate).getTime() !== new Date(expected).getTime();
      const venueDrift = String(childVenue || "").trim() !== String(venue || "").trim();

      if (dateDrift || venueDrift) {
        flagged++;
        const statusCol = lCol("SyncStatus");
        if (statusCol >= 0) lSheet.getRange(child.rowIdx, statusCol + 1).setValue("Manual Review");
        Engine.Log.write(ctx, {
          stage: "VERIFY_PARENT",
          sheetName: "Lineup",
          rowIdx: child.rowIdx,
          id: child.row[lCol("UUID")],
          type: "DRIFT_DETECTED",
          details: "Lineup row no longer matches its Parent Lineup's dates/venue."
        });
      }
    });
  });

  Engine.Log.write(ctx, {
    stage: "VERIFY_PARENT",
    type: "VERIFY_PARENT_COMPLETE",
    details: `Checked ${checked} Lineup rows against Parent Lineup. ${flagged} drifted, ${unparseable} Parent Lineup row(s) had unparseable date ranges.`
  });

  return { checked: checked, flagged: flagged, unparseable: unparseable };
};