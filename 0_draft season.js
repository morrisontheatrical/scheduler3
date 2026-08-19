
/**
 * Deprecated legacy entrypoint.
 * Prefer Engine.Sync.runMasterSync() and the Engine.* modules.
 */
function writeNewSeason() {
  console.warn("writeNewSeason() is deprecated; use Engine.Sync.runMasterSync() instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }
  throw new Error("Sync engine is unavailable.");
}

function pullDraftCal(){
  console.warn("pullDraftCal() is deprecated; use Engine.Sync or Engine.Calendar helpers instead.");
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    return Engine.Sync.runMasterSync();
  }
  throw new Error("Sync engine is unavailable.");
}

 /**
 * Removes all events from a specified calendar within a set range.
 * Use with caution!
 */
function wipeDraftSeasonCal() {
  console.warn("wipeDraftSeasonCal() is deprecated; use Engine.Maintenance or a dedicated delete utility instead.");
  const ui = SpreadsheetApp.getUi();
  
  const cal = SL && SL.getDraftCalendar ? SL.getDraftCalendar() : null;
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
