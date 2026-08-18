/*
 * Deprecated legacy sync script.
 * Prefer Engine.Sync.runMasterSync() and the Engine.* modules.
 */
console.warn("Legacy call-sync script is deprecated; use Engine.Sync.runMasterSync() instead.");

function syncCallsToCrewLog() {
  console.warn("syncCallsToCrewLog() is deprecated; use Engine.Sync.runMasterSync() instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }
  //UPDATE_NOTES 8/17/26
  //Bind to ctx.sheets.CALLS.map and route UUID assignments through Engine.IDService
  //Called by masterAggregatorSync()

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const callsSheet = ss.getSheetByName("Calls");
  const logSheet = ss.getSheetByName("Crew_Calendar_Log");
  
  const cData = callsSheet.getDataRange().getValues();
  const lData = logSheet.getDataRange().getValues();
  
  // 1. Index the Log by sourceID (Column I / Index 8)
  const logMap = {};
  for (let i = 1; i < lData.length; i++) {
    const sID = lData[i][8]; 
    if (sID) logMap[sID] = i + 1; 
  }

  for (let i = 1; i < cData.length; i++) {
    const cRow = cData[i];
    
    // 2. Back-populate callID into Calls Column I (index 8)
    let callID = cRow[8]; 
    if (!callID) {
      callID = "CALL-" + Utilities.getUuid().substring(0, 5).toUpperCase();
      callsSheet.getRange(i + 1, 9).setValue(callID);
    }

    // 3. Mapping per Tester - Sheet 3
    // Calls: C=Title, D=Date, E=Time, F=Type, G=Description
    const title = cRow[2];
    const date = cRow[3];
    const startTime = SL.helperFormatTime(cRow[4]);
    const callType = cRow[5];
    const description = `${callType} | ${cRow[6]}`; 

    const logRowValues = [
      "",             // A: Event ID
      title,          // B: Title
      date,           // C: Date
      startTime,      // D: Start
      "",             // E: End
      "See Venue",    // F: Location
      description,    // G: Description
      "Calls",        // H: Source
      callID,         // I: sourceID (Anchor)
      new Date(),     // J: Last Synced
      "Synced",       // K: Sync Status
      callType,       // L: Call Type
      false,          // M: Push Checkbox
      false           // N: Remove Checkbox
    ];

    // 4. Update or Append
    if (logMap[callID]) {
      const rowIdx = logMap[callID];
      const existing = lData[rowIdx - 1];
      
      // Change Detection: Compare Log Title(B) and Description(G)
      if (existing[1] !== title || existing[6] !== description) {
        logDetailedChange("Calls", callID, existing, logRowValues);
        logSheet.getRange(rowIdx, 1, 1, 14).setValues([logRowValues]);
        applyStatus(logSheet, rowIdx, "pending call change");
      }
    } else {
      logSheet.appendRow(logRowValues);
      const newRowIdx = logSheet.getLastRow();
      logSheet.getRange(newRowIdx, 13, 1, 2).insertCheckboxes();
      applyStatus(logSheet, newRowIdx, "Synced");
    }
  }
}
/**
 * Stage 6: Verify Calls vs Crew Log
 * Ensures labor shifts match the performance times.
 */
function verifyCallsAndCrewLog() {
  console.warn("verifyCallsAndCrewLog() is deprecated; use Engine.Sync or Engine.Maintenance validation instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logData = ss.getSheetByName("Crew_Calendar_Log").getDataRange().getValues();
  const callsSheet = ss.getSheetByName("Calls");
  const callsData = callsSheet.getDataRange().getValues();

  // 1. Map the Crew Log by UUID (childID) for fast lookup
  const logLookup = {};
  for (let i = 1; i < logData.length; i++) {
    const uuid = logData[i][CREWCALMAP.UUID];
    if (uuid) logLookup[uuid] = logData[i];
  }

  let driftCount = 0;

  // 2. Loop through Calls and check for Time/Date drift
  for (let j = 1; j < callsData.length; j++) {
    const callRow = callsData[j];
    const callIdx = j + 1;
    const childID = callRow[CALLSMAP.childID];
    
    if (!childID || !logLookup[childID]) continue;

    const parentEvent = logLookup[childID];
    const logDate = new Date(parentEvent[CREWCALMAP.Date]).toDateString();
    const callDate = new Date(callRow[CALLSMAP.Date]).toDateString();

    // Check if the Call date no longer matches the Performance date
    if (logDate !== callDate) {
      callsSheet.getRange(callIdx, 1, 1, callsSheet.getLastColumn()).setBackground("#f9cb9c"); // Orange
      callsSheet.getRange(callIdx, CALLSMAP.ShiftType + 1).setValue("Date Mismatch");
      driftCount++;
    }
  }

  return driftCount;
}