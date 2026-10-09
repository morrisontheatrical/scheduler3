function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('🧪 Dev / Test')
    .addSubMenu(ui.createMenu('Diagnostics')
      .addItem('Diagnostic Dump', 'test_DiagnosticDump')
      .addItem('Test Normalization and Compare', 'test_NormalizationAndCompare')
      .addItem('Test Theatrical Date Parsing', 'test_TheatricalDateParsing')
      .addItem('Lookup List Diagnostics', 'test_LookupListDiagnostics')
      .addItem('Run Health Check', 'goHealthCheck')
      .addItem('Test Status Color Provider', 'test_StatusColorProvider')
      .addItem('Open Audit Log', 'openAuditLog'))
    .addSubMenu(ui.createMenu('Verification')
      .addItem('Verify import vs Parent Lineup', 'goVerifyImportToParent')
      .addItem('Verify Parent Lineup vs Lineup', 'goVerifyParentToLineup')
      .addItem('Reconcile Logs (Lineup / Crew / Venue)', 'test_ReconcileLogs')
      .addItem('Compare Draft Calendar vs Crew Log', 'test_CompareDraftCalendar'))
    .addSubMenu(ui.createMenu('Maintenance')
      .addItem('Repair Map Registry', 'repairMapRegistry')
      .addItem('Read Sheet Headers into Registry', 'readHeadersToRegistry')
      .addItem('Repair Headers from Registry', 'repairHeadersMenu')
      .addItem('Write Headers from Registry', 'writeHeadersFromRegistryMenu')
      .addItem('Repair Blank Hashes', 'repairBlankHashes')
      .addItem('Refresh Dropdowns', 'test_RefreshDropdowns')
      .addItem('Resync Status Colors', 'resyncStatusColors')
      .addItem('Refresh All Links & Colors', 'refreshAllLinks')
      .addItem('Reset Headers', 'resetHeadersMenu'))
    .addSubMenu(ui.createMenu('Decision Review')
      .addItem('Open Decision Log', 'openDecisionLog')
      .addItem('Validate Decision Log Schema', 'ensureDecisionLogSchema')
      .addItem('List Pending Decisions', 'listPendingDecisions')
      .addItem('Refresh Decision Row Links', 'refreshDecisionLinks')
      .addItem('Generate Parent Duplicate Suggestions', 'generateParentDuplicateSuggestions')
      .addItem('Refresh Stale Parent Duplicate Reviews', 'refreshParentDuplicateDecisions')
      .addItem('Refresh Resolved Parent-Only Reviews', 'refreshParentOnlyDecisions')
      .addItem('Preview Approved Deletes', 'previewApprovedDeletes')
      .addItem('Preview Lineup Delete Pending', 'previewLineupDeletePending')
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
    //.addItem('Custom Runtime', 'goCustomRuntime') TO BE IMPLEMENTED
    .addToUi();

    ui.createMenu('Calendar')
      .addItem('Sync All Calendars', 'goSync') //by mode, pull reconcile push
      .addItem('Verify All Calendars', 'verifyAllCalendars') //log/decide only
      .addSeparator()
      .addItem('Pull Venue Calendars', 'pullVenueCalendars')
      .addItem('Pull Draft Season Calendar', 'pullDraftSeasonCalendar')
      .addItem('Pull Crew Calendar', 'pullCrewCalendar')
      .addSeparator()
      .addItem('Verify Venue Calendars', 'verifyVenueCalendars')
      .addItem('Verify Draft Season Calendar', 'verifyDraftSeasonCalendar')
      .addItem('Verify Crew Calendar', 'verifyCrewCalendar')
      .addSeparator()  
      .addItem('Push Draft Season Calendar', 'pushDraftSeasonCalendar')
      .addItem('Push Crew Calendar', 'pushCrewCalendar')
      .addSeparator()
      .addItem('Refresh Adoption Suggestions', 'refreshAdoptionSuggestions')
      .addItem('Accept Adoption Suggestions', 'acceptAdoptionSuggestions')
      .addSubMenu(ui.createMenu('Wipe Calendars') //Dev only, will remove this menu in production
        .addItem('Wipe Draft Season Calendar', 'wipeDraftSeasonCalendar')
        .addItem('Wipe Crew Calendar', 'wipeCrewCalendar')
      )
      .addToUi();
      
      ui.createMenu('Sheet')
        .addItem('Refresh Links & Colors (this sheet)', 'refreshActiveSheetLinks')
        .addItem('Reset Headers', 'resetHeadersMenu') //just the active sheet
        .addSubMenu(ui.createMenu('Open Sheet')
          .addSubMenu(ui.createMenu('Active Season')
            .addItem('Open Import', 'openImport')
            .addItem('Open Parent Lineup', 'openParentLineup')
            .addItem('Open Lineup', 'openLineup')
          )
          .addSubMenu(ui.createMenu('Draft Season')
            .addItem('Open Draft Import', 'openDraftImport')
            .addItem('Open Draft Parent', 'openDraftParent')
            .addItem('Open Draft Lineup', 'openDraftLineup')
          )
          .addItem('Open Calls', 'openCalls')
          .addSubMenu(ui.createMenu('Logs')
            .addItem('Open Decision Log', 'openDecisionLog')
            .addItem('Open Audit Log', 'openAuditLog')
            .addItem('Open ID Log', 'openIDLog')
            
          )
          .addSubMenu(ui.createMenu('Calendar Logs')
            .addItem('Open Crew Calendar Log', 'openCrewCalendarLog')
            .addItem('Open Venue Calendar Log', 'openVenueCalendarLog')
            .addItem('Open Draft Season Log', 'openDraftSeasonLog')
          )
          .addSubMenu(ui.createMenu('Settings')
          .addItem('Open Calendars', 'openCalendars')
          .addItem('Open Control Panel', 'openControlPanel')
          .addItem('Open Sheet Settings', 'openSheetSettings')
          .addItem('Open Map Registry', 'openMapRegistry')
          .addItem('Open Mode Config', 'openModeConfig')
          .addItem('Open Lookup', 'openLookup')
          .addItem('Open Status', 'openStatus')
          .addItem('Open Ref', 'openRef')
          .addItem('Open FieldNames', 'openFieldNames')
        ))
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

function verifyAllCalendars() {
  const ctx = Engine.getContext();
  return Engine.Sync.reconcileLogs(ctx);
}

function pullVenueCalendars() {
  const ctx = Engine.getContext({ runtime: { forceMirror: true } });
  return Engine.Sync.mirrorVenues(ctx);
}

function verifyDraftSeasonCalendar() {
  const ctx = Engine.getContext();
  return Engine.Sync.compareDraftCalendar(ctx);
}

function pushCrewCalendar() {
  const ctx = Engine.getContext();
  return Engine.Sync.syncCrewCalendar(ctx);
}

function pullDraftSeasonCalendar() {
  showCalendarActionUnavailable('Pull Draft Season Calendar');
}

function pullCrewCalendar() {
  showCalendarActionUnavailable('Pull Crew Calendar');
}

function verifyVenueCalendars() {
  showCalendarActionUnavailable('Verify Venue Calendars');
}

function verifyCrewCalendar() {
  showCalendarActionUnavailable('Verify Crew Calendar');
}

function pushDraftSeasonCalendar() {
  showCalendarActionUnavailable('Push Draft Season Calendar');
}

function refreshAdoptionSuggestions() {
  const ui = SpreadsheetApp.getUi();
  const ctx = Engine.getContext();
  Engine.Sync.reconcileLogs(ctx);
  const preview = Engine.Sync.previewAdoptions(ctx);
  const lines = preview.proposals.slice(0, 25).map(p => `• ${p.row.Title} (${new Date(p.row.Date).toDateString()})  →  ${p.venueTitle}`);
  if (preview.proposals.length > 25) lines.push(`…and ${preview.proposals.length - 25} more`);
  ui.alert(
    `${preview.proposals.length} adoption suggestion(s), ${preview.skipped.length} skipped`,
    (lines.join("\n") || "Nothing to adopt.") + "\n\nNo changes made. Use Accept Adoption Suggestions to apply.",
    ui.ButtonSet.OK
  );
  return preview.proposals.length;
}

function acceptAdoptionSuggestions() {
  const ui = SpreadsheetApp.getUi();
  const ctx = Engine.getContext();
  const preview = Engine.Sync.previewAdoptions(ctx);
  if (preview.proposals.length === 0) {
    ui.alert("No adoption suggestions to accept. Run Refresh Adoption Suggestions first.");
    return;
  }
  const response = ui.alert(
    "Accept adoptions?",
    `Link ${preview.proposals.length} Crew Calendar Log row(s) to their existing venue calendar events and mark them "Adopted from Venue"? This changes the sheet only, not any calendar.`,
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;
  const result = Engine.Sync.acceptAdoptions(ctx);
  ui.alert(`Adopted ${result.adopted} row(s); skipped ${result.skipped}.`);
  return result;
}

function wipeDraftSeasonCalendar() {
  return confirmAndWipeCalendar('draft_season', 'Draft Season Calendar');
}

function wipeCrewCalendar() {
  return confirmAndWipeCalendar('crew_calls', 'Crew Calendar');
}

/**
 * Dev-only: previews, confirms, then wipes the calendar with the given CalendarRole.
 */
function confirmAndWipeCalendar(calendarRole, label) {
  const ui = SpreadsheetApp.getUi();
  const ctx = Engine.getContext();
  const preview = Engine.Calendar.previewWipe(ctx, calendarRole);

  if (!preview.ok) {
    ui.alert(`Cannot wipe ${label}`, preview.reason, ui.ButtonSet.OK);
    return;
  }
  if (preview.events.length === 0) {
    ui.alert(`No events found on "${preview.cal.getName()}" in the sync window to delete.`);
    return;
  }

  const response = ui.alert(
    'Warning!',
    `Are you sure you want to delete ALL ${preview.events.length} events from "${preview.cal.getName()}" ` +
    `between ${preview.range.start.toDateString()} and ${preview.range.end.toDateString()}? This cannot be undone.`,
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) {
    ui.alert("Operation cancelled.");
    return;
  }

  const result = Engine.Calendar.wipeCalendar(ctx, calendarRole);
  ui.alert(`${result.deleted} events removed from ${result.calendarName || label}` +
    (result.failed ? ` (${result.failed} could not be deleted; see Audit_Log).` : "."));
  return result;
}

function showCalendarActionUnavailable(action) {
  SpreadsheetApp.getUi().alert(
    `${action} is not implemented yet. No calendar or sheet changes were made.`
  );
}

function test_LookupListDiagnostics() {
  const ctx = Engine.getContext();
  return Engine.Maintenance.diagnoseLookupLists(ctx);
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

/**
 * Menu navigation. Targets are Sheet_Settings role codes (e.g. "LINEUPDRAFT"), or a base name
 * ("IMPORT", "PARENT", "LINEUP") that resolves through the active TargetSeason.
 * Hidden sheets are shown before activating.
 */
function openSheet(target) {
  const ctx = Engine.getContext();
  const ui = SpreadsheetApp.getUi();
  const wanted = String(target || "").trim();
  const role = ctx.roles[wanted] ? wanted : Engine.Roles.resolve(ctx, wanted);
  const sheet = role && Engine.getSheetByRole(ctx, role);
  if (!sheet) {
    ui.alert(`Sheet for "${wanted}" was not found. Check its Sheet Role in Sheet_Settings.`);
    return null;
  }
  if (sheet.isSheetHidden()) sheet.showSheet();
  ctx.ss.setActiveSheet(sheet);
  return sheet;
}

function openImport() { return openSheet("IMPORT"); }
function openParentLineup() { return openSheet("PARENT"); }
function openLineup() { return openSheet("LINEUP"); }
function openDraftImport() { return openSheet("IMPORTDRAFT"); }
function openDraftParent() { return openSheet("PARENTDRAFT"); }
function openDraftLineup() { return openSheet("LINEUPDRAFT"); }
function openCalls() { return openSheet("CALLS"); }
function openDecisionLog() { return openSheet("DECISIONS"); }
function openAuditLog() { return openSheet("AUDIT"); }
function openIDLog() { return openSheet("ID_LOG"); }
function openCrewCalendarLog() { return openSheet("CREWCAL"); }
function openVenueCalendarLog() { return openSheet("VENUECAL"); }
function openDraftSeasonLog() { return openSheet("DRAFTCAL"); }
function openCalendars() { return openSheet("CALENDARS"); }
function openControlPanel() { return openSheet("CONTROL"); }
function openSheetSettings() { return openSheet("SETTINGS"); }
function openMapRegistry() { return openSheet("REGISTRY"); }
function openModeConfig() { return openSheet("MODES"); }
function openLookup() { return openSheet("LOOKUP"); }
function openStatus() { return openSheet("STATUS"); }
function openRef() { return openSheet("REFRULES"); }
function openFieldNames() { return openSheet("FIELDS"); }
