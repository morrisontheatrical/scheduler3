function onOpen() {
    //repairMapRegistry();
  
  SpreadsheetApp.getUi().createMenu('📅 Scheduler')
    .addItem('1. Ingest Season (goParent)', 'goParent')
    .addItem('2. Explode Dates (goLineup)', 'goLineup')
    .addItem('3. Sync Calendars (goSync)', 'Engine.runMasterSync')
    .addSeparator()
    .addItem('System Health Check', 'goHealthCheck')
    .addToUi();
}


/**
 * HELPER: Simple UI jump to the Audit_Log sheet
 */
function openAuditLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Audit_Log");
  if (sheet) {
    ss.setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert("Audit Log not found.");
  }
}

/**
 * REPLACES aggregateToMasterLog
 * This is your Phase 1 & 3 "Master Hub" script.
 */
function masterAggregatorSync() {
  // 1. Sync Lineup data to Log (Phase 1)
  syncLineupToCrewLog(); 
  
  // 2. Sync Performance Space data to Log (Phase 4)
  syncPerformanceSpacesToLog(); 
  
  // 3. Sync Calls data to Log (Phase 3)
  syncCallsToCrewLog(); 
  
  // 4. Update the Snapshot for Phase 5 comparison
  updateLogSnapshot();
  
  postToExecutionLog("Master Aggregation Complete. All sources synced to Log.","SYSTEM");
}
