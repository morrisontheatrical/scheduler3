// ==============================================================================
// FILE: engine_sync.gs
// PURPOSE: Orchestrates the Pull, Reconcile, and Push operations for the system.
// ==============================================================================

var Engine = Engine || {};

Engine.Sync = {

  runMasterSync: function(options) {
    // 1. Get Context
    const ctx = Engine.getContext(options);
    const runtime = ctx.runtime || {};
  
    // 2. Log active mode at start
    const activeMode = ctx.mode && ctx.mode.mode ? ctx.mode.mode : "Unknown";
    const syncMode = ctx.mode && ctx.mode.syncMode ? ctx.mode.syncMode : "N/A";
    Engine.Log.write(ctx, { 
      stage: "SYS_INIT", 
      details: `Starting sync in mode: ${activeMode} (SyncMode: ${syncMode})`
    });
  
    // 3. LOAD REGISTRY into Context (Crucial for Drift Detection)
    // This builds a map of { sourceID: { SyncHash, Location } }
    ctx.registry = {};
    const regData = ctx.sheets.ID_LOG.getDataRange().getValues();
    const regMap = ctx.maps.ID_LOG;
    const uniqueIdCol = ctx.getCol("ID_LOG", "UniqueID");
    const syncHashCol = ctx.getCol("ID_LOG", "SyncHash");
    const sheetLocationCol = ctx.getCol("ID_LOG", "SheetLocation");
    for (let i = 1; i < regData.length; i++) {
      const sId = regData[i][uniqueIdCol];
      if (sId) {
        ctx.registry[sId] = {
          SyncHash: regData[i][syncHashCol],
          Location: regData[i][sheetLocationCol]
        };
      }
    }

    Engine.Log.write(ctx, { stage: "SYNC_START", details: "Initiating Master Sync" });

  try {
    // Phase 1: Mirror Building Reality
    if (!runtime.skipMirror) this.mirrorVenues(ctx);

    // Phase 2: Compare Intent to Reality
    if (!runtime.skipReconcile) this.reconcileLogs(ctx);

    // Phase 3: Push Intent to Calendar
    if (!runtime.skipPush) this.syncCrewCalendar(ctx);

    Engine.Log.write(ctx, { stage: "SYNC_COMPLETE", details: "All phases finished." });
  } catch (e) {
    Engine.Log.write(ctx, { stage: "SYNC_ERROR", type: "ERROR", details: e.message });
  }
  },
  _buildRealityMap: function(venueEvents) {
    const map = {};
    venueEvents.forEach(function(event) {
      if (!event.Date || !event.Location) return;
      const key = `${new Date(event.Date).toISOString()}|${event.Location}`;
      if (!map[key]) map[key] = [];
      map[key].push(event);
    });
    return map;
  },
/**
   * PHASE 1: MIRROR VENUES
   * Loops through Calendars.csv settings, uses Engine.Calendar to fetch data, 
   * and batch writes to Venue_Cal_Log.
   * Skipped if ctx.mode.useLiveVenueMirroring is false, unless ctx.runtime.forceMirror is true
   * (used for an explicit, on-demand "repopulate now" run regardless of the active mode).
   */
  mirrorVenues: function(ctx) {
    const shouldMirror = (ctx.runtime && ctx.runtime.forceMirror) || (ctx.mode && ctx.mode.useLiveVenueMirroring);
    
    if (!shouldMirror) {
      Engine.Log.info(ctx, "PULL", "Skipped venue mirror: mode has useLiveVenueMirroring = false");
      return;
    }

    const role = "VENUECAL";
    
    // 1. Get the Sheet Name from our registered roles

    const sheetName = ctx.getRole(role); 
    const sheet = ctx.ss.getSheetByName(sheetName);

    if (!sheet) { //or sheet is null
      Engine.Log.error(ctx, "SYNC", `Sheet for role ${role} ("${sheetName}") not found.`);
      return;
    }

    if (!ctx.calendars || ctx.calendars.length === 0) {
      Engine.Log.error(ctx, "PULL", "No calendars loaded from the 'Calendars' sheet. Check that it has rows with a CalendarID (col B) and Venue Name (col C).");
      return;
    }

    let allVenueEvents = [];
    let skippedAsDraft = 0;
    let attempted = 0;

    // 2. The Loop (Calling our Global Bridge)
    ctx.calendars.forEach(function(cal) {
      if (cal.venueName.includes("Draft")) { skippedAsDraft++; return; }
      attempted++;
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
    } else {
      // Surface the zero-result case instead of failing silently.
      Engine.Log.info(ctx, "PULL", `Mirror finished with 0 events. Polled ${attempted} venue calendar(s), skipped ${skippedAsDraft} as Draft. Verify Calendar IDs on the 'Calendars' sheet and that events exist within the sync window.`);
    }
  },
  /**
   * RECONCILE: Compares Crew_Calendar_Log against Venue_Cal_Log.
   * Identifies Venue Adoptions and flags Location Conflicts.
   */
 reconcileLogs: function(ctx) {
    const crewEvents = scanSheet('CREWCAL', ctx);
    const venueEvents = scanSheet('VENUECAL', ctx);
    Engine.Log.write(ctx, {
      stage: "RECONCILE",
      type: "RECONCILE_START",
      details: `Reconciling ${crewEvents.length} crew rows against ${venueEvents.length} venue rows.`
    });
    const venueMap = this._buildRealityMap(venueEvents); 
    const allowedLogTypes = (ctx.mode && ctx.mode.allowedLogTypes) || [];

    crewEvents.forEach(crewRow => {
      const statusDef = ctx.status[crewRow.SyncStatus];
      const behaviors = statusDef ? Engine.parseModeList(statusDef.behavior) : [];
      if (behaviors.includes("LOCKED") || behaviors.includes("BYPASS")) return;

      const key = `${new Date(crewRow.Date).toISOString()}|${crewRow.Location}`;
      const physicalMatches = venueMap[key] || [];

      // 1. CONFLICT CHECK
      // TODO: remove eventID fallback once Venue_Cal_Log's Map_Registry field is capitalized.
      const trueConflicts = physicalMatches.filter(v => (v.EventID || v.eventID) !== crewRow.EventID);
      if (trueConflicts.length > 0) {
        Engine.Status.apply(ctx, "CREWCAL", null, "Location Conflict", {
          details: `Room booked by: ${trueConflicts[0].Title}`,
          targetObj: crewRow
        });
        
        // Conditional Logging based on Mode
        if (allowedLogTypes.includes("CONFLICT_VENUE")) {
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
          
          if (allowedLogTypes.includes("RECONCILE_ADOPT")) {
            Engine.Log.write(ctx, { type: "RECONCILE_ADOPT", details: `Match found for ${crewRow.Title}` });
          }
        }
      }
    });

    // Use patchRows to update only the modified records
    patchRows('CREWCAL', crewEvents, ctx);
    Engine.Log.write(ctx, {
      stage: "RECONCILE",
      type: "RECONCILE_COMPLETE",
      details: `Reconciliation complete. Checked ${crewEvents.length} crew rows.`
    });
  },
  syncCrewCalendar: function(ctx) {
  const role = "CREWCAL";
  const crewEvents = scanSheet(role, ctx);
  const allowedLogTypes = (ctx.mode && ctx.mode.allowedLogTypes) || [];
  const canWrite = ctx.runtime && ctx.runtime.allowCalendarWrites !== undefined
    ? Boolean(ctx.runtime.allowCalendarWrites)
    : Boolean(ctx.mode && ctx.mode.writeToCalendar);

  // We need the Target Calendar ID (usually defined in Sheet_Settings or ControlPanel)
  const targetCalId = ctx.settings.ControlPanel["Crew Draft Calendar ID"];
  if (!targetCalId) {
    Engine.Log.error(ctx, "PUSH", "No Target Calendar ID found in ControlPanel.");
    return;
  }

  crewEvents.forEach(crewRow => {
    // 1. BEHAVIOR CHECK
    const statusDef = ctx.status[crewRow.SyncStatus];
    const behaviors = statusDef ? Engine.parseModeList(statusDef.behavior) : [];
    if (behaviors.includes("LOCKED") || behaviors.includes("BYPASS")) return;

    // 2. ACTION: DELETE
    if (crewRow.SyncStatus === "To Delete on calendar") {
      if (crewRow.EventID) {
        if (canWrite) {
          Engine.Calendar.deleteEvent(targetCalId, crewRow.EventID);
          Engine.Status.apply(ctx, role, null, "Deleted by Calendar", { targetObj: crewRow });
          Engine.IDService.upsert(ctx, { id: crewRow.UUID, status: "Deleted", details: "Removed from Cal" });
        }
        if (allowedLogTypes.includes("CAL_CLEANUP")) {
          Engine.Log.write(ctx, { type: "CAL_CLEANUP", details: `Deleted event: ${crewRow.Title}` });
        }
      }
      return;
    }

    // 3. ACTION: CREATE (No EventID exists)
    if (!crewRow.EventID || crewRow.EventID === "") {
      if (canWrite) {
        const newEventId = Engine.Calendar.createEvent(targetCalId, crewRow, ctx);
        crewRow.EventID = newEventId;
        Engine.Status.apply(ctx, role, null, "Pushed to Calendar", { targetObj: crewRow });
        
        // Register the new link in the ID Registry
        Engine.IDService.upsert(ctx, { 
          id: crewRow.UUID,
          details: `Created Cal Event: ${newEventId}`,
          location: `${ctx.sheets[role].getName()}!R${crewRow._rowNum}`
        });
      }
      return;
    }

    // 4. ACTION: UPDATE (EventID exists, check for Drift)
    // We compare the current row's hash against the stored hash in the ID Registry
    const registryEntry = ctx.registry[crewRow.UUID]; // Assuming ctx loaded registry
    if (registryEntry && registryEntry.SyncHash !== crewRow.SyncHash) {
      if (canWrite) {
        Engine.Calendar.updateEvent(targetCalId, crewRow.EventID, crewRow);
        Engine.Status.apply(ctx, role, null, "Calendar Log Updated", { targetObj: crewRow });
      }
      
      if (allowedLogTypes.includes("PUSH_CAL")) {
        Engine.Log.write(ctx, { type: "PUSH_CAL", details: `Updated ${crewRow.Title} due to data drift.` });
      }
    }
  });

  // Save changes (Status, EventIDs, Hashes) back to the sheet
  patchRows(role, crewEvents, ctx);
},

  /**
   * COMPARE: Reads the live "Draft" calendar and checks each Crew_Calendar_Log row
   * against it. Updates SyncStatus/LastSynced per row and logs any events found on
   * the calendar that have no matching row in the log (orphans).
   * Read-only against the calendar; only the log sheet is updated.
   */
  compareDraftCalendar: function(ctx) {
    const role = "CREWCAL";
    const targetCalId = ctx.settings.ControlPanel["Crew Draft Calendar ID"];
    if (!targetCalId) {
      Engine.Log.error(ctx, "PULL_DRAFT", "No Target Calendar ID found in ControlPanel.");
      return;
    }

    const cal = CalendarApp.getCalendarById(targetCalId);
    if (!cal) {
      Engine.Log.error(ctx, "PULL_DRAFT", `Draft calendar not found for ID: ${targetCalId}`);
      return;
    }

    const startDays = ctx.config.syncWindow.startDays || 14;
    const endDays = ctx.config.syncWindow.endDays || 400;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - startDays);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + endDays);

    const calEvents = cal.getEvents(startDate, endDate);
    const calMap = {};
    calEvents.forEach(e => { calMap[e.getId()] = e; });

    const crewEvents = scanSheet(role, ctx);
    const matchedIds = {};

    crewEvents.forEach(crewRow => {
      if (!crewRow.EventID) return; // Not yet linked to a calendar event; nothing to compare.

      const calEvent = calMap[crewRow.EventID];
      if (!calEvent) {
        Engine.Status.apply(ctx, role, null, "Missing from Calendar", {
          details: "Log has an EventID but no matching event exists on the Draft calendar.",
          targetObj: crewRow
        });
        return;
      }

      matchedIds[crewRow.EventID] = true;

      const calTitle = calEvent.getTitle() || "";
      const calStart = calEvent.getStartTime();
      const logStart = crewRow.Start ? new Date(crewRow.Start) : null;
      const titleDrift = calTitle.trim() !== String(crewRow.Title || "").trim();
      const timeDrift = !logStart || logStart.getTime() !== calStart.getTime();

      if (titleDrift || timeDrift) {
        Engine.Status.apply(ctx, role, null, "Data Drift Detected", {
          details: `Calendar differs from log (Title: "${calTitle}", Start: ${calStart}).`,
          targetObj: crewRow
        });
      } else {
        Engine.Status.apply(ctx, role, null, "Synced", { targetObj: crewRow });
      }
    });

    // Any calendar event with no matching log row is an orphan worth flagging.
    // Group by Title+Start so stale duplicates (e.g. from a lineup rebuild) report once, not per-event.
    const orphanGroups = {};
    Object.keys(calMap).forEach(eventID => {
      if (matchedIds[eventID]) return;
      const ev = calMap[eventID];
      const key = `${(ev.getTitle() || "").trim()}|${ev.getStartTime().toISOString()}`;
      if (!orphanGroups[key]) orphanGroups[key] = { title: ev.getTitle() || "No Title", start: ev.getStartTime(), ids: [] };
      orphanGroups[key].ids.push(eventID);
    });

    let orphanCount = 0;
    let duplicateGroupCount = 0;
    Object.keys(orphanGroups).forEach(key => {
      const group = orphanGroups[key];
      orphanCount += group.ids.length;
      if (group.ids.length > 1) {
        duplicateGroupCount++;
        Engine.Log.write(ctx, {
          stage: "PULL_DRAFT",
          type: "DUPLICATE_EVENT",
          details: `${group.ids.length} calendar events for "${group.title}" at ${group.start} have no matching row in Crew_Calendar_Log (IDs: ${group.ids.join(", ")}). Likely stale duplicates from a prior lineup version.`
        });
      } else {
        Engine.Log.write(ctx, {
          stage: "PULL_DRAFT",
          type: "ORPHAN_EVENT",
          details: `Calendar event "${group.title}" (${group.ids[0]}) has no matching row in Crew_Calendar_Log.`
        });
      }
    });

    patchRows(role, crewEvents, ctx);
    Engine.Log.write(ctx, {
      stage: "PULL_DRAFT",
      type: "PULL_DRAFT_COMPLETE",
      details: `Compared ${crewEvents.length} log rows against ${calEvents.length} calendar events. ${orphanCount} orphaned calendar event(s) found (${duplicateGroupCount} duplicate group(s)).`
    });
  }
};
