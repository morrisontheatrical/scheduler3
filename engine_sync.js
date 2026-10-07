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

    if (runtime.applyDecisions && Engine.Decisions && typeof Engine.Decisions.applyPending === "function") {
      const decisionResults = Engine.Decisions.applyPending(ctx);
      Engine.Log.write(ctx, {
        stage: "DECISION",
        type: "DECISION_BATCH",
        details: `Applied reviewed decisions at sync start: ${decisionResults.applied} applied, ${decisionResults.failed} failed, ${decisionResults.skipped} skipped.`
      });
    }
  
    // 2. Log active mode at start
    const activeMode = ctx.mode && ctx.mode.mode ? ctx.mode.mode : "Unknown";
    const syncMode = ctx.mode && ctx.mode.syncMode ? ctx.mode.syncMode : "N/A";
    Engine.Log.write(ctx, { 
      stage: "SYS_INIT", 
      details: `Starting sync in mode: ${activeMode} (SyncMode: ${syncMode})`
    });
  
    // Reload after decision application, which may have changed identity rows.
    ctx.registry = Engine.IDService.loadRegistry(ctx);

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
  // ControlPanel's row is labeled "Crew Draft Calendar" (key "CrewDraftCal"); falls back to the
  // "Draft" entry in the Calendars sheet so the ID doesn't need to be maintained in two places.
  _getCrewDraftCalendarId: function(ctx) {
    const cp = ctx.settings.ControlPanel || {};
    const override = cp["Crew Draft Calendar ID"] || cp["CrewDraftCal"] || cp["Crew Draft Calendar"];
    if (override) return override;
    const draftCal = (ctx.calendars || []).find(c => c.venueName && c.venueName.includes("Draft"));
    return draftCal ? draftCal.id : "";
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

    const sheet = Engine.getSheetByRole(ctx, role);
    const sheetName = sheet && sheet.getName();

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
      // Preserve manually/engine-assigned Lineup UUID links; the clear below would wipe them.
      const priorUuidByEventId = {};
      scanSheet(role, ctx).forEach(function(r) {
        const eid = String(r.eventID || r.EventID || "").trim();
        const uuid = String(r.UUID || "").trim();
        if (eid && uuid) priorUuidByEventId[eid] = uuid;
      });
      allVenueEvents.forEach(function(ev) {
        const prior = priorUuidByEventId[String(ev.eventID).trim()];
        if (prior) ev.UUID = prior;
      });

      // Clear old data safely
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
      }
      
      // batchWrite handles the rest
      batchWrite(role, allVenueEvents, ctx);
      Engine.IO.sortLogByDate(ctx, role);
      Engine.IDService.syncAll(ctx);
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
 /**
   * Fuzzy "same show?" check for a venue-calendar title vs a Lineup/crew title.
   * Venue titles routinely differ by typos, smart punctuation, line breaks, or an added/dropped subtitle.
   * Matches when one title's distinctive words are all found in the other, or at least 60% of the
   * shorter title's words (min. 2) are. Words match exactly or within one typo/transposition.
   */
  _titlesLikelyMatch: function(a, b) {
    const stop = new Set(["the", "an", "of", "and", "with", "featuring", "in", "at", "presents", "tribute", "concert", "experience", "musical", "show", "live", "official", "performance"]);
    const tokens = text => String(text || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1 && !stop.has(t));
    const close = (x, y) => {
      if (x === y) return true;
      if (x.length < 4 || y.length < 4 || Math.abs(x.length - y.length) > 1) return false;
      if (x.length === y.length) {
        const diff = [];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff.push(i);
        return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]]);
      }
      const [shorter, longer] = x.length < y.length ? [x, y] : [y, x];
      for (let i = 0; i < longer.length; i++) {
        if (longer.slice(0, i) + longer.slice(i + 1) === shorter) return true;
      }
      return false;
    };

    const ta = tokens(a);
    const tb = tokens(b);
    if (!ta.length || !tb.length) return String(a || "").trim() !== "" && String(a || "").trim() === String(b || "").trim();
    const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const matched = small.filter(t => large.some(u => close(t, u))).length;
    return matched === small.length || (matched >= 2 && matched / small.length >= 0.6);
  },

  reconcileLogs: function(ctx) {
    const lineupToCrew = this.verifyLineupToCrewLog(ctx);
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
      // "Location Conflict" is engine-assigned and locks the row, so it must be re-evaluated here
      // or a false conflict (e.g. a typo'd venue title) could never clear itself.
      const reevaluable = crewRow.SyncStatus === "Location Conflict" && crewRow.Options !== "Bypass";
      if (!reevaluable && (behaviors.includes("LOCKED") || behaviors.includes("BYPASS") || crewRow.Options === "Bypass")) return;

      const key = `${new Date(crewRow.Date).toISOString()}|${crewRow.Location}`;
      const physicalMatches = venueMap[key] || [];
      if (physicalMatches.length === 0) return;

      // Exact title match, or a human manually flagged "Prefer Venue Event": treat as the same
      // show rather than a conflict, even if the titles don't match verbatim.
      // TODO: remove eventID fallback once Venue_Cal_Log's Map_Registry field is capitalized.
      const titleMatch = physicalMatches.find(v => this._titlesLikelyMatch(v.Title, crewRow.Title));
      if (titleMatch || crewRow.Options === "Prefer Venue Event") {
        const match = titleMatch || physicalMatches[0];
        if (!crewRow.EventID) {
          Engine.Status.apply(ctx, "CREWCAL", null, "Manual Review", {
            details: `Possible Adoption: ${match.EventID || match.eventID}`,
            targetObj: crewRow
          });

          if (allowedLogTypes.includes("RECONCILE_ADOPT")) {
            Engine.Log.write(ctx, { type: "RECONCILE_ADOPT", details: `Match found for ${crewRow.Title}` });
          }
        }
        return;
      }

      // No title match at this date/location: something else genuinely has the room.
      const trueConflicts = physicalMatches.filter(v => (v.EventID || v.eventID) !== crewRow.EventID);
      if (trueConflicts.length > 0) {
        Engine.Status.apply(ctx, "CREWCAL", null, "Location Conflict", {
          details: `Room booked by: ${trueConflicts[0].Title}`,
          targetObj: crewRow
        });

        if (allowedLogTypes.includes("CONFLICT_VENUE")) {
          Engine.Log.write(ctx, { 
            type: "CONFLICT_VENUE", 
            details: `${crewRow.Title} conflicts with ${trueConflicts[0].Title}` 
          });
        }
      }
    });

    // Use patchRows to update only the modified records
    patchRows('CREWCAL', crewEvents, ctx);
    Engine.Log.write(ctx, {
      stage: "RECONCILE",
      type: "RECONCILE_COMPLETE",
      details: `Reconciliation complete. Checked ${crewEvents.length} crew rows against venues; checked ${lineupToCrew.checked} Lineup rows against ${lineupToCrew.crewRole}, ${lineupToCrew.missing} missing, ${lineupToCrew.drifted} drifted, ${lineupToCrew.orphans} orphaned.`
    });
  },

  /**
   * RECONCILIATION: Lineup vs Crew_Calendar_Log
   * Checks that all confirmed Lineup rows exist in Crew_Calendar_Log,
   * flags drift in date/venue, and detects orphan crew log rows.
   */
  verifyLineupToCrewLog: function(ctx) {
    const lRole = Engine.Roles.resolve(ctx, "LINEUP");
    const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
    const lMap = ctx.getMap(lRole);
    const isDraft = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase() === "DRAFT";
    const crewRole = isDraft ? "DRAFTCAL" : "CREWCAL";
    const crewSheet = Engine.getSheetByRole(ctx, crewRole);
    const crewMap = ctx.getMap(crewRole);

    if (!lSheet || !lMap || !crewSheet || !crewMap) {
      Engine.Log.warn(ctx, "RECONCILE", `Cannot reconcile Lineup to ${crewRole}: sheet or map missing.`);
      return { crewRole: crewRole, checked: 0, missing: 0, drifted: 0, orphans: 0 };
    }

    const lCol = f => Engine.getColumnIndex(lMap, f);
    const cCol = f => Engine.getColumnIndex(crewMap, f);
    const lData = lSheet.getDataRange().getValues().slice(1);
    const cData = crewSheet.getDataRange().getValues().slice(1);

    const crewByUUID = new Map();
    cData.forEach((row, idx) => {
      const uuid = row[cCol("UUID")];
      if (uuid) crewByUUID.set(String(uuid).trim(), { row: row, rowIdx: idx + 2 });
    });

    let checked = 0;
    let missing = 0;
    let drifted = 0;
    const lineupUUIDs = new Set();
    const reviewableLineupUUIDs = new Set();
    const driftUUIDs = new Set();

    lData.forEach((lRow, idx) => {
      const uuid = String(lRow[lCol("UUID")] || "").trim();
      if (!uuid) return;
      lineupUUIDs.add(uuid);
      const lineupStatus = String(lRow[lCol("SyncStatus")] || "").trim();
      if (lineupStatus === "Delete Pending" || Engine.Status.blocksWrite(ctx, lineupStatus)) return;
      reviewableLineupUUIDs.add(uuid);
      checked++;

      const crewEntry = crewByUUID.get(uuid);
      if (!crewEntry) {
        missing++;
        Engine.Log.warn(ctx, "RECONCILE", `Lineup row ${idx + 2} (${uuid}: ${lRow[lCol("EventName")]}) has no entry in ${crewRole}.`);
        if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
          const parentId = lRow[lCol("parentID")] || "";
          const reviewId = typeof Engine.Decisions.stableReviewID === "function"
            ? Engine.Decisions.stableReviewID("CREWLOG_MISSING", parentId, uuid)
            : `CREWLOG_MISSING_${uuid}`;
          Engine.Decisions.addPending(ctx, {
            ReviewID: reviewId,
            ReviewType: "CREWLOG_MISSING",
            SourceSheet: lSheet.getName(),
            SourceRow: idx + 2,
            SourceID: uuid,
            CandidateSheet: crewSheet.getName(),
            CandidateTitle: lRow[lCol("EventName")] || "",
            ExistingParentID: lRow[lCol("parentID")] || "",
            Evidence: `Lineup row ${uuid} is not present in ${crewRole}.`,
            Confidence: "HIGH",
            SuggestedAction: "PUSH_LINEUP_TO_CREWLOG",
            SuggestionReason: "Lineup performance missing from crew calendar log.",
            Decision: "PENDING",
            ActionStatus: "PENDING"
          });
        }
      } else {
        const source = {
          EventName: lRow[lCol("EventName")],
          Date: lRow[lCol("Date")],
          Start: lRow[lCol("Date")],
          End: Engine.Ingest._lineupEndTime(ctx, lRow, lMap),
          Venue: lRow[lCol("Venue")]
        };
        const destination = {
          Title: cCol("Title") >= 0 ? crewEntry.row[cCol("Title")] : "",
          Date: cCol("Date") >= 0 ? crewEntry.row[cCol("Date")] : "",
          Start: cCol("Start") >= 0 ? crewEntry.row[cCol("Start")] : "",
          End: cCol("End") >= 0 ? crewEntry.row[cCol("End")] : "",
          Location: cCol("Location") >= 0 ? crewEntry.row[cCol("Location")] : ""
        };
        const fieldAliases = { EventName: "Title", Venue: "Location" };
        const sourceAvailable = {
          EventName: lCol("EventName") >= 0,
          Date: lCol("Date") >= 0,
          Start: lCol("Date") >= 0,
          End: lCol("Date") >= 0,
          Venue: lCol("Venue") >= 0
        };
        const fieldPairs = [
          ["EventName", "Title"],
          ["Date", "Date"],
          ["Start", "Start"],
          ["End", "End"],
          ["Venue", "Location"]
        ].filter(([sourceField, destinationField]) =>
          sourceAvailable[sourceField] &&
          cCol(destinationField) >= 0
        );
        const comparison = Engine.IO.compare(ctx, {
          source: source,
          destination: destination,
          destMap: crewMap,
          fields: fieldPairs.map(([sourceField]) => sourceField),
          fieldAliases: fieldAliases,
          fieldTypes: { Date: "DATETIME", Start: "DATETIME", End: "DATETIME" },
          identifier: uuid
        });

        if (!comparison.equal) {
          drifted++;
          driftUUIDs.add(uuid);
          const parentId = lRow[lCol("parentID")] || "";
          const changedFields = comparison.changed.map(change => change.field);
          const evidence = comparison.changed.map(change =>
            `${change.field}: Lineup="${Engine.IO.formatValue(ctx, change.source)}" | ${crewRole}="${Engine.IO.formatValue(ctx, change.destination)}"`
          ).join(" | ");
          Engine.Log.warn(ctx, "RECONCILE", `Lineup row ${uuid} differs from ${crewRole}: ${changedFields.join(", ")}.`);
          if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
            const reviewId = typeof Engine.Decisions.stableReviewID === "function"
              ? Engine.Decisions.stableReviewID("LINEUP_CREW_DRIFT", parentId, uuid, evidence)
              : `LINEUP_CREW_DRIFT_${uuid}`;
            Engine.Decisions.addPending(ctx, {
              ReviewID: reviewId,
              ReviewType: "LINEUP_CREW_DRIFT",
              SourceSheet: lSheet.getName(),
              SourceRow: idx + 2,
              SourceID: uuid,
              CandidateSheet: crewSheet.getName(),
              CandidateRow: crewEntry.rowIdx,
              CandidateID: uuid,
              ParentTitle: source.EventName || "",
              CandidateTitle: destination.Title || "",
              ExistingParentID: parentId,
              MatchedFields: "UUID",
              ChangedFields: changedFields.join(", "),
              Evidence: evidence,
              Confidence: "HIGH",
              SuggestedAction: "PUSH_LINEUP_TO_CREWLOG",
              SuggestionReason: "Lineup UUID links the records; differences are review evidence. No update is applied by verification.",
              Decision: "PENDING",
              ActionStatus: "PENDING"
            });
          }
        }
      }
    });

    // Check for orphan crew rows (Source="Lineup" but UUID not in Lineup)
    let orphans = 0;
    cData.forEach((cRow, idx) => {
      const source = String(cRow[cCol("Source")] || "").trim();
      const uuid = String(cRow[cCol("UUID")] || "").trim();
      if (source === "Lineup" && uuid && !lineupUUIDs.has(uuid)) {
        orphans++;
        Engine.Log.warn(ctx, "RECONCILE", `Crew log row ${idx + 2} (${uuid}) references a Lineup UUID that no longer exists.`);
      }
    });

    if (Engine.Decisions && typeof Engine.Decisions.reviewable === "function") {
      Engine.Decisions.reviewable(ctx)
        .filter(decision => ["CREWLOG_MISSING", "LINEUP_CREW_DRIFT"].includes(String(decision.ReviewType || "")))
        .forEach(decision => {
          const uuid = String(decision.CandidateID || decision.SourceID || "").trim();
          const resolved = decision.ReviewType === "CREWLOG_MISSING"
            ? crewByUUID.has(uuid) || !reviewableLineupUUIDs.has(uuid)
            : !reviewableLineupUUIDs.has(uuid) || (crewByUUID.has(uuid) && !driftUUIDs.has(uuid));
          if (resolved && Engine.Decisions.markSuperseded(
            ctx,
            decision.ReviewID,
            "Superseded: the active-season Lineup and crew-log rows now match."
          )) {
            Engine.Log.info(ctx, "RECONCILE", `Superseded resolved ${decision.ReviewType} review ${decision.ReviewID}.`);
          }
        });
    }

    Engine.Log.write(ctx, {
      stage: "RECONCILE",
      type: "RECONCILE_LINEUP_CREW_COMPLETE",
      details: `Lineup vs ${crewRole}: checked ${checked}, missing ${missing}, drifted ${drifted}, orphans ${orphans}.`
    });

    return { crewRole: crewRole, checked: checked, missing: missing, drifted: drifted, orphans: orphans };
  },
  syncCrewCalendar: function(ctx) {
  const role = "CREWCAL";
  const crewEvents = scanSheet(role, ctx);
  const allowedLogTypes = (ctx.mode && ctx.mode.allowedLogTypes) || [];
  const canWrite = ctx.runtime && ctx.runtime.allowCalendarWrites !== undefined
    ? Boolean(ctx.runtime.allowCalendarWrites)
    : Boolean(ctx.mode && ctx.mode.writeToCalendar);
  const allowedBehaviors = (ctx.mode && ctx.mode.allowedBehaviors) || [];
  const modeAllowsCalendarWrites = ctx.mode && ctx.mode.syncMode !== "AUDIT_ONLY"
    && (allowedBehaviors.length === 0 || allowedBehaviors.includes("SYNC_ALLOWED"));

  // We need the Target Calendar ID (defaults to the "Draft" entry in Calendars; ControlPanel can override)
  const targetCalId = this._getCrewDraftCalendarId(ctx);
  if (!targetCalId) {
    Engine.Log.error(ctx, "PUSH", "No Target Calendar ID found in ControlPanel or the Calendars sheet.");
    return;
  }

  crewEvents.forEach(crewRow => {
    // 1. BEHAVIOR CHECK
    const statusDef = ctx.status[crewRow.SyncStatus];
    const behaviors = statusDef ? Engine.parseModeList(statusDef.behavior) : [];
    if (behaviors.includes("LOCKED") || behaviors.includes("BYPASS") || crewRow.Options === "Bypass") return;

    // 2. ACTION: DELETE (status-driven, or a manual "Delete from Calendar" trigger)
    if (crewRow.SyncStatus === "To Delete on calendar" || crewRow.Options === "Delete from Calendar") {
      if (crewRow.EventID) {
        if (canWrite && modeAllowsCalendarWrites) {
          Engine.Calendar.deleteEvent(targetCalId, crewRow.EventID);
          crewRow.Options = "AutoSync"; // one-shot trigger resets itself
          Engine.Status.apply(ctx, role, null, "Deleted by Calendar", { targetObj: crewRow });
          Engine.IDService.upsert(ctx, { id: crewRow.UUID, status: "Deleted", details: "Removed from Cal" });
        }
        if (allowedLogTypes.includes("CAL_CLEANUP")) {
          Engine.Log.write(ctx, { type: "CAL_CLEANUP", details: `Deleted event: ${crewRow.Title}` });
        }
      }
      return;
    }

    const forcedPush = crewRow.Options === "Push to Calendar";

    // 3. ACTION: CREATE (No EventID exists)
    if (!crewRow.EventID || crewRow.EventID === "") {
      if (canWrite && modeAllowsCalendarWrites) {
        const newEventId = Engine.Calendar.createEvent(targetCalId, crewRow, ctx);
        crewRow.EventID = newEventId;
        if (forcedPush) crewRow.Options = "AutoSync";
        Engine.Status.apply(ctx, role, null, "Pushed to Calendar", { targetObj: crewRow });
        
        // Register the new link in the ID Registry
        const roleSheet = Engine.getSheetByRole(ctx, role);
        Engine.IDService.upsert(ctx, { 
          id: crewRow.UUID,
          details: `Created Cal Event: ${newEventId}`,
          location: roleSheet ? `${roleSheet.getName()}!R${crewRow._rowNum}` : ""
        });
      }
      return;
    }

    // 4. ACTION: UPDATE (hash drift, or a manual "Push to Calendar" override)
    const registryEntry = ctx.registry[crewRow.UUID]; // Assuming ctx loaded registry
    if (forcedPush || (registryEntry && registryEntry.SyncHash !== crewRow.SyncHash)) {
      if (canWrite && modeAllowsCalendarWrites) {
        Engine.Calendar.updateEvent(targetCalId, crewRow.EventID, crewRow);
        if (forcedPush) crewRow.Options = "AutoSync";
        Engine.Status.apply(ctx, role, null, "Pushed to Calendar", { targetObj: crewRow });
      }
      
      if (allowedLogTypes.includes("PUSH_CAL")) {
        Engine.Log.write(ctx, { type: "PUSH_CAL", details: `Updated ${crewRow.Title} due to ${forcedPush ? "manual Push to Calendar" : "data drift"}.` });
      }
    }
  });

  // Save changes (Status, EventIDs, Hashes) back to the sheet
  patchRows(role, crewEvents, ctx);
  Engine.IO.sortLogByDate(ctx, role);
  Engine.IDService.syncAll(ctx);
},

  /**
   * COMPARE: Reads the live "Draft" calendar and checks each Draft_Season_Log row
   * against it. Updates SyncStatus/LastSynced per row and logs any events found on
   * the calendar that have no matching row in the log (orphans).
   * Read-only against the calendar; only the log sheet is updated.
   */
  compareDraftCalendar: function(ctx) {
    const role = "DRAFTCAL";
    const targetCalId = this._getCrewDraftCalendarId(ctx);
    if (!targetCalId) {
      Engine.Log.error(ctx, "PULL_DRAFT", "No Target Calendar ID found in ControlPanel or the Calendars sheet.");
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
    // Shared normalize (scriptLib SL.Utils) — collapse + fold so titles that
    // drifted via smart punctuation still group with their calendar events.
    const utils = Engine.getLibraryModule("Utils");
    const normalizeTitle = title => utils.normalize(title, { collapse: true, fold: true });
    const crewByTitleStart = {};
    crewEvents.forEach(row => {
      const start = row.Start ? new Date(row.Start) : null;
      if (!start || isNaN(start.getTime())) return;
      const key = `${normalizeTitle(row.Title)}|${start.toISOString()}`;
      if (!crewByTitleStart[key]) crewByTitleStart[key] = [];
      crewByTitleStart[key].push(row);
    });

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
      const comparison = Engine.IO.compare(ctx, {
        source: { Title: calTitle, Start: calStart },
        destination: crewRow,
        destinationRole: role,
        fields: ["Title", "Start"],
        comparisonModes: { Start: "timestamp" },
        identifier: crewRow.UUID || crewRow.EventID
      });

      if (!comparison.equal) {
        Engine.Status.apply(ctx, role, null, "Data Drift Detected", {
          details: `Calendar differs from log: ${comparison.changed.map(item => item.field).join(", ")}.`,
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
      const key = `${normalizeTitle(ev.getTitle())}|${ev.getStartTime().toISOString()}`;
      if (!orphanGroups[key]) orphanGroups[key] = { title: ev.getTitle() || "No Title", start: ev.getStartTime(), ids: [] };
      orphanGroups[key].ids.push(eventID);
    });

    let orphanCount = 0;
    let duplicateGroupCount = 0;
    Object.keys(orphanGroups).forEach(key => {
      const group = orphanGroups[key];
      const matchingCrewRows = crewByTitleStart[key] || [];
      const crewRow = matchingCrewRows.length === 1 ? matchingCrewRows[0] : null;
      const linkContext = crewRow ? {
        sheetName: role,
        rowIdx: crewRow._rowNum,
        id: crewRow.UUID || crewRow.EventID
      } : {};
      orphanCount += group.ids.length;
      if (group.ids.length > 1) {
        duplicateGroupCount++;
        Engine.Log.write(ctx, {
          stage: "PULL_DRAFT",
          type: "DUPLICATE_EVENT",
          ...linkContext,
          details: `${group.ids.length} events on Draft 26-27 for "${group.title}" at ${group.start}. ${crewRow ? "A Draft_Season_Log row exists at this title/start." : "No unique Draft_Season_Log match exists."} IDs: ${group.ids.join(", ")}.`
        });
      } else {
        Engine.Log.write(ctx, {
          stage: "PULL_DRAFT",
          type: "ORPHAN_EVENT",
          ...linkContext,
          details: `Event on Draft 26-27: "${group.title}" at ${group.start}. ${crewRow ? "A Draft_Season_Log row exists at this title/start." : "No unique Draft_Season_Log match exists."} Event ID: ${group.ids[0]}.`
        });
      }
    });

    patchRows(role, crewEvents, ctx);
    Engine.IO.sortLogByDate(ctx, role);
    Engine.IDService.syncAll(ctx);
    Engine.Log.write(ctx, {
      stage: "PULL_DRAFT",
      type: "PULL_DRAFT_COMPLETE",
      details: `Compared ${crewEvents.length} log rows against ${calEvents.length} calendar events. ${orphanCount} orphaned calendar event(s) found (${duplicateGroupCount} duplicate group(s)).`
    });
  }
};

function verifyLineupToCrewLog() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Verify Lineup vs Crew Log");
  const results = Engine.Sync.verifyLineupToCrewLog(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Verify Lineup vs Crew Log", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}
