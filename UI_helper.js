/**
 * UI Search: Find an ID and jump to its sheet location.
 */
function findIdAndJump(id) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt("🔍 Find ID", "Enter UUID, parentID, or callID:", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const searchId = response.getResponseText().trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const idLog = ss.getSheetByName("idLog");
  const data = idLog.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][ID_LOG_MAP.UniqueID] === searchId) {
      const location = data[i][ID_LOG_MAP.SheetLocation];
      if (!location || location === "N/A") break;

      const [sheetName, rowPart] = location.split("!");
      const rowNum = parseInt(rowPart.replace("R", ""));
      const targetSheet = ss.getSheetByName(sheetName);
      
      if (targetSheet) {
        ss.setActiveSheet(targetSheet);
        targetSheet.getRange(rowNum, 1).activate();
        notify(`Found ${searchId} at ${location}`, "Search");
        return;
      }
    }
  }
  ui.alert("ID not found or has no recorded location.");
}