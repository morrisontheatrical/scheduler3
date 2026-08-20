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