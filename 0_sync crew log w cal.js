/**
 * PULL: Mirrors building calendars into Venue_Cal_Log.
 
 removed as duplicate 
function syncVenueCalendarsToLog(ctx) {
  const venues = scriptLib.calendarIDs(); // wrong. we have ctx.lookups.calendars
  let allEvents = [];

  const start = new Date(new Date().getTime() - (ctx.config.StartSync * 24 * 60 * 60 * 1000));
  const end = new Date(new Date().getTime() + (ctx.config.EndSync * 24 * 60 * 60 * 1000));

  venues.forEach(venueObj => {
    // Policy check: Skip draft calendars
    if (venueObj.venueName === "Draft" || venueObj.displayName.includes("Draft")) return;

    const cal = CalendarApp.getCalendarById(venueObj.id);
    if (!cal) return;

    cal.getEvents(start, end).forEach(event => {
      // Create object matching VENUECALMAP keys
      allEvents.push({
        EventID: event.getId(),
        Title: event.getTitle() || "No Title",
        Date: event.getStartTime(),
        Start: event.getStartTime(),
        End: event.getEndTime(),
        Location: venueObj.venueName,
        Description: event.getDescription(),
        Source: venueObj.displayName,
        UUID: "V-" + event.getId().substring(0, 12)
      });
        // Use your status engine instead of a string
    // This ensures the row gets the correct color/behavior immediately
    Engine.Status.apply(ctx, "VENUECAL", null, "Pulled from Calendar", {
      details: `Mirrored from ${venueObj.displayName}`,
      targetObj: rowObj // Apply status to the object before it's batch-written
    });

    return rowObj;
  });

  if (allVenueEvents.length > 0) {
    batchWrite('VENUECAL', allVenueEvents, ctx);
  }
});
}*/

/**
 * Now acts purely as a logic engine. Mutates the 'row' array in memory.
 * Returns a log object for the Drift Summary.
 */
function handleSyncDrift(row, map, event, isAdopted, calLastUpdated, sheetLastSynced, ctx) {
  const CONFIG = ctx.settings; // Passed from ControlPanel
  const isAutoSyncEnabled = row[map.AutoSync] === true;
  const calendarIsNewer = calLastUpdated > (sheetLastSynced + 5000); 

  // --- CASE A: THE "PULL" (Calendar has newer info) ---
  if (calendarIsNewer) {
    if (CONFIG["Automatic Changes when possible?"] === "TRUE" && isAutoSyncEnabled) {//Outdated decision logic
      // Modify the array in memory (NO SpreadsheetApp calls here!)
      row[map.Title] = event.getTitle();
      row[map.Start] = scriptLib.helperFormatTime(event.getStartTime());
      row[map.End]   = scriptLib.helperFormatTime(event.getEndTime());
      row[map.Location] = event.getLocation();
      row[map.LastSynced] = new Date();
      row[map.SyncStatus] = isAdopted ? "Adopted from Venue" : "Pulled from Calendar";
      
      return { action: "Pulled", details: `Updated ${row[map.Title]} from Calendar` };
    } else {
      row[map.SyncStatus] = "Manual Review";
      return { action: "Blocked", details: "Calendar newer, but AutoSync OFF" };
    }
  } 

  // --- CASE B: THE "PUSH" (Sheet -> Calendar) ---
  else if (row[map.PushtoCrewCalendar] === true) {
    
    const modePolicy = ctx.modes[ctx.modeName];
    if (!modePolicy.writeToCalendar) {
    row[map.SyncStatus] = "Manual Review";
    return { action: "Blocked", details: "Write operation blocked by Global Mode." };
    }
    
    if (isAdopted) {
      // Enforcing Rule 4: We NEVER push to a Venue Calendar
      row[map.PushtoCrewCalendar] = false;
      row[map.SyncStatus] = "Adopted from Venue";
      return { action: "Ignored", details: "Cannot push to Read-Only Venue Calendar." };
    } else {
      // 1. Get Valid Times using your new scriptLib function
      const times = scriptLib.getValidEventTimes(ctx, row[map.Date], row[map.Start], row[map.End]);
      
      // Update array in memory to match the calculated end time
      row[map.End] = scriptLib.helperFormatTime(times.end);
      
      // 2. Push to Google Calendar API
      event.setTitle(row[map.Title]);
      event.setLocation(row[map.Location]);
      event.setDescription(row[map.Description] || "");
      event.setTime(times.start, times.end);

      // 3. Update Status in array
      row[map.PushtoCrewCalendar] = false;
      row[map.LastSynced] = new Date();
      row[map.SyncStatus] = "Pushed to Calendar";
      
      return { action: "Pushed", details: `Pushed ${row[map.Title]} to Crew Calendar` };
    }
  }
  return null; // No drift
}

