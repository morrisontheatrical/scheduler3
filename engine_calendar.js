//TO DO: add CreateEvent function
//Fix: Remove or rewrite the debug log entry to use defined properties (calObj.venueName, calObj.id).

// Ensure Engine exists
var Engine = Engine || {};

// Assign the sub-module directly
Engine.Calendar = (function() {
  
  return {
    /**
     * PULL: Fetches events and returns them as an array of OBJECTS.
     */
    pullCalendarEvents: function(ctx, calObj) {
      let results = [];
      const role = "VENUECAL";
      const sheet = Engine.getSheetByRole(ctx, role);
      if (!sheet) return results;

      try {
        Engine.Log.write(ctx, {
          stage: "PULL",
          type: "CALENDAR_READ",
          details: `Reading calendar: ${calObj.id}`
        });
        const cal = CalendarApp.getCalendarById(calObj.id);
        
        if (!cal) return results;

        // Correct path to your sync window config
        const startDays = ctx.config.syncWindow.startDays || 14;
        const endDays = ctx.config.syncWindow.endDays || 400;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - startDays);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + endDays);

        const events = cal.getEvents(startDate, endDate);
        const calName = cal.getName();

        events.forEach(event => {
          results.push({
            eventID: event.getId(),        // Matches your Registry
            UUID: "",                    // Lineup link; preserved/populated by mirrorVenues, never the eventID
            Title: event.getTitle() || "No Title",
            Date: event.getStartTime(),
            Start: event.getStartTime(),
            End: event.getEndTime(),
            Location: calObj.venueName,   // Friendly Name (Ballroom, etc)
            Source: calName,               // Literal Google Cal Name
            Description: event.getDescription() || "",
            LastSynced: new Date(),        // This will now fill the column
            LastUpdated: event.getLastUpdated() 
          });
        });
      } catch (e) {
        throw new Error(`Pull Failed for ${calObj.venueName}: ${e.message}`);
      }
      return results;
    },

  

  /**
   * PUSH: Create Event
   */
  createEvent: function(calId, dataObj, ctx) {
    const cal = CalendarApp.getCalendarById(calId);
    if (!cal) throw new Error(`Calendar not found: ${calId}`);

    const start = new Date(dataObj.Start);
    const fallbackHours = (ctx && ctx.mode && ctx.mode.defaultDuration) || 2;
    const end = dataObj.End
      ? new Date(dataObj.End)
      : new Date(start.getTime() + fallbackHours * 60 * 60 * 1000);

    const event = cal.createEvent(dataObj.Title, start, end, {
      location: dataObj.Location || "",
      description: dataObj.Description || ""
    });
    return event.getId();
  },

  /**
   * PUSH: Update Event
   */
  updateEvent: function(calId, eventId, dataObj) {
    const cal = CalendarApp.getCalendarById(calId);
    const event = cal.getEventById(eventId);
    if (!event) return;

    event.setTitle(dataObj.Title);
    event.setTime(new Date(dataObj.Start), new Date(dataObj.End));
    event.setLocation(dataObj.Location);
    event.setDescription(dataObj.Description);
  },

  /**
   * PUSH: Delete Event
   */
  deleteEvent: function(calId, eventId) {
    const cal = CalendarApp.getCalendarById(calId);
    const event = cal.getEventById(eventId);
    if (event) event.deleteEvent();
  },

  /**
   * Resolves a Calendars-sheet entry by its CalendarRole ("draft_season", "crew_calls", ...).
   */
  findByRole: function(ctx, calendarRole) {
    const wanted = String(calendarRole || "").trim().toLowerCase();
    return (ctx.calendars || []).find(c => c.role === wanted) || null;
  },

  /**
   * Returns the sync-window date range used for reads and wipes.
   */
  getSyncWindowRange: function(ctx) {
    const startDays = ctx.config.syncWindow.startDays || 14;
    const endDays = ctx.config.syncWindow.endDays || 400;
    const start = new Date();
    start.setDate(start.getDate() - startDays);
    const end = new Date();
    end.setDate(end.getDate() + endDays);
    return { start: start, end: end };
  },

  /**
   * Resolves the calendar for a CalendarRole and checks it may be wiped.
   * Returns { ok, reason, entry, cal, range, events }; events are only read, never deleted.
   */
  previewWipe: function(ctx, calendarRole) {
    const entry = this.findByRole(ctx, calendarRole);
    if (!entry) {
      return { ok: false, reason: `No calendar with CalendarRole "${calendarRole}" on the Calendars sheet.` };
    }
    if (!entry.allowWrites || (ctx.runtime && ctx.runtime.allowCalendarWrites === false)) {
      return { ok: false, reason: `Calendar writes are not allowed for "${entry.displayName || entry.venueName}" (allowCalendarWrites).`, entry: entry };
    }
    const cal = CalendarApp.getCalendarById(entry.id);
    if (!cal) {
      return { ok: false, reason: `Calendar not found for ID: ${entry.id}`, entry: entry };
    }
    const range = this.getSyncWindowRange(ctx);
    return { ok: true, entry: entry, cal: cal, range: range, events: cal.getEvents(range.start, range.end) };
  },

  /**
   * DESTRUCTIVE: deletes every event on the calendar with the given CalendarRole
   * within the sync window. Callers must confirm with the user first (see previewWipe).
   */
  wipeCalendar: function(ctx, calendarRole) {
    const preview = this.previewWipe(ctx, calendarRole);
    if (!preview.ok) {
      Engine.Log.error(ctx, "CAL_WIPE", preview.reason);
      return { deleted: 0, failed: 0, skipped: true, reason: preview.reason };
    }

    let deleted = 0;
    let failed = 0;
    preview.events.forEach(function(event, index) {
      try {
        event.deleteEvent();
        deleted++;
      } catch (e) {
        failed++;
        Engine.Log.error(ctx, "CAL_WIPE", `Could not delete event "${event.getTitle()}": ${e.message}`);
      }
      // Pause periodically to stay under Google's rate limits
      if (index % 50 === 0) Utilities.sleep(500);
    });

    Engine.Log.write(ctx, {
      stage: "CAL_WIPE",
      type: "CAL_CLEANUP",
      details: `Wiped ${deleted} event(s) (${failed} failed) from "${preview.cal.getName()}" [${calendarRole}] between ${preview.range.start.toDateString()} and ${preview.range.end.toDateString()}.`
    });
    return { deleted: deleted, failed: failed, skipped: false, calendarName: preview.cal.getName() };
  }
};
})();


// THIS IS NOW A STANDALONE GLOBAL FUNCTION
function global_pullCalendarEvents(ctx, calObj) {
  let results = [];
  try {
    const cal = CalendarApp.getCalendarById(calObj.id);
    if (!cal) return results;

    const startDays = ctx.config.syncWindow.startDays || 14;
    const endDays = ctx.config.syncWindow.endDays || 400;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - startDays);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + endDays);

    const events = cal.getEvents(startDate, endDate);
    
    events.forEach(event => {
      results.push({
        eventID: event.getId(),        // Matches your Registry
        UUID: "",                    // Lineup link; preserved/populated by mirrorVenues, never the eventID
        Title: event.getTitle() || "No Title",
        Date: event.getStartTime(),
        Start: event.getStartTime(),
        End: event.getEndTime(),
        Location: calObj.venueName,   
        Source: cal.getName(),               
        Description: event.getDescription() || "",
        LastSynced: new Date(),        
        LastUpdated: event.getLastUpdated() 
      });
    });
  } catch (e) {
    throw new Error(e.message);
  }
  return results;
}