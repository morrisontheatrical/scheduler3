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
      const sheetConfig = ctx.sheets[role];
      if (!sheetConfig) return results;

      try {
        Engine.Log.write(ctx, {
        stage: logContext.stage || "Calendar ID",
        sheetName: sheetName,
        rowIdx: rowIdx,
        id: logContext.id || "N/A",
        type: statusName,
        details: calObj.id
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
            UUID: event.getId(),           
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
        UUID: event.getId(),           
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