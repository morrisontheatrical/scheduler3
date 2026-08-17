/**
 * ONE-WAY MIRROR: Pulls facility data into Venue_Cal_Log for comparison.
 * Respects the 18-column VENUECALMAP and 10-column ID Registry.
 */
function syncVenueCalendarsToLog(ctx) {
  
  
  const vLogSheet = ctx.sheets.VENUECAL;
  
  if (!vLogSheet) {
    notify("Error: Venue_Cal_Log sheet not found.", "Sync Error");
    return;
  }

  const today = new Date();
  const startDate = new Date(today.getTime() - ((ctx.config.startDays|| 30) * 24 * 60 * 60 * 1000));
  const endDate = new Date(today.getTime() + ((ctx.config.endDays || 365) * 24 * 60 * 60 * 1000));

  // Fetch venue objects: [{displayName, id, venueName}, ...]
  const venues = (typeof scriptLib !== 'undefined' && scriptLib.calendarIDs) ? scriptLib.calendarIDs() : []; 
  let allVenueEvents = [];

  scriptLib.notify("Mirroring Venue Calendars...", "Facility Sync");

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

////Version 4
function syncPerformanceSpaces() {
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
  const calendars = scriptLib.calendarIDs();
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
        scriptLib.helperFormatTime(eStart),            // C: Start Time (String prevents 1899)
        event.getDescription(),                  // D: Details
        event.getLastUpdated(),                  // E: Last Updated
        space,                                   // F: Location
        scriptLib.helperFormatTime(event.getEndTime()),// G: End Time
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

