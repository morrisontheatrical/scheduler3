/*UPDATE_NOTES 8/17/26
This script file seems to be largely out of date.
It appears to have some conflict checking functions as well as sync functions. 
I don't ever want to lose functionality that I have built. I may have made a more efficient function that is capable of the same action, but if I don't have a good way to trigger that, like a "preset", then it almost is like losing functionality. Maybe these turn into alias's or we make a series of aliases for common uses.
*/

/**
 * ONE-WAY MIRROR: Pulls facility data into Venue_Cal_Log for comparison.
 * Respects the 18-column VENUECALMAP and 10-column ID Registry.
 */
function syncVenueCalendarsToLog(ctx) {
  //UPDATE_NOTES 8/17/26
  //Not called
  
  const vLogSheet = ctx.sheets.VENUECAL;
  
  if (!vLogSheet) {
    notify("Error: Venue_Cal_Log sheet not found.", "Sync Error");
    return;
  }

  const today = new Date();
  const startDate = new Date(today.getTime() - ((ctx.config.startDays|| 30) * 24 * 60 * 60 * 1000));
  const endDate = new Date(today.getTime() + ((ctx.config.endDays || 365) * 24 * 60 * 60 * 1000));

  // Fetch venue objects: [{displayName, id, venueName}, ...]
  const venues = (typeof SL !== 'undefined' && SL.calendarIDs) ? SL.calendarIDs() : []; 
  let allVenueEvents = [];

  SL.notify("Mirroring Venue Calendars...", "Facility Sync");

  venues.forEach(venueObj => {
    // SKIP: Avoid mirroring our own draft/work-in-progress calendars
    if (venueObj.venueName === "Draft" || venueObj.displayName.includes("Draft")) return;

    try {
      const cal = CalendarApp.getCalendarById(venueObj.id);
      if (!cal) return;

      const events = cal.getEvents(startDate, endDate);
      
      events.forEach(event => {
        let row = new Array(18).fill(""); // Explicitly 18 columns per VENUECALMAP
        
        row[VENUECALMAP.EventID]     = event.getId();
        row[VENUECALMAP.Title]       = event.getTitle() || "No Title";
        row[VENUECALMAP.Date]        = event.getStartTime();
        row[VENUECALMAP.Start]       = event.getStartTime(); // Stored as Date object for formatting
        row[VENUECALMAP.End]         = event.getEndTime();
        row[VENUECALMAP.Location]    = venueObj.venueName; 
        row[VENUECALMAP.Description] = event.getDescription();
        row[VENUECALMAP.Source]      = venueObj.displayName;
        row[VENUECALMAP.UUID]        = "V-" + event.getId().substring(0, 12);
        row[VENUECALMAP.LastSynced]  = new Date();
        row[VENUECALMAP.SyncStatus]  = "Live Facility Data";

        allVenueEvents.push(row);
      });
    } catch (e) { 
      console.error(`Error syncing ${venueObj.displayName}: ${e.message}`); 
    }
  });

  // Batch Write
  if (allVenueEvents.length > 0) {
    // Clear old data (keep headers)
    if (vLogSheet.getLastRow() > 1) {
      vLogSheet.getRange(2, 1, vLogSheet.getLastRow() - 1, 18).clearContent();
    }
    vLogSheet.getRange(2, 1, allVenueEvents.length, 18).setValues(allVenueEvents);
    
    masterLog({
      stage: "MIRROR",
      sheetName: "Venue_Cal_Log",
      details: `Successfully mirrored ${allVenueEvents.length} events from building calendars.`
    });
  }
  
  notify(`Sync Complete: ${allVenueEvents.length} events mirrored.`, "Success");
}



