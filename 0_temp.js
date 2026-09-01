function test_MirrorVenues() {
  console.info("--- START MIRROR VENUES TEST ---");
  
  // 1. Boot up the engine (forceMirror bypasses the Mode_Config gate for this manual run)
  const ctx = Engine.getContext({ runtime: { forceMirror: true } });
  console.info(`Context loaded. Found ${ctx.calendars.length} calendars to poll.`);
  
  // 2. Run Phase 1
  try {
    Engine.Sync.mirrorVenues(ctx);
    console.info("mirrorVenues execution finished without crashing.");
    
    // 3. Verify Output
    const sheetName = ctx.getRole("VENUECAL");
    const venueSheet = ctx.ss.getSheetByName(sheetName);
    const rowCount = venueSheet.getLastRow() - 1; // Subtract header
    console.info(`Venue_Cal_Log now contains ${rowCount} synced events.`);
    
  } catch(e) {
    console.error("Error during mirrorVenues: " + e.message);
  }
  
  console.info("--- END MIRROR VENUES TEST ---");
}
/**
 * Run this to see exactly what the Script "thinks" your setup looks like.
 */
function test_DiagnosticDump() {
  try {
    const ctx = Engine.getContext();
    
    console.log("--- CONFIG CHECK ---");
    console.log("Current Mode: " + ctx.config.mode);
    console.log("Sync Window: " + ctx.config.syncWindow.startDays + " to " + ctx.config.syncWindow.endDays);

    console.log("--- SHEET MAPPING CHECK ---");
    const testSheet = "Lineup";
    if (ctx.sheets[testSheet]) {
      console.log(`Sheet: ${testSheet}`);
      console.log(`ID Key: ${ctx.sheets[testSheet].settings.idKey}`);
      console.log(`Venue Col Index: ${ctx.sheets[testSheet].map.Venue.index}`);
    } else {
      console.error("Lineup sheet not found in settings!");
    }

    // This is the most important part for your "Bypass" logic
    console.log("--- STATUS BEHAVIOR CHECK ---");
    console.log("Behavior for 'Bypassed': " + ctx.status["Bypassed"].behavior);

    console.log("--- START LOOKUP DIAGNOSTIC ---");
    console.info("Checking for Lookup in ctx.sheets: " + (ctx.sheets["Lookup"] ? "FOUND" : "MISSING"));
    console.info("Registered Roles: " + JSON.stringify(ctx.roles));
  if (!ctx.lookup || !ctx.lookup.lists) {
    console.error("Lookups or Lists object is missing from ctx!");
    return;
  }

  // 1. Log All Available Lists (Health Check)
  console.log("Available Lookup Keys:", Object.keys(ctx.lookup.lists));

  // 2. Specific requested logs
  // Note: Check Map_Registry to see if 'Crew' is mapped to fieldName 'staff' or 'Crew'
  const staffList = ctx.lookup.lists["CrewStaff"] || ctx.lookup.lists["Staff"] || ctx.lookup.lists["Crew"];
  console.log("Staff/Crew Lookup:", staffList);
  
  console.log("CallType Lookup:", ctx.lookup.lists["CallType"]);

  // 3. Detailed Iteration (Optional but helpful for debugging)
  for (let listName in ctx.lookup.lists) {
    const items = ctx.lookup.lists[listName];
    console.log(`List: ${listName} | Count: ${items.length} | Preview: ${items.slice(0, 3).join(", ")}...`);
  }

  console.log("--- END LOOKUP DIAGNOSTIC ---");

  } catch (e) {
    console.error("Context Construction Failed: " + e.message);
    console.error(e.stack);
  }
}

/**
 * Diagnostic test for Status Color Provider (Issue #22)
 */
