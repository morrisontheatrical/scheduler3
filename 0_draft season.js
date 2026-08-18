
/**
 * STAGE 5: Promotes rows from Crew_Calendar_Log to the Calendar.
 * Respects Tags: Bypass, Push to Calendar, Delete from Calendar, AutoSync.
 */
function writeNewSeason() {
  //UPDATE_NOTES 8/17/26
  //Refactor column references to ctx.sheets.CREWCAL.map and replace direct CalendarApp calls with Engine.Calendar.
  //Not called

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const CONFIG = getGlobalConfig(); 
  const ui = SpreadsheetApp.getUi();
  
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  const venueSheet = ss.getSheetByName("Venue_Cal_Log");
  const logData = logSheet.getDataRange().getValues();
  const vData = venueSheet ? venueSheet.getDataRange().getValues() : [];

  const calId = CONFIG.CalendarID || "";
  const destCal = (calId) ? CalendarApp.getCalendarById(calId) : CalendarApp.getCalendarsByName(CONFIG.Mode)[0];

  if (!destCal) {
    ui.alert(`Error: Calendar '${CONFIG.Mode}' not found.`);
    return;
  }

  let created = 0, deleted = 0, updated = 0, adopted = 0;
  notify("Syncing to " + CONFIG.Mode + "...", "Calendar Push");

  for (let i = 1; i < logData.length; i++) {
    const row = logData[i];
    const rowIdx = i + 1;
    const options = row[CREWCALMAP.Options];
    const eventID = row[CREWCALMAP.EventID];
    const uuid = row[CREWCALMAP.UUID];

    if (checkOption(options, "Bypass")) continue;

    // --- DELETION ---
    if (checkOption(options, "Delete from Calendar")) {
      if (eventID) {
        try {
          const event = destCal.getEventById(eventID);
          if (event) event.deleteEvent();
          deleted++;
          applyStatus(logSheet, rowIdx, "Deleted from Calendar", { id: uuid, stage: "SYNC_CLEANUP" });
          logSheet.getRange(rowIdx, CREWCALMAP.EventID + 1).setValue("");
        } catch (e) { console.warn("Event already gone."); }
      }
      continue; 
    }

    // --- SYNC FILTER ---
    const shouldPush = CONFIG.PushAll || checkOption(options, "Push to Calendar") || checkOption(options, "AutoSync");
    if (!shouldPush) continue;

    // Get validated times (Ensures start < end)
    const times = getValidEventTimes(row[CREWCALMAP.Date], row[CREWCALMAP.Start], row[CREWCALMAP.End]);
    if (!times.start) continue;

    // --- A: UPDATE OR REASSOCIATE ---
    if (eventID) {
      try {
        const event = destCal.getEventById(eventID);
        if (event) {
          event.setTitle(row[CREWCALMAP.Title]);
          event.setTime(times.start, times.end);
          event.setDescription(row[CREWCALMAP.Description]);
          event.setLocation(row[CREWCALMAP.Location]);
          
          applyStatus(logSheet, rowIdx, "Pushed to Calendar", { id: uuid, stage: "SYNC_UPDATE" });
          updated++;
          continue; // Move to next row
        }
      } catch (e) { 
        console.warn("Broken ID for " + row[CREWCALMAP.Title] + ". Attempting reassociation...");
      }
    }

    // --- B: ADOPT OR CREATE ---
    // If we reach here, either eventID was blank OR the ID was invalid
    const foundId = findExistingVenueEvent(row, vData);
    
    if (foundId) {
      logSheet.getRange(rowIdx, CREWCALMAP.EventID + 1).setValue(foundId);
      applyStatus(logSheet, rowIdx, "Adopted from Venue", { 
        id: uuid, 
        stage: "REASSOCIATION", 
        details: "Matched wiped ID via Mirror Log" 
      });
      adopted++;
    } else {
      const newEvent = destCal.createEvent(row[CREWCALMAP.Title], times.start, times.end, {
        description: row[CREWCALMAP.Description],
        location: row[CREWCALMAP.Location]
      });
      
      logSheet.getRange(rowIdx, CREWCALMAP.EventID + 1).setValue(newEvent.getId());
      applyStatus(logSheet, rowIdx, "Pushed to Calendar", { id: uuid, stage: "SYNC_NEW" });
      created++;
    }
  }

  ui.alert(`Sync Results:\nCreated: ${created}\nUpdated: ${updated}\nAdopted: ${adopted}\nDeleted: ${deleted}`);
}

function pullDraftCal(){
  //scan calendar for events to add to crew calendar log
  // Get the target calendar (Draft 26-27)
  const target = SL.getCalID("Draft 26-27"); 
  const cal = CalendarApp.getCalendarById(target.id);
  if (!cal) {
    SpreadsheetApp.getUi().alert("Draft Calendar not found.");
    return;
  }
  pullCalendarUpdatesToLog(cal,"Draft 26-27")

}

 /**
 * Removes all events from a specified calendar within a set range.
 * Use with caution!
 */
function wipeDraftSeasonCal() {
  const ui = SpreadsheetApp.getUi();
  
  // 1. Get the Calendar ID (Using your getCalendar helper or manual ID)
  // Example: target = getCalendar("Draft 26-27");
  
  const cal = SL.getDraftCalendar();
  if (!cal) {
    ui.alert("Error: Calendar not found. Check the ID.");
    return;
  }

  // 2. Safety Confirmation
  const response = ui.alert(
    'Warning!', 
    `Are you sure you want to delete ALL events from "${cal.getName()}" for the next 120 days? This cannot be undone.`, 
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) {
    ui.alert("Operation cancelled.");
    return;
  }

  // 3. Define the "Wipe Zone"
  // Usually matches your sync range (e.g., 14 days ago to 400 days out)
  const now = new Date();
  const start = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
  const end = new Date(now.getTime() + (400 * 24 * 60 * 60 * 1000));
  const events = cal.getEvents(start, end);
  
  if (events.length === 0) {
    ui.alert("No events found in that range to delete.");
    return;
  }

  // 4. Execution Loop
  ui.showModelessDialog(HtmlService.createHtmlOutput("<b>Deleting " + events.length + " events...</b>"), "Progress");

  events.forEach((event, index) => {
    try {
      event.deleteEvent();
      // Optional: Pause every 50 events to avoid Google's rate limits
      if (index % 50 === 0) {
        Utilities.sleep(500); 
      }
    } catch (e) {
      console.warn("Could not delete event: " + event.getTitle());
    }
  });

  ui.alert("Success: " + events.length + " events removed from " + cal.getName());

}