function checkRoomConflicts() {
  //UPDATE_NOTES 8/17/26
  //Not called
  //Originally intended to identify when a room was double-booked. Am I trying to schedule over an existing event? Am I about to make a duplicate event?


  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const crewLog = ss.getSheetByName("Crew_Calendar_Log").getDataRange().getValues();
  const venueLog = ss.getSheetByName("Venue_Cal_Log").getDataRange().getValues();
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");

  let conflictCount = 0;

  // Loop through your planned shows
  for (let i = 1; i < crewLog.length; i++) {
    const planned = crewLog[i];
    const pDate = new Date(planned[CREWCALMAP.Date]).toDateString();
    const pLoc  = planned[CREWCALMAP.Location];

    // Search the Venue Log for matches on the same Date and Location
    const matches = venueLog.filter(vRow => {
      const vDate = new Date(vRow[VENUECALMAP.Date]).toDateString();
      const vLoc  = vRow[VENUECALMAP.Location];
      return vDate === pDate && vLoc === pLoc;
    });

    // Check for time overlaps among matches
    matches.forEach(match => {
      // Logic: If (StartA < EndB) AND (EndA > StartB), they overlap!
      // For simplicity here, we'll flag any match on the same day/venue 
      // that isn't the show itself.
      if (match[VENUECALMAP.Title] !== planned[CREWCALMAP.Title]) {
        applyStatus(logSheet, i + 1, "Location Conflict");
        conflictCount++;
      }
    });
  }
  
  return conflictCount;
}
/**
 * Searches the Venue_Cal_Log for an existing event that matches the planned show.
 * @param {Array} plannedRow The row from Crew_Calendar_Log being processed.
 * @param {Array} vData The entire data range from Venue_Cal_Log.
 * @return {string|null} Returns the EventID if found, else null.
 */
function findExistingVenueEvent(plannedRow, vData) {
  //UPDATE_NOTES 8/17/26
  //Called by writeNewSeason() in 0_draft season.gs

  const pTitle = String(plannedRow[CREWCALMAP.Title]).toLowerCase();
  const pDate = new Date(plannedRow[CREWCALMAP.Date]).toDateString();
  const pLoc = plannedRow[CREWCALMAP.Location];

  // We loop through the mirror of the building's calendars
  for (let i = 1; i < vData.length; i++) {
    const vRow = vData[i];
    const vDate = new Date(vRow[VENUECALMAP.Date]).toDateString();
    const vLoc = vRow[VENUECALMAP.Location];
    const vTitle = String(vRow[VENUECALMAP.Title]).toLowerCase();

    // 1. Basic Check: Same Day and Same Room?
    if (vDate === pDate && vLoc === pLoc) {
      
      // 2. Title Match Check: Does the venue event title contain our show title (or vice versa)?
      // e.g. "Nutcracker Tech" matches "Nutcracker"
      const isMatch = vTitle.includes(pTitle) || pTitle.includes(vTitle);
      
      if (isMatch) {
        return vRow[VENUECALMAP.EventID]; // Match Found!
      }
    }
  }
  return null;
}


/**
 * Syncs external venue calendars and attempts to map them to Lineup IDs.
 */
function syncPerformanceSpaces() {
  //UPDATE_NOTES 8/17/26
  //Called by masterAggregatorSync() in 0_onOpen.gs


  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const perfSheet = ss.getSheetByName("Performance Spaces");
  const lineupSheet = ss.getSheetByName("Lineup");
  const tz = Session.getScriptTimeZone();

  // 1. Setup Lineup Map for Linking
  const lineupData = lineupSheet.getDataRange().getValues();
  const lineupMap = {};
  lineupData.shift();
  lineupData.forEach(row => {
    const d = row[13]; // parsedDate
    if (!(d instanceof Date)) return;
    const dateKey = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    // Normalize: Remove spaces and lowercase for better matching
    const nameKey = String(row[0] || "").toLowerCase().trim();
    lineupMap[nameKey + "|" + dateKey] = { pID: row[9], cID: row[10] };
  });

  // 2. Calendar Settings (Replace with your Library Name, e.g., 'Lib')
    const calendars = SL.calendarIDs();
  const start = new Date(new Date().getTime() - (20 * 24 * 60 * 60 * 1000));
  const end = new Date(new Date().getTime() + (60 * 24 * 60 * 60 * 1000));
  
  let finalRows = [];

  for (let space in calendars) {
    const cal = CalendarApp.getCalendarById(calendars[space]);
    if (!cal) continue;
    
    cal.getEvents(start, end).forEach(event => {
      const eTitle = event.getTitle();
      const eStart = event.getStartTime();
      const dateKey = Utilities.formatDate(eStart, tz, "yyyy-MM-dd");
      const nameKey = eTitle.toLowerCase().trim();
      
      const match = lineupMap[nameKey + "|" + dateKey] || { pID: "", cID: "" };

      // status logic: Synced if ID is found, otherwise Manual Review
      const status = match.cID ? "Synced" : "Manual Review";

      finalRows.push([
        eTitle,                                  // A: Title
        eStart,                                  // B: Date Object
        SL.helperFormatTime(eStart),            // C: Start Time (String prevents 1899)
        event.getDescription(),                  // D: Details
        event.getLastUpdated(),                  // E: Last Updated
        space,                                   // F: Location
        SL.helperFormatTime(event.getEndTime()),// G: End Time
        event.getId(),                           // H: Event ID
        status,                                  // I: Status (Imported from Venue)
        match.pID,                               // J: parentID
        match.cID                                // K: childID
      ]);
    });
  }

  perfSheet.getRange(2, 1, perfSheet.getMaxRows(), 11).clearContent();
  if (finalRows.length > 0) {
    perfSheet.getRange(2, 1, finalRows.length, 11).setValues(finalRows);
  }
}

