var Engine = Engine || {};

Engine.Decisions = {
  requiredFields: [
    "ReviewID", "ReviewType", "SourceSheet", "SourceRow", "SourceID", "SourceLink",
    "CandidateSheet", "CandidateRow", "CandidateID", "CandidateLink", "ImportTitle",
    "ParentTitle", "CandidateTitle", "ExistingParentID", "DuplicateParentID", "VenueEventID", "VenueUUID",
    "MatchedFields", "ChangedFields", "ChangedDetails", "Evidence", "Confidence",
    "SuggestedAction", "SuggestionReason", "SuggestedKeepID", "CandidateIDs", "AffectedRows",
    "Decision", "RequestedAction", "KeepChoice", "KeepParentID", "ReviewNotes", "ReviewedBy",
    "ReviewedAt", "ActionStatus", "ActionedAt", "ActionDetails"
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

  ensureComparisonColumns: function(ctx) {
    const sheet = ctx.ss.getSheetByName("decision_log");
    const registry = ctx.ss.getSheetByName("Map_Registry");
    if (!sheet || !registry) throw new Error("decision_log or Map_Registry sheet is missing");

    const registryData = registry.getDataRange().getValues();
    const registryHeaders = registryData[0] || [];
    const sheetNameCol = registryHeaders.indexOf("Sheet Name");
    const fieldNameCol = registryHeaders.indexOf("Field Name");
    const columnIndexCol = registryHeaders.indexOf("Column Index");
    const displayNameCol = registryHeaders.indexOf("Header DisplayName");
    const dataTypeCol = registryHeaders.indexOf("Data Type");
    const syncBehaviorCol = registryHeaders.indexOf("Sync Behavior");
    if ([sheetNameCol, fieldNameCol, columnIndexCol, displayNameCol].includes(-1)) {
      throw new Error("Map_Registry is missing required mapping columns for decision_log");
    }

    const exists = registryData.slice(1).some(row =>
      String(row[sheetNameCol] || "").trim() === "decision_log" &&
      String(row[fieldNameCol] || "").trim() === "CandidateTitle"
    );
    if (exists) return false;

    const newColumn = sheet.getLastColumn() + 1;
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, newColumn).setValue("Candidate Title");

    const registryRow = new Array(registryHeaders.length).fill("");
    registryRow[sheetNameCol] = "decision_log";
    registryRow[fieldNameCol] = "CandidateTitle";
    registryRow[columnIndexCol] = newColumn - 1;
    registryRow[displayNameCol] = "Candidate Title";
    if (dataTypeCol >= 0) registryRow[dataTypeCol] = "Text";
    if (syncBehaviorCol >= 0) registryRow[syncBehaviorCol] = "System-Managed";
    registry.appendRow(registryRow);
    Engine.assembleSheetMap(ctx);
    return true;
  },

  ensureSchema: function(ctx) {
    const sheet = ctx.ss.getSheetByName("decision_log");
    this.ensureComparisonColumns(ctx);
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
  },

  markSuperseded: function(ctx, reviewID, details) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const reviewCol = this._col(table.map, "ReviewID");
    const statusCol = this._col(table.map, "ActionStatus");
    const actionedAtCol = this._col(table.map, "ActionedAt");
    const detailsCol = this._col(table.map, "ActionDetails");
    const rowIndex = data.findIndex((row, index) => index > 0 && String(row[reviewCol]) === String(reviewID));
    if (rowIndex < 0) return false;

    const sheetRow = rowIndex + 1;
    if (statusCol >= 0) table.sheet.getRange(sheetRow, statusCol + 1).setValue("SUPERSEDED");
    if (actionedAtCol >= 0) table.sheet.getRange(sheetRow, actionedAtCol + 1).setValue(new Date());
    if (detailsCol >= 0) table.sheet.getRange(sheetRow, detailsCol + 1).setValue(details);
    return true;
  },

  refreshLinks: function(ctx) {
    const table = this.ensureSchema(ctx);
    const resolveParentRow = parentID => {
      const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
      const parentMap = ctx.getMap("Parent Lineup");
      const idColumn = Engine.getColumnIndex(parentMap, "parentID");
      if (!parentSheet || idColumn < 0 || !parentID) return null;
      const data = parentSheet.getDataRange().getValues();
      const rowIndex = data.findIndex((row, index) => index > 0 && String(row[idColumn]) === String(parentID));
      return rowIndex >= 0 ? rowIndex + 1 : null;
    };

    const sourceLinkCol = this._col(table.map, "SourceLink");
    const candidateLinkCol = this._col(table.map, "CandidateLink");
    const sourceRowCol = this._col(table.map, "SourceRow");
    const candidateRowCol = this._col(table.map, "CandidateRow");
    let linked = 0;
    let cleared = 0;

    this.pending(ctx).filter(decision => String(decision.ReviewType || "") === "PARENT_DUPLICATE").forEach(decision => {
      const sourceRow = resolveParentRow(decision.SourceID);
      const candidateRow = resolveParentRow(decision.CandidateID);
      if (sourceRow && sourceLinkCol >= 0) {
        table.sheet.getRange(decision._rowNumber, sourceRowCol + 1).setValue(sourceRow);
        table.sheet.getRange(decision._rowNumber, sourceLinkCol + 1).setFormula(Engine.makeSheetRowLink(ctx, "Parent Lineup", sourceRow, decision.SourceID));
        linked++;
      }
      if (candidateRow && candidateLinkCol >= 0) {
        table.sheet.getRange(decision._rowNumber, candidateRowCol + 1).setValue(candidateRow);
        table.sheet.getRange(decision._rowNumber, candidateLinkCol + 1).setFormula(Engine.makeSheetRowLink(ctx, "Parent Lineup", candidateRow, decision.CandidateID));
        linked++;
      }
      if (!sourceRow && sourceLinkCol >= 0) {
        table.sheet.getRange(decision._rowNumber, sourceLinkCol + 1).clearContent();
        cleared++;
      }
      if (!candidateRow && candidateLinkCol >= 0) {
        table.sheet.getRange(decision._rowNumber, candidateLinkCol + 1).clearContent();
        cleared++;
      }
    });
    return { linked: linked, cleared: cleared };
  },

  addPending: function(ctx, values) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const reviewCol = this._col(table.map, "ReviewID");
    const statusCol = this._col(table.map, "ActionStatus");

    const rowsToSet = {
      SourceLink: ["SourceSheet", "SourceRow", "SourceID"],
      CandidateLink: ["CandidateSheet", "CandidateRow", "CandidateID"]
    };

    const existing = data.slice(1).some(row =>
      String(row[reviewCol] || "") === String(values.ReviewID || "") &&
      String(row[statusCol] || "PENDING").trim().toUpperCase() === "PENDING"
    );
    if (existing) return false;

    const indices = Object.keys(table.map).map(fieldName => this._col(table.map, fieldName)).filter(index => index >= 0);
    const row = new Array(Math.max(...indices) + 1).fill("");
    Object.keys(values).forEach(fieldName => {
      const index = this._col(table.map, fieldName);
      if (index >= 0) row[index] = values[fieldName];
    });

    Object.keys(rowsToSet).forEach(linkField => {
      const index = this._col(table.map, linkField);
      if (index < 0) return;
      const [sheetField, rowField, idField] = rowsToSet[linkField];
      const sheetName = values[sheetField] || "";
      const rowNumber = values[rowField];
      const label = values[idField] || (rowNumber ? `Row ${rowNumber}` : "View row");
      if (sheetName && rowNumber && !row[index]) {
        row[index] = Engine.makeSheetRowLink(ctx, sheetName, rowNumber, label);
      }
    });

    if (statusCol >= 0 && !row[statusCol]) row[statusCol] = "PENDING";
    table.sheet.appendRow(row);
    return true;
  },

  resolveMergeSelection: function(decision) {
    const keepChoice = String(decision.KeepChoice || "").trim().toUpperCase();
    const keepID = String(decision.KeepParentID || decision.ExistingParentID || "").trim();
    const candidateID = String(decision.CandidateID || decision.DuplicateParentID || "").trim();
    const suggestedKeep = String(decision.SuggestedKeepID || "").trim();
    const existingID = String(decision.ExistingParentID || "").trim();
    const candidateIDs = String(decision.CandidateIDs || "").split(",").map(part => String(part).trim()).filter(Boolean);
    const fallbackCandidate = candidateIDs.length ? candidateIDs[0] : candidateID;

    let resolvedKeepID = keepID || suggestedKeep || existingID;
    let resolvedDuplicateID = decision.DuplicateParentID || fallbackCandidate || "";

    if (keepChoice === "KEEP_EXISTING") {
      resolvedKeepID = existingID || keepID || suggestedKeep || resolvedKeepID;
      resolvedDuplicateID = fallbackCandidate || decision.DuplicateParentID || "";
    } else if (keepChoice === "KEEP_CANDIDATE") {
      resolvedKeepID = fallbackCandidate || suggestedKeep || keepID || existingID;
      resolvedDuplicateID = existingID || decision.DuplicateParentID || "";
    } else if (keepChoice === "KEEP_SOURCE") {
      resolvedKeepID = existingID || keepID || suggestedKeep || resolvedKeepID;
      resolvedDuplicateID = fallbackCandidate || decision.DuplicateParentID || "";
    } else if (keepChoice === "KEEP_OTHER") {
      resolvedKeepID = suggestedKeep || keepID || existingID;
      resolvedDuplicateID = decision.DuplicateParentID || fallbackCandidate || "";
    }

    return { keepID: resolvedKeepID, duplicateID: resolvedDuplicateID };
  },

  applyPending: function(ctx) {
    const table = this.ensureSchema(ctx);
    // Delete applied queue rows from the bottom up so earlier deletions do not
    // shift the row numbers of decisions still being processed.
    const decisions = this.pending(ctx).sort((a, b) => b._rowNumber - a._rowNumber);
    const statusCol = this._col(table.map, "ActionStatus");
    const actionedAtCol = this._col(table.map, "ActionedAt");
    const detailsCol = this._col(table.map, "ActionDetails");
    const results = { applied: 0, failed: 0, skipped: 0 };

    decisions.forEach(decision => {
      const userDecision = String(decision.Decision || "PENDING").trim().toUpperCase();
      const action = String(decision.RequestedAction || decision.SuggestedAction || "").trim().toUpperCase();
      if (userDecision === "PENDING" || (userDecision !== "REJECTED" && userDecision !== "DEFERRED" && !action)) {
        results.skipped++;
        return;
      }

      let actionDetails = "";
      try {
        if (userDecision === "REJECTED") {
          actionDetails = `Decision rejected by reviewer; no data change for ${decision.ReviewID}`;
        } else if (userDecision === "DEFERRED") {
          results.skipped++;
          return;
        } else if (!action) {
          results.skipped++;
          return;
        } else if (["REVIEW_IMPORT_DRIFT", "REVIEW_PARENT_ONLY", "REVIEW_DUPLICATE", "REJECT_MATCH", "MARK_BYPASS", "MARK_DELETE", "REVIEW_DATE_SPAN"].includes(action)) {
          actionDetails = `Recorded decision ${userDecision}; no automatic data change for ${action}`;
        } else if (action === "ACCEPT_IMPORT") {
          if (!["ACCEPT", "ACCEPT_IMPORT"].includes(userDecision)) throw new Error("ACCEPT_IMPORT requires Decision=ACCEPT");
          if (!decision.ExistingParentID) throw new Error("ACCEPT_IMPORT requires ExistingParentID");
          if (!Engine.Ingest.acceptImportDrift(ctx, decision.ExistingParentID)) {
            throw new Error("Import row could not be resolved for the selected Parent Lineup row");
          }
          actionDetails = `Accepted import changes for ${decision.ExistingParentID}`;
        } else if (action === "MERGE_PARENT") {
          if (!["ACCEPT", "CONFIRMED_DUPLICATE"].includes(userDecision)) {
            throw new Error("MERGE_PARENT requires Decision=ACCEPT or CONFIRMED_DUPLICATE");
          }
          const selection = this.resolveMergeSelection(decision);
          const keepID = selection.keepID;
          const duplicateID = selection.duplicateID;
          if (!keepID || !duplicateID) throw new Error("MERGE_PARENT requires KeepParentID and DuplicateParentID");
          const mergeResult = Engine.Ingest.mergeParentDuplicate(ctx, keepID, duplicateID);
          actionDetails = `Merged ${duplicateID} into ${keepID}; copied ${mergeResult.copiedFields.join(", ") || "no"} source fields`;
        } else {
          throw new Error(`Unsupported RequestedAction: ${action}`);
        }

        if (statusCol >= 0) table.sheet.getRange(decision._rowNumber, statusCol + 1).setValue("APPLIED");
        if (actionedAtCol >= 0) table.sheet.getRange(decision._rowNumber, actionedAtCol + 1).setValue(new Date());
        if (detailsCol >= 0) table.sheet.getRange(decision._rowNumber, detailsCol + 1).setValue(actionDetails);
        Engine.Log.write(ctx, { stage: "DECISION", sheetName: "decision_log", rowIdx: decision._rowNumber, id: decision.ReviewID, type: "DECISION_APPLIED", details: actionDetails });
        table.sheet.deleteRow(decision._rowNumber);
        results.applied++;
      } catch (error) {
        if (statusCol >= 0) table.sheet.getRange(decision._rowNumber, statusCol + 1).setValue("FAILED");
        if (actionedAtCol >= 0) table.sheet.getRange(decision._rowNumber, actionedAtCol + 1).setValue(new Date());
        if (detailsCol >= 0) table.sheet.getRange(decision._rowNumber, detailsCol + 1).setValue(error.message);
        Engine.Log.write(ctx, { stage: "DECISION", sheetName: "decision_log", rowIdx: decision._rowNumber, id: decision.ReviewID, type: "DECISION_FAILED", details: error.message });
        results.failed++;
      }
    });
    return results;
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

function addPendingDecision(values) {
  return Engine.Decisions.addPending(Engine.getContext(), values);
}

function listPendingDecisions() {
  const pending = Engine.Decisions.pending(Engine.getContext());
  console.log(pending);
  return pending;
}

function applyPendingDecisions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Apply Reviewed Decisions");
  const results = Engine.Decisions.applyPending(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Apply Reviewed Decisions", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

function refreshDecisionLinks() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh Decision Row Links");
  const results = Engine.Decisions.refreshLinks(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh Decision Row Links", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}
