// ==============================================================================
// FILE: engine_sync.gs
// PURPOSE: Orchestrates the Pull, Reconcile, and Push operations for the system.
// ==============================================================================

var Engine = Engine || {};

Engine.Sync = {

  runMasterSync: function() {
    // 1. Get Context
  const ctx = Engine.Core.getContext();
  
  // 2. LOAD REGISTRY into Context (Crucial for Drift Detection)
  // This builds a map of { sourceID: { SyncHash, Location } }
  ctx.registry = {};
  const regData = ctx.sheets.ID_LOG.getDataRange().getValues();
  const regMap = ctx.maps.ID_LOG;
  for (let i = 1; i < regData.length; i++) {
    const sId = regData[i][regMap.UniqueID];
    if (sId) {
      ctx.registry[sId] = {
        SyncHash: regData[i][regMap.SyncHash],
        Location: regData[i][regMap.SheetLocation]
      };
    }
  }

  Engine.Log.write(ctx, { stage: "SYNC_START", details: "Initiating Master Sync" });

  try {
    // Phase 1: Mirror Building Reality
    this.mirrorVenues(ctx);

    // Phase 2: Compare Intent to Reality
    this.reconcileLogs(ctx);

    // Phase 3: Push Intent to Calendar
    this.syncCrewCalendar(ctx);

    Engine.Log.write(ctx, { stage: "SYNC_COMPLETE", details: "All phases finished." });
  } catch (e) {
    Engine.Log.write(ctx, { stage: "SYNC_ERROR", type: "ERROR", details: e.message });
  }
  },
/**
   * PHASE 1: MIRROR VENUES
   * Loops through Calendars.csv settings, uses Engine.Calendar to fetch data, 
   * and batch writes to Venue_Cal_Log.
   */
  mirrorVenues: function(ctx) {
    const role = "VENUECAL";
    
    // 1. Get the Sheet Name from our registered roles

    const sheetName = ctx.getRole(role); 
    const sheet = ctx.ss.getSheetByName(sheetName);

    if (!sheet) { //or sheet is null
      Engine.Log.error(ctx, "SYNC", `Sheet for role ${role} ("${sheetName}") not found.`);
      return;
    }

    let allVenueEvents = [];

    // 2. The Loop (Calling our Global Bridge)
    ctx.calendars.forEach(function(cal) {
      if (cal.venueName.includes("Draft")) return;
      try {
        const events = global_pullCalendarEvents(ctx, cal);
        if (events && events.length > 0) {
          allVenueEvents = allVenueEvents.concat(events);
        }
      } catch (e) {
        Engine.Log.error(ctx, "PULL", `Failed ${cal.venueName}: ${e.message}`);
      }
    });

    // 3. The Write
    if (allVenueEvents.length > 0) {
      // Clear old data safely
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
      }
      
      // batchWrite handles the rest
      batchWrite(role, allVenueEvents, ctx);
      Engine.Log.info(ctx, "PULL", `Successfully mirrored ${allVenueEvents.length} events.`);
    }
  },
  /**
   * RECONCILE: Compares Crew_Calendar_Log against Venue_Cal_Log.
   * Identifies Venue Adoptions and flags Location Conflicts.
   */
 reconcileLogs: function(ctx) {
    const crewEvents = scanSheet('CREWCAL', ctx);
    const venueEvents = scanSheet('VENUECAL', ctx);
    const venueMap = buildRealityMap(venueEvents); 
    const selectedLogs = ctx.mode.logTypes || ""; // e.g. "CONFLICT, ADOPT"

    crewEvents.forEach(crewRow => {
      const behavior = ctx.lookup.statusBehavior[crewRow.SyncStatus]; 
      if (behavior === "LOCKED" || behavior === "BYPASS") return;

      const key = `${new Date(crewRow.Date).toISOString()}|${crewRow.Location}`;
      const physicalMatches = venueMap[key] || [];

      // 1. CONFLICT CHECK
      const trueConflicts = physicalMatches.filter(v => v.EventID !== crewRow.EventID);
      if (trueConflicts.length > 0) {
        Engine.Status.apply(ctx, "CREWCAL", null, "Location Conflict", {
          details: `Room booked by: ${trueConflicts[0].Title}`,
          targetObj: crewRow
        });
        
        // Conditional Logging based on Mode
        if (selectedLogs.includes("CONFLICT")) {
          Engine.Log.write(ctx, { 
            type: "CONFLICT_VENUE", 
            details: `${crewRow.Title} conflicts with ${trueConflicts[0].Title}` 
          });
        }
        return;
      }

      // 2. ADOPTION CHECK
      if (!crewRow.EventID && physicalMatches.length > 0) {
        const match = physicalMatches.find(v => v.Title.trim() === crewRow.Title.trim());
        if (match) {
          Engine.Status.apply(ctx, "CREWCAL", null, "Manual Review", {
            details: `Possible Adoption: ${match.EventID}`,
            targetObj: crewRow
          });
          
          if (selectedLogs.includes("ADOPT")) {
            Engine.Log.write(ctx, { type: "RECONCILE_ADOPT", details: `Match found for ${crewRow.Title}` });
          }
        }
      }
    });

    // Use patchRows to update only the modified records
    patchRows('CREWCAL', crewEvents, ctx);
  },
  syncCrewCalendar: function(ctx) {
  const role = "CREWCAL";
  const crewEvents = scanSheet(role, ctx);
  const selectedLogs = ctx.mode.logTypes || "";
  const canWrite = ctx.mode.writeToCalendar;

  // We need the Target Calendar ID (usually defined in Sheet_Settings or ControlPanel)
  const targetCalId = ctx.settings.ControlPanel["Crew Draft Calendar ID"];
  if (!targetCalId) {
    Engine.Log.error(ctx, "PUSH", "No Target Calendar ID found in ControlPanel.");
    return;
  }

  crewEvents.forEach(crewRow => {
    // 1. BEHAVIOR CHECK
    const behavior = ctx.lookup.statusBehavior[crewRow.SyncStatus];
    if (behavior === "LOCKED" || behavior === "BYPASS") return;

    // 2. ACTION: DELETE
    if (crewRow.SyncStatus === "To Delete on calendar") {
      if (crewRow.EventID) {
        if (canWrite) {
          Engine.Calendar.deleteEvent(targetCalId, crewRow.EventID);
          Engine.Status.apply(ctx, role, null, "Deleted by Calendar", { targetObj: crewRow });
          Engine.IDService.upsert(ctx, { id: crewRow.sourceID, status: "Deleted", details: "Removed from Cal" });
        }
        if (selectedLogs.includes("CAL_CLEANUP")) {
          Engine.Log.write(ctx, { type: "CAL_CLEANUP", details: `Deleted event: ${crewRow.Title}` });
        }
      }
      return;
    }

    // 3. ACTION: CREATE (No EventID exists)
    if (!crewRow.EventID || crewRow.EventID === "") {
      if (canWrite) {
        const newEventId = Engine.Calendar.createEvent(targetCalId, crewRow);
        crewRow.EventID = newEventId;
        Engine.Status.apply(ctx, role, null, "Pushed to Calendar", { targetObj: crewRow });
        
        // Register the new link in the ID Registry
        Engine.IDService.upsert(ctx, { 
          id: crewRow.sourceID, 
          details: `Created Cal Event: ${newEventId}`,
          location: `${ctx.sheets[role].getName()}!R${crewRow._rowNum}`
        });
      }
      return;
    }

    // 4. ACTION: UPDATE (EventID exists, check for Drift)
    // We compare the current row's hash against the stored hash in the ID Registry
    const registryEntry = ctx.registry[crewRow.sourceID]; // Assuming ctx loaded registry
    if (registryEntry && registryEntry.SyncHash !== crewRow.SyncHash) {
      if (canWrite) {
        Engine.Calendar.updateEvent(targetCalId, crewRow.EventID, crewRow);
        Engine.Status.apply(ctx, role, null, "Calendar Log Updated", { targetObj: crewRow });
      }
      
      if (selectedLogs.includes("PUSH_CAL")) {
        Engine.Log.write(ctx, { type: "PUSH_CAL", details: `Updated ${crewRow.Title} due to data drift.` });
      }
    }
  });

  // Save changes (Status, EventIDs, Hashes) back to the sheet
  patchRows(role, crewEvents, ctx);
}
};