/**
 * Now acts purely as a logic engine. Mutates the 'row' array in memory.
 * Returns a log object for the Drift Summary.
 */
function handleSyncDrift(row, map, event, isAdopted, calLastUpdated, sheetLastSynced, ctx) {
  //UPDATE_NOTES 8/17/26
  //Called by VerifyCrewLogAndCalendar(ctx)

  const CONFIG = ctx.settings; // Passed from ControlPanel
  const isAutoSyncEnabled = row[map.AutoSync] === true;
  const calendarIsNewer = calLastUpdated > (sheetLastSynced + 5000); 

  // --- CASE A: THE "PULL" (Calendar has newer info) ---
  if (calendarIsNewer) {
    if (CONFIG["Automatic Changes when possible?"] === "TRUE" && isAutoSyncEnabled) {//Outdated decision logic
      // Modify the array in memory (NO SpreadsheetApp calls here!)
      row[map.Title] = event.getTitle();
      row[map.Start] = SL.helperFormatTime(event.getStartTime());
      row[map.End]   = SL.helperFormatTime(event.getEndTime());
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
      // 1. Get Valid Times using your new SL function
      const times = SL.getValidEventTimes(ctx, row[map.Date], row[map.Start], row[map.End]);
      
      // Update array in memory to match the calculated end time
      row[map.End] = SL.helperFormatTime(times.end);
      
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

function verifyCrewLogAndCalendar(ctx) {
//UPDATE_NOTES 8/17/26
//Pass ctx as parameter and replace direct sheet updates with batchWrite / patchRows
//Not called anywhere else

  const CONFIG = getGlobalConfig();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // USE THE LIBRARY TO GET THE MAP
  const MAP = SL.getMap("Crew_Calendar_Log"); 
  const sheet = ctx.sheets.CREWCAL
  const data = sheet.getDataRange().getValues();
  
  const draftCalInfo = SL.getCalID(CONFIG.DraftSeasonCalendarName);
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
    const venueInfo = SL.getCalID(location);
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
    const calStart = SL.helperFormatTime(event.getStartTime());
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
 * Provides a high-level summary of the season's health.
 */
function finalizeCrewLogStatus() {
  //UPDATE_NOTES 8/17/26
  //Not called

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
 Pulls external calendar edits into the Log.
 */
function pullCalendarUpdatesToLog(calendarId, sourceName) {
  //UPDATE_NOTES 8/17/26
  //Called by PullDraftCal() in 0_draft season.gs

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
      const calStart = SL.helperFormatTime(event.getStartTime());

      // If the Calendar has been edited manually
      if (existing[1] !== calTitle || existing[3] !== calStart) {
        const updatedRow = [...existing];
        updatedRow[1] = calTitle;
        updatedRow[3] = event.getStartTime();
        updatedRow[4] = SL.helperFormatTime(event.getEndTime());
        updatedRow[9] = new Date(); // Last Synced
        
        logDetailedChange(sourceName, eID, existing, updatedRow);
        logSheet.getRange(rowIdx, 1, 1, 14).setValues([updatedRow]);
        applyStatus(logSheet, rowIdx, "Pulled from Crew Calendar");
      }
      else {}
    }
  });
}