function verifyCrewLogAndCalendar() {
  const CONFIG = getGlobalConfig();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // USE THE LIBRARY TO GET THE MAP
  const MAP = scriptLib.getMap("Crew_Calendar_Log"); 
  const sheet = ctx.sheets.CREWCAL
  const data = sheet.getDataRange().getValues();
  
  const draftCalInfo = scriptLib.getCalID(CONFIG.DraftSeasonCalendarName);
  const draftCal = draftCalInfo ? CalendarApp.getCalendarById(draftCalInfo.id) : null;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowIdx = i + 1;
    const eventID = row[CREWCALMAP.EventID];
    const location = row[CREWCALMAP.Location];
    const source = String(row[CREWCALMAP.Source] || "");
    const isAdopted = source.includes("Venue");

    // --- STRATEGY A: NO ID YET ---
    if (!eventID) {
      applyStatus(sheet, rowIdx, "Not on Calendar");
      continue;
    }

    // --- STRATEGY B: EXTERNAL VENUE (Off-Site) ---
    // Check if this location exists in our facility list
    const venueInfo = scriptLib.getCalID(location);
    if (!venueInfo && !isAdopted) {
      // This is an external venue. We can't sync it, so we mark it as "External".
      applyStatus(sheet, rowIdx, "External Venue", { details: "No Google Calendar for this location." });
      continue; 
    }

    // --- STRATEGY C: IDENTIFY THE CALENDAR ---
    let activeCal = isAdopted ? (venueInfo ? CalendarApp.getCalendarById(venueInfo.id) : null) : draftCal;

    if (!activeCal) {
      applyStatus(sheet, rowIdx, "Manual Review", { details: "Calendar connection lost." });
      continue;
    }

    // --- STRATEGY D: FETCH & COMPARE ---
    const event = activeCal.getEventById(eventID);

    if (!event) {
      // DOUBLE CHECK: Is it possible the ID shifted to a different calendar?
      // For now, if it's not where it's supposed to be, it's "Deleted".
      applyStatus(sheet, rowIdx, "Deleted from Calendar");
      continue;
    }

    // --- STRATEGY E: SYNC CHECK ---
    const calLastUpdated = event.getLastUpdated().getTime();
    const sheetLastSynced = row[CREWCALMAP.LastSynced] ? new Date(row[CREWCALMAP.LastSynced]).getTime() : 0;
    
    // Check if they are actually in sync right now
    const calTitle = event.getTitle();
    const calStart = scriptLib.helperFormatTime(event.getStartTime());
    const match = (calTitle === String(row[CREWCALMAP.Title]) && calStart === String(row[CREWCALMAP.Start]));

    if (match) {
      // Update the status to Synced and refresh the timestamp to stop the loop
      applyStatus(sheet, rowIdx, isAdopted ? "Adopted from Venue" : "Synced");
      sheet.getRange(rowIdx, CREWCALMAP.LastSynced + 1).setValue(new Date());
      
    } else {
      // Trigger Pull or Push based on your AutoSync logic...
      handleSyncDrift(sheet, rowIdx, row, event, isAdopted, calLastUpdated, sheetLastSynced);
    }
  }
}
/**
 * Stage 7: Confirm Final Status
 * Provides a high-level summary of the season's health.
 */
function finalizeCrewLogStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  const data = logSheet.getDataRange().getValues();
  
  let manualCount = 0;
  let conflictCount = 0;
  let syncedCount = 0;

  for (let i = 1; i < data.length; i++) {
    const status = data[i][CREWCALMAP.SyncStatus];
    if (status === "Manual Review") manualCount++;
    else if (status === "Location Conflict") conflictCount++;
    else if (status.includes("Synced") || status.includes("Adopted") || status.includes("Pushed")) syncedCount++;
  }

  // Determine the Final Master Status
  let masterStatus = "✅ SEASON SYNCED (No Discrepancies)";
  if (conflictCount > 0) masterStatus = `⚠️ SYNCED WITH ${conflictCount} VENUE CONFLICTS`;
  if (manualCount > 0) masterStatus = `🚨 MANUAL REVIEW NEEDED (${manualCount} ROWS)`;

  // Post the master status to a specific cell in the Control Panel if you have one
  const configSheet = ss.getSheetByName("ControlPanel");
  if (configSheet) {
    configSheet.getRange("B10").setValue(masterStatus); // Adjust cell as needed
    configSheet.getRange("B11").setValue(`Last Health Check: ${Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM/dd HH:mm")}`);
  }

  return masterStatus;
}
/**
 * Phase 2 & 5: Pulls external calendar edits into the Log.
 */
function pullCalendarUpdatesToLog(calendarId, sourceName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  const cal = CalendarApp.getCalendarById(calendarId);
  
  const now = new Date();
  const events = cal.getEvents(new Date(now.getTime() - 14*24*60*60*1000), new Date(now.getTime() + 400*24*60*60*1000)); //14 days ago to 400 days from now
  
  //captures "Crew_Calendar_Log" to memory and creates a copy
  const logData = logSheet.getDataRange().getValues();
  const logMap = {}; // Key by Event ID (Column A)
  for (let i = 1; i < logData.length; i++) {
    if (logData[i][0]) logMap[logData[i][0]] = i + 1;
  }

  events.forEach(event => {
    const eID = event.getId();
    const rowIdx = logMap[eID];
    
    if (rowIdx) {
      const existing = logData[rowIdx - 1];
      const calTitle = event.getTitle();
      const calStart = scriptLib.helperFormatTime(event.getStartTime());

      // If the Calendar has been edited manually
      if (existing[1] !== calTitle || existing[3] !== calStart) {
        const updatedRow = [...existing];
        updatedRow[1] = calTitle;
        updatedRow[3] = event.getStartTime();
        updatedRow[4] = scriptLib.helperFormatTime(event.getEndTime());
        updatedRow[9] = new Date(); // Last Synced
        
        logDetailedChange(sourceName, eID, existing, updatedRow);
        logSheet.getRange(rowIdx, 1, 1, 14).setValues([updatedRow]);
        applyStatus(logSheet, rowIdx, "Pulled from Crew Calendar");
      }
      else {}
    }
  });
}