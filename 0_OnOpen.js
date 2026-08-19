function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🧪 Dev / Test')
    .addItem('Diagnostic Dump', 'test_DiagnosticDump')
    .addItem('Mirror Venues Test', 'test_MirrorVenues')
    .addItem('Run Health Check', 'goHealthCheck')
    .addItem('Open Audit Log', 'openAuditLog')
    .addSeparator()
    .addItem('Repair Map Registry', 'repairMapRegistry')
    .addItem('Reset Headers', 'resetHeadersMenu')
    .addToUi();

  ui.createMenu('📅 Scheduler')
    .addItem('1. Ingest Season', 'goParent')
    .addItem('2. Explode Dates', 'goLineup')
    .addItem('3. Sync Calendars', 'goSync')
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

function goHealthCheck() {
  if (!Engine || !Engine.Maintenance || !Engine.Maintenance.runHealthCheck) {
    SpreadsheetApp.getUi().alert('Maintenance engine is not available.');
    return;
  }

  const reports = Engine.Maintenance.runHealthCheck();
  const msg = reports.join('\n');
  SpreadsheetApp.getUi().alert('System Health Check', msg, SpreadsheetApp.getUi().ButtonSet.OK);
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

