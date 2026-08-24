function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🧪 Dev / Test')
    .addItem('Diagnostic Dump', 'test_DiagnosticDump')
    .addItem('Mirror Venues Test', 'test_MirrorVenues')
    .addItem('Draft Mode Sheet-Only Test', 'test_DraftModeSheetOnly')
    .addItem('Live Mode Sheet-Only Test', 'test_LiveModeSheetOnly')
    .addItem('Custom Runtime Sheet-Only Test', 'test_CustomRuntimeSheetOnly')
    .addItem('Reconcile Logs Test', 'test_ReconcileLogs')
    .addItem('Crew Calendar Sync Test', 'test_SyncCrewCalendar')
    .addItem('Compare Draft Calendar vs Crew Log', 'test_CompareDraftCalendar')
    .addItem('Sync Lineup to Log Test', 'test_SyncLineupToLog')
    .addItem('Verify import vs Parent Lineup', 'goVerifyImportToParent')
    .addItem('Verify Parent Lineup vs Lineup', 'goVerifyParentToLineup')
    .addItem('Sync ID Registry Test', 'test_SyncIDRegistry')
    .addItem('Refresh Dropdowns Test', 'test_RefreshDropdowns')
    .addItem('Run Health Check', 'goHealthCheck')
    .addItem('Open Audit Log', 'openAuditLog')
    .addSeparator()
    .addItem('Repair Map Registry', 'repairMapRegistry')
    .addItem('Repair Blank Hashes', 'repairBlankHashes')
    .addItem('Reset Headers', 'resetHeadersMenu')
    .addToUi();

  ui.createMenu('📅 Scheduler')
    .addItem('1. Ingest Season', 'goParent')
    .addItem('2. Explode Dates', 'goLineup')
    .addItem('3. Sync Lineup to Crew Log', 'goCrewLog')
    .addItem('4. Sync Calendars', 'goSync')
    .addSeparator()
    .addItem('Verify import vs Parent Lineup', 'goVerifyImportToParent')
    .addItem('Verify Parent Lineup vs Lineup', 'goVerifyParentToLineup')
    .addSeparator()
    .addItem('View Audit Log', 'openAuditLog')
    .addToUi();
}

function goSync() {
  if (Engine && Engine.Sync && Engine.Sync.runMasterSync) {
    Engine.Sync.runMasterSync();
    return;
  }

  SpreadsheetApp.getUi().alert('Sync engine is not available.');
}

function test_ReconcileLogs() {
  const ctx = Engine.getContext();
  return Engine.Sync.reconcileLogs(ctx);
}

function test_SyncCrewCalendar() {
  const ctx = Engine.getContext({ runtime: { allowCalendarWrites: false } });
  return Engine.Sync.syncCrewCalendar(ctx);
}

function test_CompareDraftCalendar() {
  const ctx = Engine.getContext();
  return Engine.Sync.compareDraftCalendar(ctx);
}

function test_SyncLineupToLog() {
  const ctx = Engine.getContext();
  return Engine.Ingest.syncLineupToLog(ctx);
}

function test_DraftModeSheetOnly() {
  return Engine.Sync.runMasterSync({
    modeName: "Draft 26-27",
    runtime: { allowCalendarWrites: false }
  });
}

function test_LiveModeSheetOnly() {
  return Engine.Sync.runMasterSync({
    modeName: "Live 26-27",
    runtime: { allowCalendarWrites: false }
  });
}

function test_CustomRuntimeSheetOnly() {
  return Engine.Sync.runMasterSync({
    runtime: {
      allowCalendarWrites: false,
      skipPush: true
    }
  });
}

function test_SyncIDRegistry() {
  const ctx = Engine.getContext();
  return Engine.IDService.syncAll(ctx);
}

function test_RefreshDropdowns() {
  const ctx = Engine.getContext();
  return Engine.Maintenance.applyDropdowns(ctx);
}

function goHealthCheck() {
  if (!Engine || !Engine.Maintenance || !Engine.Maintenance.runHealthCheck) {
    SpreadsheetApp.getUi().alert('Maintenance engine is not available.');
    return;
  }

  const reports = Engine.Maintenance.runHealthCheck();
  const msg = reports.join('\n');
  console.log(msg);

  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('System Health Check', msg, ui.ButtonSet.OK);
  } catch (error) {
    console.warn(`System Health Check completed without spreadsheet UI: ${error.message}`);
  }

  return reports;
}

function resetHeadersMenu() {
  const ctx = Engine.getContext();
  Engine.Maintenance.resetHeaders(ctx);
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

