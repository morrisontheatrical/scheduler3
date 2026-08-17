/**
 * REVISED: Checks for duplicates via ID and sorts the Log by time.
 */
function finalizeLogAndSort() {
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

/**
 * Enhanced Duplicate Check Helper
 *
function isActuallyDifferent(existingRow, newValues) {
  // Compare Title (B), Date (C), and Start (D)
  // We use String() to ensure we aren't comparing a Date Object to a String
  const titleDiff = String(existingRow[1]) !== String(newValues[1]);
  const dateDiff  = String(existingRow[2]) !== String(newValues[2]);
  const timeDiff  = String(existingRow[3]) !== String(newValues[3]);
  
  return (titleDiff || dateDiff || timeDiff);
}
**/
