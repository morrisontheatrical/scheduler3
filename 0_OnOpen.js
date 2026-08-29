function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🧪 Dev / Test')
    .addSubMenu(ui.createMenu('Diagnostics')
      .addItem('Diagnostic Dump', 'test_DiagnosticDump')
      .addItem('Run Health Check', 'goHealthCheck')
      .addItem('Test Status Color Provider', 'test_StatusColorProvider')
      .addItem('Open Audit Log', 'openAuditLog'))
    .addSubMenu(ui.createMenu('Verification')
      .addItem('Verify import vs Parent Lineup', 'goVerifyImportToParent')
      .addItem('Verify Parent Lineup vs Lineup', 'goVerifyParentToLineup')
      .addItem('Compare Draft Calendar vs Crew Log', 'test_CompareDraftCalendar'))
    .addSubMenu(ui.createMenu('Maintenance')
      .addItem('Repair Map Registry', 'repairMapRegistry')
      .addItem('Read Sheet Headers into Registry', 'readHeadersToRegistry')
      .addItem('Repair Headers from Registry', 'repairHeadersMenu')
      .addItem('Write Headers from Registry', 'writeHeadersFromRegistryMenu')
      .addItem('Repair Blank Hashes', 'repairBlankHashes')
      .addItem('Refresh Dropdowns', 'test_RefreshDropdowns')
      .addItem('Reset Headers', 'resetHeadersMenu'))
    .addSubMenu(ui.createMenu('Decision Review')
      .addItem('Open Decision Log', 'openDecisionLog')
      .addItem('Validate Decision Log Schema', 'ensureDecisionLogSchema')
      .addItem('List Pending Decisions', 'listPendingDecisions')
      .addItem('Refresh Decision Row Links', 'refreshDecisionLinks')
      .addItem('Generate Parent Duplicate Suggestions', 'generateParentDuplicateSuggestions')
      .addItem('Refresh Stale Parent Duplicate Reviews', 'refreshParentDuplicateDecisions')
      .addItem('Refresh Resolved Parent-Only Reviews', 'refreshParentOnlyDecisions')
      .addItem('Apply Reviewed Decisions (Includes Merges)', 'applyPendingDecisions')
      .addItem('Archive Superseded Decisions', 'archiveSupersededDecisions'))
    .addSubMenu(ui.createMenu('Sync Tests')
      .addItem('Mirror Venues', 'test_MirrorVenues')
      .addItem('Reconcile Logs', 'test_ReconcileLogs')
      .addItem('Sync Lineup to Log', 'test_SyncLineupToLog')
      .addItem('Crew Calendar Sync', 'test_SyncCrewCalendar')
      .addItem('Sync ID Registry', 'test_SyncIDRegistry')
      .addItem('Draft Mode Sheet-Only', 'test_DraftModeSheetOnly')
      .addItem('Live Mode Sheet-Only', 'test_LiveModeSheetOnly')
      .addItem('Custom Runtime Sheet-Only', 'test_CustomRuntimeSheetOnly'))
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
    Engine.Sync.runMasterSync({ runtime: { applyDecisions: true } });
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

