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
    const sheet = Engine.getSheetByRole(ctx, "DECISIONS");
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
    const sheet = Engine.getSheetByRole(ctx, "DECISIONS");
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

  reviewable: function(ctx) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const statusCol = this._col(table.map, "ActionStatus");
    return data.slice(1)
      .map((row, index) => ({ row: row, rowNumber: index + 2 }))
      .filter(item => {
        const status = statusCol < 0
          ? "PENDING"
          : String(item.row[statusCol] || "PENDING").trim().toUpperCase();
        return status === "PENDING" || status === "FAILED";
      })
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
    if (reviewedByCol >= 0) table.sheet.getRange(sheetRow, reviewedByCol + 1).setValue("Manual reviewer");
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

  archiveSuperseded: function(ctx) {
    const table = this.ensureSchema(ctx);
    const data = table.sheet.getDataRange().getValues();
    const statusCol = this._col(table.map, "ActionStatus");
    const reviewCol = this._col(table.map, "ReviewID");
    const detailsCol = this._col(table.map, "ActionDetails");
    const superseded = data.slice(1)
      .map((row, index) => ({ row: row, rowNumber: index + 2 }))
      .filter(item => String(item.row[statusCol] || "").trim().toUpperCase() === "SUPERSEDED")
      .sort((left, right) => right.rowNumber - left.rowNumber);

    superseded.forEach(item => {
      Engine.Log.write(ctx, {
        stage: "DECISION",
        sheetName: "decision_log",
        rowIdx: item.rowNumber,
        id: item.row[reviewCol],
        type: "DECISION_SUPERSEDED",
        details: item.row[detailsCol] || "Superseded decision archived from active queue."
      });
      table.sheet.deleteRow(item.rowNumber);
    });
    return { archived: superseded.length };
  },

  _setLinkedValue: function(ctx, sheet, rowNumber, column, sheetName, targetRow, label) {
    if (column < 0) return;
    if (targetRow) {
      sheet.getRange(rowNumber, column + 1).setFormula(Engine.makeSheetRowLink(ctx, sheetName, targetRow, label));
    } else {
      sheet.getRange(rowNumber, column + 1).setValue(label || "");
    }
  },

  refreshLinks: function(ctx) {
    const table = this.ensureSchema(ctx);
    const resolveParentRow = parentID => {
      const pRole = Engine.Roles.resolve(ctx, "PARENT");
      const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
      const parentMap = ctx.getMap(pRole);
      const idColumn = Engine.getColumnIndex(parentMap, "parentID");
      if (!parentSheet || idColumn < 0 || !parentID) return null;
      const data = parentSheet.getDataRange().getValues();
      const rowIndex = data.findIndex((row, index) => index > 0 && String(row[idColumn]) === String(parentID));
      return rowIndex >= 0 ? rowIndex + 1 : null;
    };

    const sourceIdCol = this._col(table.map, "SourceID");
    const candidateIdCol = this._col(table.map, "CandidateID");
    const parentTitleCol = this._col(table.map, "ParentTitle");
    const candidateTitleCol = this._col(table.map, "CandidateTitle");
    const existingParentIdCol = this._col(table.map, "ExistingParentID");
    const duplicateParentIdCol = this._col(table.map, "DuplicateParentID");
    const keepParentIdCol = this._col(table.map, "KeepParentID");
    const sourceLinkCol = this._col(table.map, "SourceLink");
    const candidateLinkCol = this._col(table.map, "CandidateLink");
    const sourceRowCol = this._col(table.map, "SourceRow");
    const candidateRowCol = this._col(table.map, "CandidateRow");
    let linked = 0;
    let cleared = 0;

    this.pending(ctx).forEach(decision => {
      const reviewType = String(decision.ReviewType || "");
      const isParentDuplicate = reviewType === "PARENT_DUPLICATE";
      const isParentLineupCandidate = String(decision.CandidateSheet || "") === "Parent Lineup";
      if (!isParentDuplicate && !isParentLineupCandidate) return;

      if (isParentDuplicate) {
        const sourceRow = resolveParentRow(decision.SourceID);
        if (sourceRow) {
          table.sheet.getRange(decision._rowNumber, sourceRowCol + 1).setValue(sourceRow);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, sourceIdCol, "Parent Lineup", sourceRow, decision.SourceID);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, parentTitleCol, "Parent Lineup", sourceRow, decision.ParentTitle);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, existingParentIdCol, "Parent Lineup", sourceRow, decision.ExistingParentID);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, keepParentIdCol, "Parent Lineup", sourceRow, decision.KeepParentID);
          if (sourceLinkCol >= 0) table.sheet.getRange(decision._rowNumber, sourceLinkCol + 1).clearContent();
          linked++;
        } else {
          cleared++;
        }
      }

      const candidateRow = resolveParentRow(decision.CandidateID);
      if (candidateRow) {
        table.sheet.getRange(decision._rowNumber, candidateRowCol + 1).setValue(candidateRow);
        this._setLinkedValue(ctx, table.sheet, decision._rowNumber, candidateIdCol, "Parent Lineup", candidateRow, decision.CandidateID);
        this._setLinkedValue(ctx, table.sheet, decision._rowNumber, candidateTitleCol, "Parent Lineup", candidateRow, decision.CandidateTitle);
        if (isParentDuplicate) {
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, duplicateParentIdCol, "Parent Lineup", candidateRow, decision.DuplicateParentID);
        } else {
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, parentTitleCol, "Parent Lineup", candidateRow, decision.ParentTitle);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, existingParentIdCol, "Parent Lineup", candidateRow, decision.ExistingParentID);
          this._setLinkedValue(ctx, table.sheet, decision._rowNumber, keepParentIdCol, "Parent Lineup", candidateRow, decision.KeepParentID);
        }
        if (candidateLinkCol >= 0) table.sheet.getRange(decision._rowNumber, candidateLinkCol + 1).clearContent();
        linked++;
      } else {
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

// A live PENDING row or an unresolved FAILED row both represent an
  // active, unresolved decision for this pair. Don't create a second
  // row until the existing one is superseded, applied, or rejected
  // (all of which either delete the row or change its ReviewID
  // eligibility). SUPERSEDED rows are historical and intentionally
  // NOT blocking here — a superseded pair may legitimately re-match
  // on fresh evidence.
  const blockingStatuses = ["PENDING", "FAILED"];
  const existing = data.slice(1).some(row =>
    String(row[reviewCol] || "") === String(values.ReviewID || "") &&
    blockingStatuses.includes(String(row[statusCol] || "PENDING").trim().toUpperCase())
    );
    if (existing) return false;

    const indices = Object.keys(table.map).map(fieldName => this._col(table.map, fieldName)).filter(index => index >= 0);
    const row = new Array(Math.max(...indices) + 1).fill("");
    Object.keys(values).forEach(fieldName => {
      const index = this._col(table.map, fieldName);
      if (index >= 0) row[index] = values[fieldName];
    });

    const setLinkedFields = (sheetField, rowField, fieldNames) => {
      const sheetName = values[sheetField] || "";
      const rowNumber = values[rowField];
      if (!sheetName || !rowNumber) return;
      fieldNames.forEach(fieldName => {
        const index = this._col(table.map, fieldName);
        const label = values[fieldName] || "";
        if (index >= 0 && label) row[index] = Engine.makeSheetRowLink(ctx, sheetName, rowNumber, label);
      });
    };

    setLinkedFields("SourceSheet", "SourceRow", ["SourceID", "ImportTitle"]);
    setLinkedFields("CandidateSheet", "CandidateRow", ["CandidateID", "CandidateTitle"]);
    if (String(values.ReviewType || "") === "PARENT_DUPLICATE") {
      setLinkedFields("SourceSheet", "SourceRow", ["ParentTitle", "ExistingParentID", "KeepParentID"]);
      setLinkedFields("CandidateSheet", "CandidateRow", ["DuplicateParentID"]);
    } else {
      setLinkedFields("CandidateSheet", "CandidateRow", ["ParentTitle", "ExistingParentID", "KeepParentID"]);
    }

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

  stampManualReviews: function(ctx) {
    const table = this.ensureSchema(ctx);
    const decisions = this.pending(ctx);
    const reviewedByCol = this._col(table.map, "ReviewedBy");
    const reviewedAtCol = this._col(table.map, "ReviewedAt");
    const notesCol = this._col(table.map, "ReviewNotes");
    let stamped = 0;

    decisions.forEach(decision => {
      const userDecision = String(decision.Decision || "PENDING").trim().toUpperCase();
      if (userDecision === "PENDING" || userDecision === "DEFERRED") return;
      if (reviewedByCol >= 0 && !decision.ReviewedBy) {
        table.sheet.getRange(decision._rowNumber, reviewedByCol + 1).setValue("Manual reviewer");
        stamped++;
      }
      if (reviewedAtCol >= 0 && !decision.ReviewedAt) {
        table.sheet.getRange(decision._rowNumber, reviewedAtCol + 1).setValue(new Date());
      }
      if (notesCol >= 0 && !decision.ReviewNotes) {
        table.sheet.getRange(decision._rowNumber, notesCol + 1).setValue(`Manual decision: ${userDecision}`);
      }
    });
    return { stamped: stamped };
  },

  applyPending: function(ctx) {
    const table = this.ensureSchema(ctx);
    this.stampManualReviews(ctx);
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
        } else if (action === "REVIEW_IMPORT_DRIFT" && ["ACCEPT", "ACCEPT_IMPORT"].includes(userDecision)) {
          if (!decision.ExistingParentID || !Engine.Ingest.acceptImportDrift(ctx, decision.ExistingParentID, { force: true })) {
            throw new Error("Import row could not be resolved for the selected Parent Lineup row");
          }
          actionDetails = `Accepted import changes for ${decision.ExistingParentID}`;
        } else if (action === "REVIEW_PARENT_ONLY") {
          // REVIEW_PARENT_ONLY has no automatic data mutation — the parent row
          // exists without a matching import row.  The reviewer's decision
          // (ACCEPT / REJECTED / NOT_DUPLICATE / DEFERRED) is the final
          // disposition and the decision row should be closed out.
          if (userDecision === "REJECTED") {
            actionDetails = "Parent-only row rejected for retention; no data change.";
          } else if (userDecision === "NOT_DUPLICATE") {
            actionDetails = "Reviewer confirmed parent-only row is not a duplicate; retained as-is.";
          } else if (userDecision === "ACCEPT") {
            actionDetails = "Parent-only row retained (no import source); decision closed.";
          } else {
            results.skipped++;
            return;
          }
        } else if (["REVIEW_IMPORT_DRIFT", "REVIEW_DUPLICATE", "REJECT_MATCH", "MARK_BYPASS", "MARK_DELETE", "REVIEW_DATE_SPAN"].includes(action)) {
          actionDetails = `Recorded decision ${userDecision}; no automatic data change for ${action}`;
        } else if (action === "ACCEPT_IMPORT") {
          if (!["ACCEPT", "ACCEPT_IMPORT"].includes(userDecision)) throw new Error("ACCEPT_IMPORT requires Decision=ACCEPT");
          if (!decision.ExistingParentID) throw new Error("ACCEPT_IMPORT requires ExistingParentID");
          if (!Engine.Ingest.acceptImportDrift(ctx, decision.ExistingParentID, { force: true })) {
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

function archiveSupersededDecisions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Archive Superseded Decisions");
  const results = Engine.Decisions.archiveSuperseded(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Archive Superseded Decisions", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

function refreshDecisionLinks() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh Decision Row Links");
  const results = Engine.Decisions.refreshLinks(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh Decision Row Links", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}