function test_StatusColorProvider() {
  console.info("--- START STATUS COLOR PROVIDER TEST ---");
  try {
    const ctx = Engine.getContext();
    
    // 1. Test Engine.Status.getAllColors
    const allColors = Engine.Status.getAllColors(ctx);
    console.info("Registered status colors count:", Object.keys(allColors).length);
    console.info("Status color map preview:", JSON.stringify(allColors, null, 2));
    
    // 2. Test Engine.Status.getColor with known status
    const syncedColor = Engine.Status.getColor(ctx, "Synced");
    console.info("Color for 'Synced':", syncedColor);
    
    // 3. Test fallback for unknown status
    const fallbackColor = Engine.Status.getColor(ctx, "NonExistentStatus", "#custom");
    console.info("Fallback color for 'NonExistentStatus':", fallbackColor);
    
    // 4. Test SL.ColorProvider bridge
    if (typeof SL !== "undefined" && typeof SL.ColorProvider === "function") {
      const slSynced = SL.ColorProvider("Synced", ctx);
      console.info("SL.ColorProvider('Synced') output:", slSynced);
    }
    
    console.info("--- STATUS COLOR PROVIDER TEST COMPLETE ---");
  } catch (e) {
    console.error("Error during test_StatusColorProvider: " + e.message);
    console.error(e.stack);
  }
}

/**
 * Non-mutating contract check for shared normalization and Engine.IO.compare.
 */
function test_NormalizationAndCompare() {
  const ctx = Engine.getContext();
  const utils = Engine.getLibraryModule("Utils");
  const assert = function(condition, message) {
    if (!condition) throw new Error(message);
  };

  const folded = utils.normalize("  The\u2014Show \u200B Tonight  ", { collapse: true, fold: true });
  assert(folded === "the-show tonight", `Unexpected folded value: "${folded}"`);
  assert(utils.normalize("  The  Show  ") === "the  show", "Default normalization changed");

  const aliasComparison = Engine.IO.compare(ctx, {
    source: { EventName: "The\u2014Show \u200B Tonight" },
    destination: { Title: "the-show tonight" },
    fields: ["EventName"],
    fieldAliases: { EventName: "Title" },
    identifier: "NORMALIZE_ALIAS"
  });
  assert(aliasComparison.equal, "Folded alias comparison should be equal");

  const arrayComparison = Engine.IO.compare(ctx, {
    source: ["The Show", new Date("2025-08-01T12:00:00Z")],
    destination: ["the show", new Date("2026-08-01T12:00:00Z")],
    sourceMap: { EventName: 0, Opening: 1 },
    destMap: { Title: 0, Opening: 1 },
    fields: ["EventName", "Opening"],
    fieldAliases: { EventName: "Title" },
    comparisonModes: { Opening: "date" },
    identifier: "ARRAY_DATE_YEAR"
  });
  assert(!arrayComparison.equal && arrayComparison.changed.length === 1 && arrayComparison.changed[0].field === "Opening", "Different years must be detected");

  console.info("Normalization and compare diagnostics passed.");
  return { folded: folded, aliasComparison: aliasComparison, arrayComparison: arrayComparison };
}

function previewMapRegistryRepair(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName("Map_Registry");
  const data = registrySheet.getDataRange().getValues();
  const headers = data[0];
  const colSheetName = headers.indexOf("Sheet Name");
  const colFieldName = headers.indexOf("Field Name");
  const colIndex = headers.indexOf("Column Index");
  const colDisplayName = headers.indexOf("Header DisplayName");
  const colNotes = headers.indexOf("Notes");

  const registryEntries = data.slice(1)
    .filter(row => row[colSheetName] === sheetName)
    .map(row => ({
      fieldName: String(row[colFieldName] || "").trim(),
      displayName: String(row[colDisplayName] || "").trim(),
      notes: String(row[colNotes] || ""),
      index: Number(row[colIndex])
    }));

  const targetSheet = ss.getSheetByName(sheetName);
  const physicalHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];

  const diff = Engine.Maintenance._diffHeaders(physicalHeaders, registryEntries);
  console.log(`Would add ${diff.newPhysical.length} new row(s):`, JSON.stringify(diff.newPhysical));
  console.log(`Would flag ${diff.staleRegistry.length} stale row(s):`, JSON.stringify(diff.staleRegistry.map(e => e.fieldName)));
  console.log(`${diff.duplicateEntries.length} duplicate entries found:`, JSON.stringify(diff.duplicateEntries.map(d => d.entry.fieldName)));
  return diff;
}

