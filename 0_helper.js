/*UPDATE_NOTES 8/17/26
All helper functions or other oddball short functions should live here
*/


function getParentData(identifier){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Parent Lineup");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  
  // We assume:
  // Column A (Index 0) = Event Title
  //Column I (Index 8) = parentID
  // Column J (Index 9) = childID / UUID
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const title = row[0];
    const uuid  = row[9];

    // Check if the identifier matches either the Title or the UUID
    if (identifier === uuid || identifier === title) {
      return row; 
    }
  }
  console.warn("No match found for: " + identifier);
  return null;
}

/**
 * Finds and returns a full row from the Lineup sheet.
 * @param {string} identifier - The ParentID (UUID) or the Event Title.
 * @return {Array|null} The row data array, or null if not found.
 */
function getChildData(identifier) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Lineup");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  
  // We assume:
  // Column A (Index 0) = Event Title
  //Column I (Index 8) = parentID
  // Column J (Index 9) = childID / UUID
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const title = row[0];
    const uuid  = row[9];

    // Check if the identifier matches either the Title or the UUID
    if (identifier === uuid || identifier === title) {
      return row; 
    }
  }

  console.warn("No match found for: " + identifier);
  return null;
}

function getRowByUuid(uuid) {
  //UPDATE_NOTES 8/17/26
  //seems similar to findIdAndJump(id) in UI_helper.gs

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lineup");
  const data = sheet.getDataRange().getValues();
  
  // Using the Global Map to find the ID column
  const idColumn = data.map(r => r[LINEUP_MAP.UUID]);
  const rowIndex = idColumn.indexOf(uuid);

  return rowIndex !== -1 ? data[rowIndex] : null;
}

function createCallFromLineup(searchKey) {
  const parentRow = getLineupRow(searchKey);
  
  if (parentRow) {
    const title = parentRow[LINEUP_MAP.TITLE];
    const location = parentRow[LINEUP_MAP.LOCATION];
    
    // Now you can use this data to populate your 'Calls' sheet
    Logger.log("Found parent event: " + title + " at " + location);
  }
}

function getCrewCall(eventID) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Crew_Calendar_Log");
  const data = sheet.getDataRange().getValues();
  
  // Using the Global Map to find the ID column
  const idColumn = data.map(r => r[CREWCALMAP.EventID]);
  const rowIndex = idColumn.indexOf(eventID);

  return rowIndex !== -1 ? data[rowIndex] : null;
}

function getEventDetails(eventID, calendarId){
  const cal = CalendarApp.getCalendarById(calendarId);
  const events =  cal.getEventById(eventID);

  return events;

}

function getCalendar(calendarId){
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) {
    SpreadsheetApp.getUi().alert("Calendar not found.");
    return;
  }
  
  return cal;

}

//returns 14 days in past to 400 days in future from specified calendar
function getCalEvents(calendarId) {
  const cal = getCalendar(calendarId);
  if (!cal) {
    SpreadsheetApp.getUi().alert("Calendar not found.");
    return;
  }
  const now = new Date();
  const events = cal.getEvents(new Date(now.getTime() - 14*24*60*60*1000), new Date(now.getTime() + 400*24*60*60*1000)); //14 days ago to 400 days from now
  return events;
}

function updateCCL(){
  console.warn("updateCCL() is deprecated; use Engine.Sync.runMasterSync() instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }

  const data = logSheet.getDataRange().getValues();
  const target = SL && SL.getCalID ? SL.getCalID("Draft 26-27") : null;
  const destCal = CalendarApp.getCalendarById(target.id);

  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    const eventId = row[0];      // Col A (Original ID)
    let event;
    if (eventId) {
      event = destCal.getEventById(eventId);
    }
    if (event) {
      getCrewCall(eventId);
      getEventDetails(eventId,target.id).getDescription

    }

}}

/**
 * Example of how to use your logMap to update a specific event 
 * found during a calendar crawl.
 */
function updateLogFromCalendar(calendarEvent) {
  //UPDATE_NOTES 8/17/26
  //Not called

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  
  // 1. Get the Map (Your snippet)
  const logData = logSheet.getDataRange().getValues();
  const logMap = {}; 
  for (let i = 1; i < logData.length; i++) {
    const id = logData[i][CREWCALMAP.EventID]; // Column A
    if (id) logMap[id] = i + 1;
  }

  const calId = calendarEvent.getId();
  const rowIndex = logMap[calId];

  if (rowIndex) {
    // MATCH FOUND: Update existing row
    const status = "Pulled from Crew Calendar";
    const color = "#ffd966"; // Yellow
    
    logSheet.getRange(rowIndex, CREWCALMAP.SyncStatus + 1)
            .setValue(status)
            .setBackground(color);
            
    logSheet.getRange(rowIndex, CREWCALMAP.LastSynced + 1)
            .setValue(new Date());
            
    console.log("Updated row " + rowIndex + " for event: " + calendarEvent.getTitle());
  } else {
    // NO MATCH: This event is in the Calendar but not the Sheet
    console.log("New event detected. Should append to log.");
  }
}






function updateCrewCalLog() {
  console.warn("updateCrewCalLog() is deprecated; use Engine.Sync.runMasterSync() instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }

  const data = logSheet.getDataRange().getValues();
  let count = 0;

  // --- THIS IS WHERE YOU DEFINE THE DESTINATION ---
  const target = SL && SL.getCalID ? SL.getCalID("Draft 26-27") : null;
  const destCal = CalendarApp.getCalendarById(target.id);

  //for each line on log sheet
  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    let eventTitle = row[1];  // Column B
    let startDate  = row[2];  // Column C
    let startTime  = row[3];  // Column D
    let description = row[6]; // Column G
    let location    = row[5]; // Column F
    let isSelected  = row[12]; // Column M (Checkbox)
    //const row = data[i];
    //const title = row[1];        // Col B
    //const start = new Date(row[3]); // Col D
    const eventId = row[0];      // Col J (Original ID)
    //const staff = row[10];       // Col K (Staff)
      const now = new Date();

    let event;
    
    // Check if event already exists on the CREW calendar
    if (eventId) {
      event = destCal.getEventById(eventId);
    }

    if (event) {
      // UPDATE EXISTING
      event.setTitle(eventTitle);
      event.setDescription(row[6]); // Col G
      
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


      
      logSheet.getRange(i + 1, 13).setValue(false); 
      count++;

    } else {

    }
    }


  
  
  SpreadsheetApp.flush(); // Crucial to ensure the IDs are written to the sheet
  SpreadsheetApp.getUi().alert("Successfully updated " + count + " events from the Crew Calendar.");


}

/**
 * REVISED: Checks for duplicates via ID and sorts the Log by time.
 */
function finalizeLogAndSort() {
//UPDATE_NOTES 8/17/26
//Moved from e_double check me.gs


  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;

  const range = logSheet.getRange(2, 1, lastRow - 1, 14);
  
  // Sort by Date (Col C / index 2) then Start Time (Col D / index 3)
  range.sort([
    {column: 3, ascending: true}, 
    {column: 4, ascending: true}
  ]);
  
  postToLog("SYSTEM", "Log sorted by Date and Start Time.");
}

