var Engine = Engine || {};

Engine.Decisions = {
  requiredFields: [
    "ReviewID", "ReviewType", "SourceSheet", "SourceRow", "CandidateSheet", "CandidateRow",
    "ImportTitle", "ParentTitle", "ExistingParentID", "DuplicateParentID", "VenueEventID",
    "VenueUUID", "MatchedFields", "ChangedFields", "Confidence", "Decision", "RequestedAction",
    "KeepParentID", "ReviewNotes", "ReviewedBy", "ReviewedAt", "ActionStatus", "ActionedAt",
    "ActionDetails"
  ],

  _getMap: function(ctx) {
    return ctx.getMap("decision_log") || ctx.getMap("DECISIONS");
  },

  _col: function(map, fieldName) {
    return Engine.getColumnIndex(map, fieldName);
  },

  _value: function(row, map, fieldName) {
    const index = this._col(map, fieldName);
    return index >= 0 ? row[index] : "";
  },

  ensureSchema: function(ctx) {
    const sheet = ctx.ss.getSheetByName("decision_log");
    const map = this._getMap(ctx);
    if (!sheet || !map) throw new Error("decision_log sheet or Map_Registry definition is missing");

    const missing = this.requiredFields.filter(fieldName => this._col(map, fieldName) < 0);
    if (missing.length) {
      throw new Error(`decision_log is missing fields in Map_Registry: ${missing.join(", ")}`);
    }
    return { sheet: sheet, map: map };
  },

  pending: function(ctx) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const statusCol = this._col(table.map, "ActionStatus");
    return data.slice(1)
      .map((row, index) => ({ row: row, rowNumber: index + 2 }))
      .filter(item => statusCol < 0 || String(item.row[statusCol] || "PENDING").trim().toUpperCase() === "PENDING")
      .map(item => this._toObject(item.row, item.rowNumber, table.map));
  },

  _toObject: function(row, rowNumber, map) {
    const result = { _rowNumber: rowNumber };
    Object.keys(map).forEach(fieldName => {
      const index = this._col(map, fieldName);
      if (index >= 0) result[fieldName] = row[index];
    });
    return result;
  },

  markReviewed: function(ctx, reviewID, decision, requestedAction, details) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const reviewCol = this._col(table.map, "ReviewID");
    const decisionCol = this._col(table.map, "Decision");
    const actionCol = this._col(table.map, "RequestedAction");
    const notesCol = this._col(table.map, "ReviewNotes");
    const reviewedByCol = this._col(table.map, "ReviewedBy");
    const reviewedAtCol = this._col(table.map, "ReviewedAt");
    const actionStatusCol = this._col(table.map, "ActionStatus");
    const rowIndex = data.findIndex((row, index) => index > 0 && String(row[reviewCol]) === String(reviewID));
    if (rowIndex < 0) throw new Error(`Decision review not found: ${reviewID}`);

    const sheetRow = rowIndex + 1;
    table.sheet.getRange(sheetRow, decisionCol + 1).setValue(decision);
    table.sheet.getRange(sheetRow, actionCol + 1).setValue(requestedAction);
    if (actionStatusCol >= 0) table.sheet.getRange(sheetRow, actionStatusCol + 1).setValue("PENDING");
    if (notesCol >= 0 && details) table.sheet.getRange(sheetRow, notesCol + 1).setValue(details);
    if (reviewedByCol >= 0) table.sheet.getRange(sheetRow, reviewedByCol + 1).setValue(Session.getActiveUser().getEmail());
    if (reviewedAtCol >= 0) table.sheet.getRange(sheetRow, reviewedAtCol + 1).setValue(new Date());
    return true;
  }
};

function ensureDecisionLogSchema() {
  const ctx = Engine.getContext();
  return Engine.Decisions.ensureSchema(ctx);
}

function openDecisionLog() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("decision_log");
  if (sheet) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  else SpreadsheetApp.getUi().alert("decision_log not found.");
}

function markDecisionReviewed(reviewID, decision, requestedAction, details) {
  return Engine.Decisions.markReviewed(Engine.getContext(), reviewID, decision, requestedAction, details);
}
