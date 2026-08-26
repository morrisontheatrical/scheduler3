// At the top of engine_calendar.gs, engine_sync.gs, etc.
var Engine = Engine || {};

/**
 * STAGE 1 & 2: Moves data from 'import' to 'Parent Lineup'.
 * Fixes: ReferenceError by initializing 'ctx'.
 */
function goParent() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Ingest Season");
  const ss = ctx.ss;
  const iSheet = ss.getSheetByName("import");
  const pSheet = ss.getSheetByName("Parent Lineup");
 
  if (!iSheet || !pSheet) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Import or Parent Lineup sheet not found.", "Error");
    return;
  }
 
  const iMap = ctx.getMap("import");
  const pMap = ctx.getMap("Parent Lineup");
  const iData = iSheet.getDataRange().getValues();
  const pData = pSheet.getDataRange().getValues();
 
  iData.shift();
  pData.shift();
 
  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const pWidth = Math.max(...Object.keys(pMap).map(fieldName => pCol(fieldName)).filter(index => index >= 0)) + 1;
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
 
  // Source fields mirror import. System fields are maintained by this
  // operation so every successful import pass has a visible audit state.
  const sourceFields = Engine.Ingest.getParentSourceFields(iMap, pMap);

  // ── "Delete Pending" pre-pass ──
  // User-marked deletions are applied as part of the ingest pass (documented
  // in OPERATIONS.md). Deleted bottom-up so row numbers stay valid, and each
  // pending decision referencing that parentID is superseded with an audit
  // entry before the row is removed.
  let deletedPending = 0;
  if (pCol("SyncStatus") >= 0) {
    const allRows = pSheet.getDataRange().getValues();
    const toDelete = [];
    allRows.forEach((row, idx) => {
      if (idx > 0 && String(row[pCol("SyncStatus")] || "").trim() === "Delete Pending") {
        toDelete.push({ row: row, rowNumber: idx + 1 });
      }
    });
    toDelete.sort((a, b) => b.rowNumber - a.rowNumber).forEach(item => {
      const parentID = item.row[pCol("parentID")] || "";
      const title = item.row[pCol("EventName")] || "";
      if (Engine.Decisions && typeof Engine.Decisions.pending === "function") {
        Engine.Decisions.pending(ctx)
          .filter(d => d.ExistingParentID === parentID || d.KeepParentID === parentID || d.DuplicateParentID === parentID)
          .forEach(d => Engine.Decisions.markSuperseded(ctx, d.ReviewID, "Parent row deleted by user (status Delete Pending)."));
      }
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: "Parent Lineup",
        rowIdx: item.rowNumber,
        id: parentID,
        type: "DELETE_PENDING_APPLIED",
        details: `Row deleted from Parent Lineup per user status Delete Pending. ${title}`
      });
      pSheet.deleteRow(item.rowNumber);
      deletedPending++;
    });
  }

  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });
 
  let created = 0, updated = 0, flaggedForReview = 0;
 
  iData.forEach(iRow => {
    const eventName = iRow[iCol("EventName")];
    if (!eventName) return;
 
    let match = pByName[normalize(eventName)];
    let isRenameCandidate = false;
 
    if (!match) {
      // Same conservative fallback verifyImportToParent() already uses:
      // only treat this as the same event if Opening+Range+Venue all agree
      // AND exactly one Parent Lineup row qualifies. Anything less certain
      // falls through to "genuinely new event" below, on purpose.
      const candidates = pData
        .map((row, rowIdx) => ({ row: row, rowIdx: rowIdx + 2 }))
        .filter(candidate => ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iRow[iIdx]) === normalize(candidate.row[pIdx]);
        }));
      if (candidates.length === 1) {
        match = candidates[0];
        isRenameCandidate = true;
      }
    }
 
    if (!match) {
      // Genuinely new event — mint a new parentID. This is now the ONLY
      // path that creates one.
      const rowArray = new Array(pWidth).fill("");
      sourceFields.forEach(fieldName => {
        rowArray[pCol(fieldName)] = iRow[iCol(fieldName)];
      });
      rowArray[pCol("parentID")] = "P-" + Utilities.getUuid().split('-')[0].toUpperCase();
      rowArray[pCol("SyncStatus")] = "Active";
      if (pCol("LastSynced") >= 0) rowArray[pCol("LastSynced")] = new Date();
      if (pCol("LastUpdated") >= 0) rowArray[pCol("LastUpdated")] = new Date();
      pSheet.appendRow(rowArray);
      Engine.Ingest._writeParentIdentity(ctx, pSheet.getLastRow(), rowArray, pMap);
      created++;
      return;
    }
 
    if (isRenameCandidate) {
      // Ambiguous — don't auto-merge a rename. Flag it exactly like
      // verifyImportToParent() does, and leave the actual merge to
      // Engine.Ingest.acceptImportDrift(). The existing parentID and row
      // are left completely alone otherwise.
      const statusCol = pCol("SyncStatus");
      if (statusCol >= 0) pSheet.getRange(match.rowIdx, statusCol + 1).setValue("Manual Review");
      flaggedForReview++;
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: "Parent Lineup",
        rowIdx: match.rowIdx,
        id: match.row[pCol("parentID")],
        type: "RENAME_CANDIDATE",
        details: `Possible renamed event: import "${eventName}" vs Parent Lineup "${match.row[pCol("EventName")]}". Not auto-merged — use Engine.Ingest.acceptImportDrift() to apply.`
      });
      return;
    }
 
    // Clean match by name — this is what Sheet_Settings.SheetBehavior
    // "MIRROR" means for Parent Lineup: safe to auto-apply Source
    // (Read-Only) field changes. Only the fields that actually differ get
    // written, and only fields tagged Source (Read-Only) are touched at all.
    let changed = false;
    sourceFields.forEach(fieldName => {
      const newVal = iRow[iCol(fieldName)];
      const colIdx = pCol(fieldName);
      if (!Engine.Ingest.sourceValuesEqual(ctx, fieldName, match.row[colIdx], newVal)) {
        pSheet.getRange(match.rowIdx, colIdx + 1).setValue(newVal);
        changed = true;
      }
    });
    const now = new Date();
    if (pCol("LastSynced") >= 0) pSheet.getRange(match.rowIdx, pCol("LastSynced") + 1).setValue(now);
    if (changed && pCol("LastUpdated") >= 0) pSheet.getRange(match.rowIdx, pCol("LastUpdated") + 1).setValue(now);
    if (pCol("SyncStatus") >= 0) pSheet.getRange(match.rowIdx, pCol("SyncStatus") + 1).setValue("Active");
    if (changed) updated++;
  });
 
  Engine.Log.write(ctx, {
    stage: "INGEST",
    type: "SUCCESS",
    details: `Parent Lineup Updated: ${created} created, ${updated} updated, ${flaggedForReview} flagged for manual review (rename candidates), ${deletedPending} "Delete Pending" row(s) removed.`
  });
  const results = { created: created, updated: updated, flaggedForReview: flaggedForReview, deletedPending: deletedPending };
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Ingest Season", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

Engine.Ingest = Engine.Ingest || {};

Engine.Ingest.getParentSourceFields = function(iMap, pMap) {
  const canonicalFields = [
    "EventName", "Series", "Opening", "Range", "DatesAndTimes", "Venue", "Pricing", "Pit"
  ];
  const registrySourceFields = Object.keys(iMap || {}).filter(fieldName =>
    Engine.getSyncBehavior(iMap, fieldName) === "Source (Read-Only)" &&
    Engine.getColumnIndex(pMap, fieldName) >= 0
  );
  if (registrySourceFields.length) return registrySourceFields;

  return canonicalFields.filter(fieldName =>
    Engine.getColumnIndex(iMap, fieldName) >= 0 && Engine.getColumnIndex(pMap, fieldName) >= 0
  );
};

Engine.Ingest.sourceValuesEqual = function(ctx, fieldName, left, right) {
  const normalize = value => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      const pattern = fieldName === "Opening" ? "M/d/yyyy" : "M/d";
      return Utilities.formatDate(value, ctx.timeZone, pattern);
    }
    return String(value === null || value === undefined ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ");
  };
  return normalize(left) === normalize(right);
};

Engine.Ingest._writeParentIdentity = function(ctx, rowNumber, rowArray, pMap) {
  const identity = Engine.getLibraryModule("Identity");
  const hashCol = Engine.getColumnIndex(pMap, "SyncHash");
  if (!identity || hashCol < 0 || typeof identity.generate !== "function") return;
  const titleCol = Engine.getColumnIndex(pMap, "EventName");
  const dateCol = Engine.getColumnIndex(pMap, "DatesAndTimes");
  const venueCol = Engine.getColumnIndex(pMap, "Venue");
  const generated = identity.generate({
    title: titleCol >= 0 ? rowArray[titleCol] : "",
    date: dateCol >= 0 ? rowArray[dateCol] : "",
    time: "",
    venue: venueCol >= 0 ? rowArray[venueCol] : ""
  });
  if (generated && generated.hash) ctx.ss.getSheetByName("Parent Lineup").getRange(rowNumber, hashCol + 1).setValue(generated.hash);
};

Engine.Ingest.resolveParentDuplicates = function(ctx, options) {
  options = options || {};
  const sheet = ctx.ss.getSheetByName("Parent Lineup");
  const map = ctx.getMap("Parent Lineup");
  if (!sheet || !map) return { groups: [], merged: 0 };
  const col = field => Engine.getColumnIndex(map, field);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1).map((row, index) => ({ row: row, rowNumber: index + 2 }));
  const groups = {};
  rows.forEach(item => {
    const key = ["Opening", "Range", "Venue"].map(field => normalize(col(field) >= 0 ? item.row[col(field)] : "")).join("|");
    if (key !== "||") (groups[key] = groups[key] || []).push(item);
  });
  const duplicateGroups = Object.values(groups).filter(group => group.length > 1);
  let merged = 0;
  duplicateGroups.forEach(group => {
    const keep = group.slice().sort((a, b) => a.rowNumber - b.rowNumber)[0];
    const duplicates = group.filter(item => item !== keep);
    duplicates.forEach(item => {
      Engine.Log.write(ctx, {
        stage: "INGEST", sheetName: "Parent Lineup", rowIdx: item.rowNumber,
        id: item.row[col("parentID")], type: "PARENT_DUPLICATE",
        details: `Duplicate candidate for ${keep.row[col("parentID")]}; retained earliest row ${keep.rowNumber}.`
      });
      if (options.merge === true) {
        const statusCol = col("SyncStatus");
        if (statusCol >= 0) sheet.getRange(item.rowNumber, statusCol + 1).setValue("Manual Review");
        merged++;
      }
    });
  });
  return { groups: duplicateGroups.map(group => group.map(item => item.rowNumber)), merged: merged };
};

Engine.Ingest.buildParentDuplicateSuggestions = function(ctx, options) {
  options = options || {};
  const sheet = ctx.ss.getSheetByName("Parent Lineup");
  const map = ctx.getMap("Parent Lineup");
  if (!sheet || !map) return { created: 0, suggested: 0 };

  const col = field => Engine.getColumnIndex(map, field);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const compact = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const similarity = (a, b) => {
    const left = compact(a);
    const right = compact(b);
    if (!left || !right) return 0;
    if (left === right) return 100;
    if (left.includes(right) || right.includes(left)) return 80;
    const leftWords = left.split(/\s+/).filter(Boolean);
    const rightWords = right.split(/\s+/).filter(Boolean);
    if (!leftWords.length || !rightWords.length) return 0;
    const overlap = leftWords.filter(word => rightWords.includes(word)).length;
    return Math.min(60, Math.round((overlap / Math.max(leftWords.length, rightWords.length)) * 100));
  };

  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    parentID: row[col("parentID")],
    EventName: row[col("EventName")],
    Opening: row[col("Opening")],
    Range: row[col("Range")],
    Venue: row[col("Venue")]
  })).filter(item => item.parentID);

  let created = 0;
  let suggested = 0;
  const seen = {};

  rows.forEach(current => {
    if (seen[current.parentID]) return;
    let best = null;

    rows.forEach(candidate => {
      if (candidate.parentID === current.parentID) return;
      let score = 0;
      const reasons = [];

      const titleScore = similarity(current.EventName, candidate.EventName);
      if (titleScore > 0) {
        score += titleScore;
        reasons.push(`title ${titleScore}%`);
      }

      if (normalize(current.Venue) && normalize(current.Venue) === normalize(candidate.Venue)) {
        score += 25;
        reasons.push("same venue");
      }
      if (normalize(current.Opening) && normalize(current.Opening) === normalize(candidate.Opening)) {
        score += 20;
        reasons.push("same opening");
      }
      if (normalize(current.Range) && normalize(current.Range) === normalize(candidate.Range)) {
        score += 20;
        reasons.push("same range");
      }

      const sameOpening = normalize(current.Opening) && normalize(current.Opening) === normalize(candidate.Opening);
      const sameVenue = normalize(current.Venue) && normalize(current.Venue) === normalize(candidate.Venue);
      if (sameOpening && sameVenue) score += 30;

      // Placeholder titles and a shared venue are not duplicate evidence by
      // themselves. Parent merges require the same full opening date and venue.
      if (sameOpening && sameVenue && score >= 60) {
        const candidateItem = {
          parentID: candidate.parentID,
          rowNumber: candidate.rowNumber,
          eventName: candidate.EventName,
          score: score,
          reasons: reasons.join(", ")
        };
        if (!best || candidateItem.score > best.score) best = candidateItem;
      }
    });

    if (!best) return;
    suggested++;
    const reviewID = `PARENT_DUPLICATE_${current.parentID}_${best.parentID}`;
    const values = {
      ReviewID: reviewID,
      ReviewType: "PARENT_DUPLICATE",
      SourceSheet: "Parent Lineup",
      SourceRow: current.rowNumber,
      SourceID: current.parentID,
      SourceLink: Engine.makeSheetRowLink(ctx, "Parent Lineup", current.rowNumber, `Row ${current.rowNumber}`),
      CandidateSheet: "Parent Lineup",
      CandidateRow: best.rowNumber,
      CandidateID: best.parentID,
      CandidateLink: Engine.makeSheetRowLink(ctx, "Parent Lineup", best.rowNumber, `Row ${best.rowNumber}`),
      ParentTitle: current.EventName,
      CandidateTitle: best.eventName,
      ExistingParentID: current.parentID,
      DuplicateParentID: best.parentID,
      Confidence: best.score >= 80 ? "HIGH" : "MEDIUM",
      Decision: "PENDING",
      RequestedAction: "MERGE_PARENT",
      KeepChoice: "KEEP_EXISTING",
      KeepParentID: current.parentID,
      SuggestedAction: "MERGE_PARENT",
      SuggestionReason: `Likely duplicate match score ${best.score}% (${best.reasons})`,
      SuggestedKeepID: current.parentID,
      CandidateIDs: best.parentID,
      MatchedFields: best.reasons,
      ChangedFields: "EventName, Series, Opening, Range, DatesAndTimes, Venue, Pricing, Pit",
      ChangedDetails: `Likely duplicate of ${best.parentID} based on ${best.reasons}`,
      Evidence: `Opening=${current.Opening}, Range=${current.Range}, Venue=${current.Venue}`,
      ActionStatus: "PENDING"
    };

    if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
      const inserted = Engine.Decisions.addPending(ctx, values);
      if (inserted) created++;
    }
    seen[current.parentID] = true;
    seen[best.parentID] = true;
  });

  return { created: created, suggested: suggested };
};

Engine.Ingest.buildParentOnlyReplacementSuggestions = function(ctx) {
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
  if (!parentSheet || !parentMap || !Engine.Decisions) return { created: 0, suggested: 0 };

  const col = field => Engine.getColumnIndex(parentMap, field);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const dateValue = value => {
    if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
  };
  const isPlaceholder = title => /\b(title|tbd|show|musical)\b/i.test(String(title || ""));
  const rows = parentSheet.getDataRange().getValues().slice(1).map((row, index) => ({
    rowNumber: index + 2,
    parentID: row[col("parentID")],
    title: row[col("EventName")],
    series: row[col("Series")],
    opening: row[col("Opening")],
    range: row[col("Range")],
    venue: row[col("Venue")]
  })).filter(item => item.parentID);

  let created = 0;
  let suggested = 0;
  Engine.Decisions.reviewable(ctx)
    .filter(decision => String(decision.ReviewID || "").startsWith("PARENT_ONLY_"))
    .forEach(decision => {
      const current = rows.find(row => row.parentID === decision.ExistingParentID);
      if (!current || !isPlaceholder(current.title)) return;
      const currentDate = dateValue(current.opening);
      const candidates = rows.map(candidate => {
        if (candidate.parentID === current.parentID) return null;
        if (!normalize(current.series) || normalize(current.series) !== normalize(candidate.series)) return null;
        const candidateDate = dateValue(candidate.opening);
        if (!currentDate || !candidateDate) return null;
        const daysApart = Math.abs(currentDate - candidateDate) / (24 * 60 * 60 * 1000);
        if (daysApart > 45) return null;
        const sameVenue = normalize(current.venue) && normalize(current.venue) === normalize(candidate.venue);
        const score = 55 + (sameVenue ? 20 : 0) + Math.max(0, 20 - Math.round(daysApart));
        return { candidate: candidate, daysApart: Math.round(daysApart), sameVenue: sameVenue, score: score };
      }).filter(Boolean).sort((left, right) => right.score - left.score);
      const best = candidates[0];
      if (!best) return;

      suggested++;
      const reasons = [`same series (${current.series})`, `${best.daysApart} day date shift`];
      if (best.sameVenue) reasons.push("same venue");
      const inserted = Engine.Decisions.addPending(ctx, {
        ReviewID: `PARENT_REPLACEMENT_${current.parentID}_${best.candidate.parentID}`,
        ReviewType: "PARENT_REPLACEMENT",
        SourceSheet: "Parent Lineup",
        SourceRow: current.rowNumber,
        SourceID: current.parentID,
        CandidateSheet: "Parent Lineup",
        CandidateRow: best.candidate.rowNumber,
        CandidateID: best.candidate.parentID,
        ParentTitle: current.title,
        CandidateTitle: best.candidate.title,
        ExistingParentID: current.parentID,
        DuplicateParentID: best.candidate.parentID,
        MatchedFields: reasons.join(", "),
        ChangedFields: "EventName, Series, Opening, Range, DatesAndTimes, Venue, Pricing, Pit",
        ChangedDetails: `Placeholder Parent row may have been replaced by a named event: ${reasons.join(", ")}.`,
        Evidence: `Keeper: ${current.title} (${current.opening}, ${current.venue}) | Candidate: ${best.candidate.title} (${best.candidate.opening}, ${best.candidate.venue})`,
        Confidence: best.sameVenue ? "MEDIUM" : "LOW",
        SuggestedAction: "MERGE_PARENT",
        SuggestionReason: `Possible title replacement; retain ${current.parentID} and copy source values from ${best.candidate.parentID}.`,
        SuggestedKeepID: current.parentID,
        CandidateIDs: best.candidate.parentID,
        Decision: "PENDING",
        RequestedAction: "MERGE_PARENT",
        KeepChoice: "KEEP_EXISTING",
        KeepParentID: current.parentID,
        ActionStatus: "PENDING"
      });
      if (inserted) created++;
    });
  return { created: created, suggested: suggested };
};

Engine.Ingest.applyConfirmedParentMerges = function(ctx) {
  const decisionSheet = ctx.ss.getSheetByName("decision_log");
  const table = Engine.Decisions && Engine.Decisions.ensureSchema ? Engine.Decisions.ensureSchema(ctx) : null;
  if (!decisionSheet || !table) return { applied: 0, failed: 0 };

  const pending = Engine.Decisions.reviewable(ctx).filter(item => {
    const decision = String(item.Decision || "").trim().toUpperCase();
    const action = String(item.RequestedAction || "").trim().toUpperCase();
    return ["ACCEPT", "CONFIRMED_DUPLICATE"].includes(decision) && action === "MERGE_PARENT";
  });

  let applied = 0;
  let failed = 0;
  pending.forEach(decision => {
    try {
      const selection = Engine.Decisions.resolveMergeSelection(decision);
      const keepID = selection.keepID;
      const duplicateID = selection.duplicateID;
      if (!keepID || !duplicateID) {
        throw new Error("MERGE_PARENT requires KeepParentID and DuplicateParentID");
      }
      const mergeResult = Engine.Ingest.mergeParentDuplicate(ctx, keepID, duplicateID);
      const statusCol = Engine.getColumnIndex(table.map, "ActionStatus");
      const actionedCol = Engine.getColumnIndex(table.map, "ActionedAt");
      const detailsCol = Engine.getColumnIndex(table.map, "ActionDetails");
      if (statusCol >= 0) table.sheet.getRange(decision._rowNumber, statusCol + 1).setValue("APPLIED");
      if (actionedCol >= 0) table.sheet.getRange(decision._rowNumber, actionedCol + 1).setValue(new Date());
      if (detailsCol >= 0) table.sheet.getRange(decision._rowNumber, detailsCol + 1).setValue(`Merged ${duplicateID} into ${keepID}; copied ${mergeResult.copiedFields.join(", ") || "no"} source fields`);
      table.sheet.deleteRow(decision._rowNumber);
      applied++;
    } catch (error) {
      const statusCol = Engine.getColumnIndex(table.map, "ActionStatus");
      const actionedCol = Engine.getColumnIndex(table.map, "ActionedAt");
      const detailsCol = Engine.getColumnIndex(table.map, "ActionDetails");
      if (statusCol >= 0) table.sheet.getRange(decision._rowNumber, statusCol + 1).setValue("FAILED");
      if (actionedCol >= 0) table.sheet.getRange(decision._rowNumber, actionedCol + 1).setValue(new Date());
      if (detailsCol >= 0) table.sheet.getRange(decision._rowNumber, detailsCol + 1).setValue(error.message);
      failed++;
    }
  });

  return { applied: applied, failed: failed };
};

Engine.Ingest.mergeParentDuplicate = function(ctx, keepParentID, duplicateParentID) {
  if (!keepParentID || !duplicateParentID || keepParentID === duplicateParentID) {
    throw new Error("mergeParentDuplicate requires two different parent IDs");
  }

  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map not found");
  const parentIdCol = Engine.getColumnIndex(parentMap, "parentID");
  const parentData = parentSheet.getDataRange().getValues();
  const duplicateRow = parentData.findIndex((row, index) => index > 0 && row[parentIdCol] === duplicateParentID);
  if (duplicateRow < 0) throw new Error(`Duplicate Parent Lineup row not found: ${duplicateParentID}`);
  const keepRow = parentData.findIndex((row, index) => index > 0 && row[parentIdCol] === keepParentID);
  if (keepRow < 0) throw new Error(`Keeper Parent Lineup row not found: ${keepParentID}`);

  const keepValues = parentData[keepRow];
  const duplicateValues = parentData[duplicateRow];
  const sourceFields = [...new Set([
    "EventName", "Series", "Opening", "Range", "DatesAndTimes", "Venue", "Pricing", "Pit",
    ...Object.keys(parentMap).filter(fieldName => Engine.getSyncBehavior(parentMap, fieldName) === "Source (Read-Only)")
  ])].filter(fieldName => Engine.getColumnIndex(parentMap, fieldName) >= 0);
  const copiedFields = [];
  sourceFields.forEach(fieldName => {
    const column = Engine.getColumnIndex(parentMap, fieldName);
    const sourceValue = duplicateValues[column] === null || duplicateValues[column] === undefined
      ? ""
      : duplicateValues[column];
    const existingValue = keepValues[column] === null || keepValues[column] === undefined
      ? ""
      : keepValues[column];
    if (String(existingValue) === String(sourceValue)) return;
    parentSheet.getRange(keepRow + 1, column + 1).setValue(sourceValue);
    copiedFields.push(fieldName);
  });

  const changedLocations = [];
  Object.keys(ctx.sheetDefs || {}).forEach(sheetName => {
    const map = ctx.getMap(sheetName);
    const sheet = ctx.ss.getSheetByName(sheetName);
    const col = Engine.getColumnIndex(map, "parentID");
    if (!sheet || col < 0 || sheetName === "Parent Lineup") return;
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][col] === duplicateParentID) {
        sheet.getRange(i + 1, col + 1).setValue(keepParentID);
        changedLocations.push(`${sheetName}!R${i + 1}`);
      }
    }
  });

  const idLog = ctx.sheets.ID_LOG;
  const idMap = ctx.maps.ID_LOG;
  const idCol = Engine.getColumnIndex(idMap, "UniqueID");
  const idStatusCol = Engine.getColumnIndex(idMap, "SyncStatus");
  const idDetailsCol = Engine.getColumnIndex(idMap, "LogDetails");
  const idData = idLog && idLog.getDataRange().getValues();
  if (idData && idCol >= 0) {
    const idRow = idData.findIndex((row, index) => index > 0 && row[idCol] === duplicateParentID);
    if (idRow >= 0) {
      if (idStatusCol >= 0) idLog.getRange(idRow + 1, idStatusCol + 1).setValue("Merged");
      if (idDetailsCol >= 0) idLog.getRange(idRow + 1, idDetailsCol + 1).setValue(`Merged into ParentID ${keepParentID}`);
    }
  }

  const syncStatusCol = Engine.getColumnIndex(parentMap, "SyncStatus");
  const lastSyncedCol = Engine.getColumnIndex(parentMap, "LastSynced");
  const lastUpdatedCol = Engine.getColumnIndex(parentMap, "LastUpdated");
  const updateDetailsCol = Engine.getColumnIndex(parentMap, "UpdateDetails");
  const now = new Date();
  if (syncStatusCol >= 0) parentSheet.getRange(keepRow + 1, syncStatusCol + 1).setValue("Active");
  if (lastSyncedCol >= 0) parentSheet.getRange(keepRow + 1, lastSyncedCol + 1).setValue(now);
  if (lastUpdatedCol >= 0) parentSheet.getRange(keepRow + 1, lastUpdatedCol + 1).setValue(now);
  if (updateDetailsCol >= 0) {
    parentSheet.getRange(keepRow + 1, updateDetailsCol + 1).setValue(
      `Merged ${duplicateParentID}; imported source fields: ${copiedFields.join(", ") || "none"}`
    );
  }

  parentSheet.deleteRow(duplicateRow + 1);
  Engine.Log.write(ctx, {
    stage: "INGEST",
    sheetName: "Parent Lineup",
    id: duplicateParentID,
    type: "PARENT_DUPLICATE_MERGED",
    details: `Merged into ${keepParentID}. Copied source fields: ${copiedFields.join(", ") || "none"}. Repointed ${changedLocations.length} dependent row(s).`
  });
  return {
    keepParentID: keepParentID,
    duplicateParentID: duplicateParentID,
    copiedFields: copiedFields,
    changedLocations: changedLocations
  };
};

function mergeParentDuplicate(keepParentID, duplicateParentID) {
  return Engine.Ingest.mergeParentDuplicate(Engine.getContext(), keepParentID, duplicateParentID);
}

function resolveParentDuplicates(merge) {
  const ctx = Engine.getContext();
  return Engine.Ingest.resolveParentDuplicates(ctx, { merge: Boolean(merge) });
}

function generateParentDuplicateSuggestions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Generate Parent Duplicate Suggestions");
  const results = Engine.Ingest.buildParentDuplicateSuggestions(ctx, {});
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Generate Parent Duplicate Suggestions", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

function applyConfirmedParentMerges() {
  const ctx = Engine.getContext();
  return Engine.Ingest.applyConfirmedParentMerges(ctx);
}

/**
 * STAGE 3: Explodes Parent Lineup into individual events in the Lineup sheet.
 */
function goLineup() {
  const ctx = Engine.getContext();
  const ss = ctx.ss;

  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");

  const pSheet = ctx.sheets[pRole] || ss.getSheetByName(ctx.getRole(pRole));
  const lSheet = ctx.sheets[lRole] || ss.getSheetByName(ctx.getRole(lRole));

  const pMap = ctx.getMap(pRole);
  const lMap = ctx.getMap(lRole);

  if (!pSheet || !lSheet || !pMap || !lMap) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Parent Lineup or Lineup sheet/map not found.", "Error");
    return;
  }
  
  const pData = pSheet.getDataRange().getValues();
  const lData = lSheet.getDataRange().getValues();

  pData.shift();

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const lWidth = Math.max(...Object.keys(lMap).map(fieldName => lCol(fieldName)).filter(index => index >= 0)) + 1;
  const spanOverrideCol = pCol("SpanOverride");

  // ...rest is unchanged — everything downstream already goes through pCol/lCol

  const existingRecords = {};
  lData.forEach((row, idx) => {
    const key = `${row[lCol("parentID")]}|${row[lCol("RawDateStr")]}`;
    existingRecords[key] = { rowIdx: idx + 1, uuid: row[lCol("UUID")] };
  });

  pData.forEach((pRow, idx) => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    if (!parentID || !rawDates) return;

    const rowIdx = idx + 2;
    const parsedDates = Engine.Ingest.parseParentDatesAndTimes(rawDates);

    if (parsedDates.dates.length === 0 && parsedDates.spans.length === 0) {
      Engine.Log.write(ctx, {
        stage: "INGEST", sheetName: "Parent Lineup", rowIdx: rowIdx, id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || "unknown format"}`
      });
      return;
    }

    // Build the final set of Lineup entries this row should produce.
    const entries = parsedDates.dates.map(d => ({ date: d, endDate: null }));

    parsedDates.spans.forEach(span => {
      const override = spanOverrideCol >= 0 ? String(pRow[spanOverrideCol] || "").trim().toUpperCase() : "";
      const policy = override || ctx.mode.spanDatePolicy || "BYPASS";

      if (policy === "MULTI_DAY") {
        entries.push({ date: span.start, endDate: span.end });
        return;
      }

      if (policy === "DAY_BY_DAY") {
        for (let d = new Date(span.start); d <= span.end; d.setDate(d.getDate() + 1)) {
          entries.push({ date: new Date(d), endDate: null });
        }
        return;
      }

      // BYPASS, or an unrecognized policy value — fail safe to manual review
      // rather than guessing what the operator wanted.
      Engine.Status.apply(ctx, "Parent Lineup", rowIdx, "Date Span - Manual Review", {
        stage: "INGEST",
        id: parentID,
        details: `Span not exploded (policy: ${policy}): ${span.raw}`
      });
    });

    if (entries.length === 0) return; // every span on this row was bypassed

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    entries.forEach((entry, index) => {
      const dateStr = Utilities.formatDate(entry.date, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm");
      const lookupKey = `${parentID}|${dateStr}`;
      const record = existingRecords[lookupKey];

      const rowArray = new Array(lWidth).fill("");
      rowArray[lCol("EventName")] = pRow[pCol("EventName")];
      rowArray[lCol("parentID")] = parentID;
      rowArray[lCol("Date")] = entry.date;
      rowArray[lCol("RawDateStr")] = dateStr;
      rowArray[lCol("EventOfTotal")] = `${index + 1} of ${entries.length}`;
      rowArray[lCol("Venue")] = pRow[pCol("Venue")];
      if (entry.endDate && lCol("EndDate") >= 0) rowArray[lCol("EndDate")] = entry.endDate;

      if (record) {
        rowArray[lCol("UUID")] = record.uuid;
        lSheet.getRange(record.rowIdx, 1, 1, rowArray.length).setValues([rowArray]);
      } else {
        rowArray[lCol("UUID")] = Utilities.getUuid();
        rowArray[lCol("SyncStatus")] = "Draft";
        lSheet.appendRow(rowArray);
      }
    });
  });

  const utils = Engine.getLibraryModule("Utils");
  if (utils && typeof utils.notify === "function") utils.notify("Lineup Explosion Complete", "Success");
}

/**
 * STAGE 4: Pushes exploded Lineup rows into the crew log.
 * Targets the "CREWCAL" role by default. Once a dedicated Draft Season sheet/role
 * exists, pass { targetRole: "DRAFTSEASON" } (or change the default below) — the map
 * lookups and status handling here don't need to change, only the role name.
 */
function goCrewLog(options) {
  const ctx = Engine.getContext();
  return Engine.Ingest.syncLineupToLog(ctx, options);
}

Engine.Ingest = Engine.Ingest || {};

/**
 * Parses the multiline DatesAndTimes cells used by Parent Lineup.
 */
Engine.Ingest.parseParentDatesAndTimes = function(rawDates) {
  const result = { dates: [], spans: [], errors: [] };
  const parserModule = Engine.getLibraryModule("TheatricalParser");
  const parser = parserModule && parserModule.parse;
  if (!parser || !rawDates) {
    if (rawDates) result.errors.push("Theatrical parser unavailable");
    return result;
  }

  const rawLines = String(rawDates)
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const lines = [];
  rawLines.forEach(line => {
    if (/^through\b/i.test(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`;
    } else {
      lines.push(line);
    }
  });

  lines.forEach(line => {
    if (/^\(.*\)$/.test(line)) return; // parenthetical annotation, not a date

    const content = line.replace(/^(Performance|Session\s*\d+|Sensory-Friendly Performance|School Performance)\s*:\s*/i, "").trim();
    if (!content || /^(Performance|Session\s*\d+|Sensory-Friendly Performance|School Performance)\s*:?$/i.test(content)) return;

    const spanMatch = content.match(/^(?:[A-Za-z]+,\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?\s+through\s+(?:[A-Za-z]+,\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?$/i);
    if (spanMatch) {
      const start = new Date(spanMatch[1]);
      const end = new Date(spanMatch[2]);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
        result.spans.push({ raw: content, start: start, end: end });
      } else {
        result.errors.push(content);
      }
      return;
    }

    const parsed = parser(content);
    if (parsed && parsed.startDate && !isNaN(parsed.startDate.getTime())) {
      result.dates.push(parsed.startDate);
    } else if (!(parsed && parsed.isTBD)) {
      result.errors.push(content);
    }
  });

  result.dates.sort((a, b) => a.getTime() - b.getTime());
  return result;
};

Engine.Ingest.syncLineupToLog = function(ctx, options) {
  options = options || {};
  const targetRole = options.targetRole || "CREWCAL"; // <-- swap default here once Draft Season sheet/role exists

  const lSheet = ctx.ss.getSheetByName("Lineup");
  const lMap = ctx.maps["Lineup"];
  const logSheet = ctx.sheets[targetRole] || ctx.ss.getSheetByName(ctx.getRole(targetRole));
  const logMap = ctx.getMap(targetRole);

  if (!lSheet || !lMap) {
    Engine.Log.error(ctx, "INGEST", "Lineup sheet or map not found.");
    return;
  }
  if (!logSheet || !logMap) {
    Engine.Log.error(ctx, "INGEST", `Target sheet/map for role "${targetRole}" not found.`);
    return;
  }

  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const lData = lSheet.getDataRange().getValues();
  lData.shift();

  // Anchor identity: a log row is linked to its Lineup row via Source="Lineup" + matching UUID.
  const logRows = scanSheet(targetRole, ctx);
  const existingByUUID = {};
  logRows.forEach(row => {
    if (row.Source === "Lineup" && row.UUID) existingByUUID[row.UUID] = row;
  });

  const defaultDuration = (ctx.mode && ctx.mode.defaultDuration) || 2;
  const newRows = [];
  const changedRows = [];
  let skippedLocked = 0;
  let flaggedBadDate = 0;

  lData.forEach(lRow => {
    const uuid = lRow[lCol("UUID")];
    const title = lRow[lCol("EventName")];
    if (!uuid || !title) return;

    const location = lRow[lCol("Venue")];
    const eventOfTotal = lRow[lCol("EventOfTotal")];
    const existing = existingByUUID[uuid];

    let start = new Date(lRow[lCol("Date")]);
    let dateInvalid = isNaN(start.getTime());
    if (dateInvalid) {
      const parentID = lRow[lCol("parentID")];
      const reparsed = Engine.Ingest._reparseDateFromParent(ctx, parentID, eventOfTotal);
      if (reparsed) { start = reparsed; dateInvalid = false; }
    }

    // Prefer an empty/unsynced date over a wrong one; flag for a human to fix upstream.
    if (dateInvalid) {
      flaggedBadDate++;
      if (existing) {
        Engine.Status.apply(ctx, targetRole, null, "Manual Review", {
          details: "Could not parse a valid date from Lineup (or its Parent Lineup row).",
          targetObj: existing
        });
        changedRows.push(existing);
      }
      return; // Don't create a new row until the date is fixable.
    }

    const end = new Date(start.getTime() + defaultDuration * 60 * 60 * 1000);

    // NEW: no log row yet for this Lineup event.
    if (!existing) {
      newRows.push({
        Title: title,
        Date: start,
        Start: start,
        End: end,
        Location: location,
        Description: eventOfTotal ? `Auto-synced from Lineup (${eventOfTotal})` : "Auto-synced from Lineup",
        Source: "Lineup",
        UUID: uuid,
        SyncStatus: "Manual Review",
        LastSynced: new Date()
      });
      return;
    }

    // Respect rows a human has locked/bypassed; just note that changes were skipped.
    const statusDef = ctx.status[existing.SyncStatus];
    const behaviors = statusDef ? Engine.parseModeList(statusDef.behavior) : [];
    if (behaviors.includes("LOCKED") || behaviors.includes("BYPASS")) {
      skippedLocked++;
      return;
    }

    const titleDrift = String(existing.Title || "").trim() !== String(title || "").trim();
    const startDrift = !existing.Start || new Date(existing.Start).getTime() !== start.getTime();
    const locationDrift = String(existing.Location || "").trim() !== String(location || "").trim();

    if (titleDrift || startDrift || locationDrift) {
      existing.Title = title;
      existing.Date = start;
      existing.Start = start;
      existing.Location = location;
      Engine.Status.apply(ctx, targetRole, null, "Data Drift Detected", {
        details: "Lineup changed since the last sync.",
        targetObj: existing
      });
      changedRows.push(existing);
    }
  });

  if (newRows.length > 0) {
    const indices = Object.keys(logMap).map(field => Engine.getColumnIndex(logMap, field)).filter(index => index >= 0);
    const width = Math.max(...indices) + 1;
    newRows.forEach(obj => {
      const rowArray = new Array(width).fill("");
      for (const field in logMap) {
        const idx = Engine.getColumnIndex(logMap, field);
        if (idx < 0 || !obj.hasOwnProperty(field)) continue;
        rowArray[idx] = obj[field];
      }
      logSheet.appendRow(rowArray);
    });
  }

  if (changedRows.length > 0) {
    patchRows(targetRole, changedRows, ctx);
  }

  Engine.Log.write(ctx, {
    stage: "INGEST",
    type: "LINEUP_TO_LOG",
    details: `Added ${newRows.length} new row(s), updated ${changedRows.length} drifted row(s), skipped ${skippedLocked} locked/bypassed row(s), flagged ${flaggedBadDate} row(s) with an unparseable date.`
  });

  return { added: newRows.length, updated: changedRows.length, skippedLocked: skippedLocked, flaggedBadDate: flaggedBadDate };
};

/**
 * Re-derives a single performance date from the Parent Lineup's DatesAndTimes range,
 * used when a Lineup row's own Date cell failed to parse.
 */
Engine.Ingest._reparseDateFromParent = function(ctx, parentID, eventOfTotal) {
  if (!parentID || !eventOfTotal) return null;
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const pMap = ctx.maps["Parent Lineup"];
  if (!pSheet || !pMap) return null;

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const pData = pSheet.getDataRange().getValues();
  const row = pData.find(r => r[pCol("parentID")] === parentID);
  if (!row) return null;

  const rawDates = row[pCol("DatesAndTimes")];
  if (!rawDates) return null;

  const index = parseInt(String(eventOfTotal).split(" of ")[0], 10) - 1;
  if (isNaN(index) || index < 0) return null;

  const candidate = Engine.Ingest.parseParentDatesAndTimes(rawDates).dates[index];
  return candidate && !isNaN(candidate.getTime()) ? new Date(candidate) : null;
};

/**
 * VERIFY (read-only): Flags Parent Lineup rows whose key fields no longer match
 * their source row in "import". Does not overwrite anything — just flags for review.
 */
function goVerifyImportToParent() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Verify Import vs Parent Lineup");
  const results = Engine.Ingest.verifyImportToParent(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Verify Import vs Parent Lineup", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

Engine.Ingest.verifyImportToParent = function(ctx) {
  const iSheet = ctx.ss.getSheetByName("import");
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const iMap = ctx.maps["import"];
  const pMap = ctx.maps["Parent Lineup"];
  if (!iSheet || !pSheet || !iMap || !pMap) {
    Engine.Log.error(ctx, "VERIFY_IMPORT", "import or Parent Lineup sheet/map not found.");
    return;
  }

  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const iData = iSheet.getDataRange().getValues();
  iData.shift();
  const pData = pSheet.getDataRange().getValues();
  pData.shift();

  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });

  const fieldsToCompare = ["Series", "Opening", "Range", "Venue", "Pricing"];
  const pRowValue = (row, fieldName) => {
    const index = pCol(fieldName);
    return index >= 0 ? row[index] : "";
  };
  const normalizeForCompare = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const titleSimilarityScore = (a, b) => {
    const left = normalizeForCompare(a);
    const right = normalizeForCompare(b);
    if (!left || !right) return 0;
    if (left === right) return 100;
    if (left.includes(right) || right.includes(left)) return 80;
    const leftWords = left.split(/\s+/).filter(Boolean);
    const rightWords = right.split(/\s+/).filter(Boolean);
    if (!leftWords.length || !rightWords.length) return 0;
    const overlap = leftWords.filter(word => rightWords.includes(word)).length;
    return Math.min(60, Math.round((overlap / Math.max(leftWords.length, rightWords.length)) * 100));
  };
  const likelyParentMatches = function(parentRow, rowIdx) {
    const parentTitle = pRowValue(parentRow, "EventName");
    const parentVenue = pRowValue(parentRow, "Venue");
    const parentOpening = pRowValue(parentRow, "Opening");
    const parentRange = pRowValue(parentRow, "Range");
    const matches = [];

    iData.forEach((iRow, index) => {
      const importTitle = iRow[iCol("EventName")] || "";
      const importVenue = iRow[iCol("Venue")] || "";
      const importOpening = iRow[iCol("Opening")] || "";
      const importRange = iRow[iCol("Range")] || "";
      let score = 0;
      let reasons = [];

      const titleScore = titleSimilarityScore(parentTitle, importTitle);
      if (titleScore > 0) {
        score += titleScore;
        reasons.push(`title similarity ${titleScore}%`);
      }

      if (normalizeForCompare(parentVenue) && normalizeForCompare(parentVenue) === normalizeForCompare(importVenue)) {
        score += 25;
        reasons.push("same venue");
      }

      if (normalizeForCompare(parentOpening) && normalizeForCompare(parentOpening) === normalizeForCompare(importOpening)) {
        score += 20;
        reasons.push("same opening");
      }

      if (normalizeForCompare(parentRange) && normalizeForCompare(parentRange) === normalizeForCompare(importRange)) {
        score += 20;
        reasons.push("same range");
      }

      if (score >= 35) {
        matches.push({
          importRow: index + 2,
          importTitle: importTitle,
          importOpening: importOpening,
          importRange: importRange,
          importVenue: importVenue,
          score: score,
          reasons: reasons.join(", ")
        });
      }
    });

    return matches.sort((a, b) => b.score - a.score).slice(0, 3);
  };
  let flagged = 0;
  let importOnly = 0;
  let parentOnly = 0;
  let renamedCandidate = 0;
  const matchedParentRows = {};
  const addDecision = (values) => {
    if (!Engine.Decisions || typeof Engine.Decisions.addPending !== "function") return;
    try {
      Engine.Decisions.addPending(ctx, Object.assign({
        ReviewType: "IMPORT_PARENT",
        Decision: "PENDING",
        ActionStatus: "PENDING"
      }, values));
    } catch (error) {
      Engine.Log.write(ctx, { stage: "VERIFY_IMPORT", type: "DECISION_LOG_ERROR", details: error.message });
    }
  };

  const applyReviewStatus = (rowIdx, parentID, statusName, details, decisionValues) => {
    const currentStatus = pSheet.getRange(rowIdx, pCol("SyncStatus") + 1).getValue();
    if (Engine.Status.blocksWrite(ctx, currentStatus)) {
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: "Parent Lineup",
        rowIdx: rowIdx,
        id: parentID,
        type: "REVIEW_BLOCKED",
        details: `${details} Existing status "${currentStatus}" blocks status updates.`
      });
      addDecision(Object.assign({}, decisionValues, {
        ReviewNotes: `${details} Existing status "${currentStatus}" blocked the automatic status update.`
      }));
      return false;
    }
    // suppressLog: the caller immediately after this writes the semantic audit
    // entry (PARENT_ONLY / DRIFT_DETECTED / RENAME_CANDIDATE). Logging here too
    // produced two near-identical rows per event in Audit_Log.
    Engine.Status.apply(ctx, "Parent Lineup", rowIdx, statusName, {
      stage: "VERIFY_IMPORT",
      id: parentID,
      details: details,
      suppressLog: true
    });
    addDecision(decisionValues);
    return true;
  };

  iData.forEach((iRow, index) => {
    const name = iRow[iCol("EventName")];
    if (!name) return;
    let match = pByName[normalize(name)];
    let isRenameCandidate = false;

    if (!match) {
      const candidates = pData
        .map((row, rowIndex) => ({ row: row, rowIdx: rowIndex + 2 }))
        .filter(candidate => ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iRow[iIdx]) === normalize(candidate.row[pIdx]);
        }));
      if (candidates.length === 1) {
        match = candidates[0];
        isRenameCandidate = true;
        renamedCandidate++;
      } else {
        importOnly++;
        Engine.Log.write(ctx, {
          stage: "VERIFY_IMPORT",
          sheetName: "import",
          rowIdx: index + 2,
          id: name,
          type: "IMPORT_ONLY",
          details: "No matching Parent Lineup row found."
        });
        return;
      }
    }

    matchedParentRows[match.rowIdx] = true;

    const drifted = fieldsToCompare.some(field => {
      const iIdx = iCol(field);
      const pIdx = pCol(field);
      if (iIdx < 0 || pIdx < 0) return false;
      return !Engine.Ingest.sourceValuesEqual(ctx, field, iRow[iIdx], match.row[pIdx]);
    });

    if (drifted || isRenameCandidate) {
      flagged++;
      const wantedAction = isRenameCandidate ? "ACCEPT_IMPORT" : "REVIEW_IMPORT_DRIFT";
      const changedFields = isRenameCandidate ? ["EventName"] : fieldsToCompare.filter(field => {
        const iIdx = iCol(field), pIdx = pCol(field);
        return iIdx >= 0 && pIdx >= 0 && !Engine.Ingest.sourceValuesEqual(ctx, field, iRow[iIdx], match.row[pIdx]);
      });
      const fieldComparison = changedFields.map(field => {
        const iIdx = iCol(field);
        const pIdx = pCol(field);
        return `${field}: import="${iRow[iIdx]}" | Parent="${match.row[pIdx]}"`;
      }).join(" | ");
      const decisionValues = {
        ReviewID: `IMPORT_PARENT_${index + 2}_${match.row[pCol("parentID")] || "NO_PARENT_ID"}`,
        SourceSheet: "import",
        SourceRow: index + 2,
        SourceID: name,
        CandidateSheet: "Parent Lineup",
        CandidateRow: match.rowIdx,
        CandidateID: match.row[pCol("parentID")],
        ImportTitle: name,
        ParentTitle: match.row[pCol("EventName")],
        ExistingParentID: match.row[pCol("parentID")],
        MatchedFields: isRenameCandidate ? "Opening, Range, Venue" : "EventName",
        ChangedFields: changedFields.join(", "),
        ChangedDetails: isRenameCandidate ? `Title changed from "${match.row[pCol("EventName")]}" to "${name}" while date/venue remained stable.` : fieldComparison,
        Evidence: isRenameCandidate ? `Opening=${iRow[iCol("Opening")]}, Range=${iRow[iCol("Range")]}, Venue=${iRow[iCol("Venue")]}` : `Import row ${index + 2} vs Parent Lineup row ${match.rowIdx}: ${fieldComparison}`,
        Confidence: isRenameCandidate ? "MEDIUM" : "LOW",
        SuggestedAction: wantedAction,
        SuggestionReason: isRenameCandidate ? "Stable Opening/Range/Venue with a title placeholder change suggests the same event." : "Row differs from import and needs explicit review before mutation.",
        SuggestedKeepID: match.row[pCol("parentID")] || "",
        CandidateIDs: match.row[pCol("parentID")] || "",
        KeepChoice: isRenameCandidate ? "KEEP_EXISTING" : "",
        RequestedAction: wantedAction
      };
      applyReviewStatus(
        match.rowIdx,
        match.row[pCol("parentID")],
        isRenameCandidate ? "Possible Duplicate" : "Manual Review",
        isRenameCandidate ? `Possible duplicate from import: ${name}` : "Parent Lineup no longer matches import.",
        decisionValues
      );
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: "Parent Lineup",
        rowIdx: match.rowIdx,
        id: match.row[pCol("parentID")],
        type: isRenameCandidate ? "RENAME_CANDIDATE" : "DRIFT_DETECTED",
        details: isRenameCandidate
          ? `Possible renamed event: import "${name}" vs Parent Lineup "${match.row[pCol("EventName")]}".`
          : "Parent Lineup no longer matches import for this event."
      });
    }
  });

  pData.forEach((pRow, index) => {
    const rowIdx = index + 2;
    if (matchedParentRows[rowIdx]) return;
    parentOnly++;
    const likelyMatches = likelyParentMatches(pRow, rowIdx);
    const bestMatch = likelyMatches[0];
    const hasExactSourceMatch = bestMatch &&
      normalize(pRowValue(pRow, "Opening")) === normalize(bestMatch.importOpening) &&
      normalize(pRowValue(pRow, "Range")) === normalize(bestMatch.importRange) &&
      normalize(pRowValue(pRow, "Venue")) === normalize(bestMatch.importVenue);
    const decisionValues = {
      ReviewID: `PARENT_ONLY_${pRow[pCol("parentID")] || rowIdx}`,
      SourceSheet: hasExactSourceMatch ? "import" : "",
      SourceRow: hasExactSourceMatch ? bestMatch.importRow : "",
      SourceID: hasExactSourceMatch ? bestMatch.importTitle : "",
      CandidateSheet: "Parent Lineup",
      CandidateRow: rowIdx,
      CandidateID: pRow[pCol("parentID")],
      CandidateTitle: pRow[pCol("EventName")],
      ImportTitle: hasExactSourceMatch ? bestMatch.importTitle : "",
      ParentTitle: pRow[pCol("EventName")],
      ExistingParentID: pRow[pCol("parentID")],
      Confidence: hasExactSourceMatch ? "HIGH" : "LOW",
      SuggestedAction: hasExactSourceMatch ? "ACCEPT_IMPORT" : "REVIEW_PARENT_ONLY",
      SuggestionReason: hasExactSourceMatch
        ? `Exact import match at row ${bestMatch.importRow}; accept import as the source of truth for the retained Parent ID.`
        : "No matching import row found; review before deleting or merging.",
      SuggestedKeepID: pRow[pCol("parentID")] || "",
      CandidateIDs: "",
      DuplicateParentID: "",
      KeepChoice: "KEEP_EXISTING",
      KeepParentID: pRow[pCol("parentID")] || "",
      RequestedAction: hasExactSourceMatch ? "ACCEPT_IMPORT" : "REVIEW_PARENT_ONLY"
    };
    applyReviewStatus(
      rowIdx,
      pRow[pCol("parentID")] || pRow[pCol("EventName")],
      "Manual Review",
      hasExactSourceMatch ? `Exact import match: ${bestMatch.importTitle}.` : "No matching import row found.",
      decisionValues
    );
    Engine.Log.write(ctx, {
      stage: "VERIFY_IMPORT",
      sheetName: "Parent Lineup",
      rowIdx: rowIdx,
      id: pRow[pCol("parentID")] || pRow[pCol("EventName")],
      type: "PARENT_ONLY",
      details: "No matching import row found."
    });
  });

  const parentDuplicateSuggestions = Engine.Ingest.buildParentDuplicateSuggestions(ctx, {});

  Engine.Log.write(ctx, {
    stage: "VERIFY_IMPORT",
    type: "VERIFY_IMPORT_COMPLETE",
    details: `Checked ${iData.length} import rows. ${flagged} flagged (${renamedCandidate} possible rename), ${importOnly} import-only, ${parentOnly} Parent Lineup-only, ${parentDuplicateSuggestions.created} Parent duplicate suggestions created.`
  });

  return {
    checked: iData.length,
    flagged: flagged,
    renamedCandidate: renamedCandidate,
    importOnly: importOnly,
    parentOnly: parentOnly,
    parentDuplicateSuggestions: parentDuplicateSuggestions.created
  };
};

Engine.Ingest.refreshParentOnlyDecisions = function(ctx) {
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const importSheet = ctx.ss.getSheetByName("import");
  const parentMap = ctx.getMap("Parent Lineup");
  const importMap = ctx.getMap("import");
  if (!parentSheet || !importSheet || !parentMap || !importMap) {
    throw new Error("Parent Lineup, import, or their maps are missing");
  }

  const pCol = field => Engine.getColumnIndex(parentMap, field);
  const iCol = field => Engine.getColumnIndex(importMap, field);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const parentById = {};
  parentSheet.getDataRange().getValues().slice(1).forEach(row => {
    parentById[row[pCol("parentID")]] = row;
  });
  const importRows = importSheet.getDataRange().getValues().slice(1);

  let superseded = 0;
  Engine.Decisions.reviewable(ctx)
    .filter(decision => String(decision.ReviewID || "").startsWith("PARENT_ONLY_"))
    .forEach(decision => {
      const parentRow = parentById[decision.ExistingParentID];
      const details = !parentRow
        ? "Parent row no longer exists; it was resolved by a merge or manual cleanup."
        : "Parent row now matches import after duplicate reconciliation.";
      const matchesImport = parentRow && importRows.some(importRow =>
        normalize(importRow[iCol("EventName")]) === normalize(parentRow[pCol("EventName")]) ||
        ["Opening", "Range", "Venue"].every(field =>
          normalize(importRow[iCol(field)]) && normalize(importRow[iCol(field)]) === normalize(parentRow[pCol(field)])
        )
      );
      if ((!parentRow || matchesImport) && Engine.Decisions.markSuperseded(ctx, decision.ReviewID, details)) superseded++;
    });

  return { superseded: superseded };
};

function refreshParentOnlyDecisions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh Resolved Parent-Only Reviews");
  const results = Engine.Ingest.refreshParentOnlyDecisions(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh Resolved Parent-Only Reviews", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

Engine.Ingest.refreshParentDuplicateDecisions = function(ctx) {
  const parentSheet = ctx.ss.getSheetByName("Parent Lineup");
  const parentMap = ctx.getMap("Parent Lineup");
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map is missing");

  const pCol = field => Engine.getColumnIndex(parentMap, field);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const parentById = {};
  parentSheet.getDataRange().getValues().slice(1).forEach(row => {
    parentById[row[pCol("parentID")]] = row;
  });

  let superseded = 0;
  Engine.Decisions.reviewable(ctx)
    .filter(decision => String(decision.ReviewType || "") === "PARENT_DUPLICATE")
    .forEach(decision => {
      const keepRow = parentById[decision.KeepParentID || decision.ExistingParentID];
      const duplicateRow = parentById[decision.DuplicateParentID || decision.CandidateID];
      const validPair = keepRow && duplicateRow &&
        normalize(keepRow[pCol("Opening")]) === normalize(duplicateRow[pCol("Opening")]) &&
        normalize(keepRow[pCol("Venue")]) === normalize(duplicateRow[pCol("Venue")]);
      if (!validPair && Engine.Decisions.markSuperseded(
        ctx,
        decision.ReviewID,
        "Superseded: one Parent row is no longer present or the pair no longer shares the same opening date and venue."
      )) {
        superseded++;
      }
    });

  return { superseded: superseded };
};

function refreshParentDuplicateDecisions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh Stale Parent Duplicate Reviews");
  const results = Engine.Ingest.refreshParentDuplicateDecisions(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh Stale Parent Duplicate Reviews", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

/**
 * VERIFY (read-only): Flags Lineup rows whose Date/Venue no longer match a
 * re-parse of their Parent Lineup row's DatesAndTimes range. Does not overwrite.
 */
function goVerifyParentToLineup() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Verify Parent Lineup vs Lineup");
  const results = Engine.Ingest.verifyParentToLineup(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Verify Parent Lineup vs Lineup", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
  return results;
}

Engine.Ingest.verifyParentToLineup = function(ctx) {
  const pSheet = ctx.ss.getSheetByName("Parent Lineup");
  const lSheet = ctx.ss.getSheetByName("Lineup");
  const pMap = ctx.maps["Parent Lineup"];
  const lMap = ctx.maps["Lineup"];
  if (!pSheet || !lSheet || !pMap || !lMap) {
    Engine.Log.error(ctx, "VERIFY_PARENT", "Parent Lineup or Lineup sheet/map not found.");
    return;
  }

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  const pData = pSheet.getDataRange().getValues();
  pData.shift();
  const lData = lSheet.getDataRange().getValues();
  lData.shift();

  // Group Lineup rows by parentID, in sheet order, to line up against the parsed date range.
  const lByParent = {};
  lData.forEach((row, idx) => {
    const pid = row[lCol("parentID")];
    if (!pid) return;
    if (!lByParent[pid]) lByParent[pid] = [];
    lByParent[pid].push({ row: row, rowIdx: idx + 2 });
  });

  let checked = 0;
  let flagged = 0;
  let unparseable = 0;

  pData.forEach(pRow => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    const venue = pRow[pCol("Venue")];
    if (!parentID || !rawDates) return;

    const parsedDates = Engine.Ingest.parseParentDatesAndTimes(rawDates);
    const expectedDates = parsedDates.dates;
    if (expectedDates.length === 0) {
      unparseable++;
      Engine.Log.write(ctx, {
        stage: "VERIFY_PARENT",
        sheetName: "Parent Lineup",
        rowIdx: pData.indexOf(pRow) + 2,
        id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || "unknown format"}`
      });
      return;
    }

    const children = lByParent[parentID] || [];
    children.forEach((child, index) => {
      checked++;
      const expected = expectedDates[index];
      const childDate = child.row[lCol("Date")];
      const childVenue = child.row[lCol("Venue")];
      const expectedValid = expected && !isNaN(new Date(expected).getTime());
      const dateDrift = expectedValid && new Date(childDate).getTime() !== new Date(expected).getTime();
      const venueDrift = String(childVenue || "").trim() !== String(venue || "").trim();

      if (dateDrift || venueDrift) {
        flagged++;
        const currentStatus = child.row[lCol("SyncStatus")];
        const details = "Lineup row no longer matches its Parent Lineup's dates/venue.";
        if (Engine.Status.blocksWrite(ctx, currentStatus)) {
          Engine.Log.write(ctx, {
            stage: "VERIFY_PARENT",
            sheetName: "Lineup",
            rowIdx: child.rowIdx,
            id: child.row[lCol("UUID")],
            type: "REVIEW_BLOCKED",
            details: `${details} Existing status "${currentStatus}" blocks status updates.`
          });
          return;
        }
        const statusCol = lCol("SyncStatus");
        const lastSyncedCol = lCol("LastSynced");
        if (statusCol >= 0) lSheet.getRange(child.rowIdx, statusCol + 1).setValue("Manual Review");
        if (lastSyncedCol >= 0) lSheet.getRange(child.rowIdx, lastSyncedCol + 1).setValue(new Date());
        Engine.Log.write(ctx, {
          stage: "VERIFY_PARENT",
          sheetName: "Lineup",
          rowIdx: child.rowIdx,
          id: child.row[lCol("UUID")],
          type: "DRIFT_DETECTED",
          details: details
        });
      }
    });
  });

  Engine.Log.write(ctx, {
    stage: "VERIFY_PARENT",
    type: "VERIFY_PARENT_COMPLETE",
    details: `Checked ${checked} Lineup rows against Parent Lineup. ${flagged} drifted, ${unparseable} Parent Lineup row(s) had unparseable date ranges.`
  });

  return { checked: checked, flagged: flagged, unparseable: unparseable };
};

// ============================================================
// engine_ingest.js — new: Engine.Ingest.acceptImportDrift()
// The explicit, deliberate merge step for RENAME_CANDIDATE (and any
// DRIFT_DETECTED) rows goParent() correctly refused to auto-apply.
// ============================================================
Engine.Ingest.acceptImportDrift = function(ctx, parentID, options) {
  options = options || {};
  const ss = ctx.ss;
  const iSheet = ss.getSheetByName("import");
  const pSheet = ss.getSheetByName("Parent Lineup");
  const iMap = ctx.getMap("import");
  const pMap = ctx.getMap("Parent Lineup");
  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
 
  const pData = pSheet.getDataRange().getValues(); // includes header at index 0
  const pRowIdx = pData.findIndex(row => row[pCol("parentID")] === parentID);
  if (pRowIdx === -1) {
    Engine.Log.write(ctx, { stage: "INGEST", type: "DRIFT_ACCEPT_FAILED", id: parentID, details: "No Parent Lineup row found for this parentID." });
    return false;
  }
  const pRow = pData[pRowIdx];
  const sheetRowNum = pRowIdx + 1; // pData[0] is the header row, so index N is sheet row N+1
 
  const iData = iSheet.getDataRange().getValues();
  iData.shift();
 
  const pName = normalize(pRow[pCol("EventName")]);
  let importRowIdx = iData.findIndex(row => normalize(row[iCol("EventName")]) === pName);

  if (importRowIdx === -1) {
    // Same fallback used everywhere else: Opening+Range+Venue triple match.
    const candidateIdxs = iData
      .map((row, idx) => idx)
      .filter(idx =>
        ["Opening", "Range", "Venue"].every(field => {
          const iIdx = iCol(field);
          const pIdx = pCol(field);
          return iIdx >= 0 && pIdx >= 0 && normalize(iData[idx][iIdx]) === normalize(pRow[pIdx]);
        })
      );
    if (candidateIdxs.length === 1) importRowIdx = candidateIdxs[0];
  }

  if (importRowIdx === -1) {
    Engine.Log.write(ctx, { stage: "INGEST", type: "DRIFT_ACCEPT_FAILED", id: parentID, details: "No matching import row found to accept drift from." });
    return false;
  }

  const importRow = iData[importRowIdx];
  const importSheetRow = importRowIdx + 2; // iData[0] is header, so index N is sheet row N+2

  const sourceFields = Engine.Ingest.getParentSourceFields(iMap, pMap);
  const importUpdatePolicy = (ctx.mode.importUpdatePolicy || "MANUAL_REVIEW").toUpperCase();

  // Read-only pass: compute which fields would change before deciding what to do.
  const changes = [];
  sourceFields.forEach(fieldName => {
    const oldVal = pRow[pCol(fieldName)];
    const newVal = importRow[iCol(fieldName)];
    if (!Engine.Ingest.sourceValuesEqual(ctx, fieldName, oldVal, newVal)) {
      changes.push({ fieldName, oldVal, newVal });
    }
  });
  const changeSummary = changes.length
    ? changes.map(c => `${c.fieldName}: "${c.oldVal}" -> "${c.newVal}"`).join(" | ")
    : "No field changes (accepted as-is)";

  // ── MANUAL_REVIEW: create a pending decision, do NOT apply ──
  // options.force bypasses this gate for the explicit review-apply path
  // (Engine.Decisions.applyPending and manual accept), where a human
  // decision has already been made. Direct "quick accept" calls respect it.
  if (importUpdatePolicy === "MANUAL_REVIEW" && !options.force) {
    if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
      Engine.Decisions.addPending(ctx, {
        ReviewID: `IMPORT_DRIFT_${parentID}`,
        ReviewType: "IMPORT_DRIFT",
        SourceSheet: "import",
        SourceRow: importSheetRow,
        SourceID: importRow[iCol("EventName")] || "",
        ImportTitle: importRow[iCol("EventName")] || "",
        CandidateSheet: "Parent Lineup",
        CandidateRow: sheetRowNum,
        CandidateID: parentID,
        CandidateTitle: pRow[pCol("EventName")] || "",
        ExistingParentID: parentID,
        ParentTitle: pRow[pCol("EventName")] || "",
        MatchedFields: "EventName",
        ChangedFields: changes.map(c => c.fieldName).join(", ") || "(none)",
        ChangedDetails: changeSummary,
        Evidence: `import "${importRow[iCol("EventName")]}" vs Parent Lineup row ${sheetRowNum}`,
        Confidence: "LOW",
        SuggestedAction: "ACCEPT_IMPORT",
        SuggestionReason: `ImportUpdatePolicy is MANUAL_REVIEW. ${changeSummary}`,
        SuggestedKeepID: parentID,
        CandidateIDs: parentID,
        KeepChoice: "KEEP_EXISTING",
        RequestedAction: "ACCEPT_IMPORT",
        Decision: "PENDING",
        ActionStatus: "PENDING"
      });
    }
    Engine.Log.write(ctx, {
      stage: "INGEST",
      sheetName: "Parent Lineup",
      rowIdx: sheetRowNum,
      id: parentID,
      type: "DRIFT_PENDING_REVIEW",
      details: changeSummary
    });
    return false;
  }

  // ── AUTO_UPDATE / AUTO_UPDATE_AND_LOG: apply the changes ──
  changes.forEach(c => {
    pSheet.getRange(sheetRowNum, pCol(c.fieldName) + 1).setValue(c.newVal);
  });

  const now = new Date();
  const lastUpdatedCol = pCol("LastUpdated");
  const updateDetailsCol = pCol("UpdateDetails");
  const syncStatusCol = pCol("SyncStatus");
  if (lastUpdatedCol >= 0) pSheet.getRange(sheetRowNum, lastUpdatedCol + 1).setValue(now);
  if (updateDetailsCol >= 0) pSheet.getRange(sheetRowNum, updateDetailsCol + 1).setValue(changeSummary);
  if (syncStatusCol >= 0) pSheet.getRange(sheetRowNum, syncStatusCol + 1).setValue("Active");

  // Per-field log entries for AUTO_UPDATE_AND_LOG
  if (importUpdatePolicy === "AUTO_UPDATE_AND_LOG") {
    changes.forEach(c => {
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: "Parent Lineup",
        rowIdx: sheetRowNum,
        id: parentID,
        type: "DRIFT_FIELD_UPDATE",
        details: `${c.fieldName}: "${c.oldVal}" -> "${c.newVal}"`
      });
    });
  }

  Engine.Log.write(ctx, {
    stage: "INGEST",
    sheetName: "Parent Lineup",
    rowIdx: sheetRowNum,
    id: parentID,
    type: "DRIFT_ACCEPTED",
    details: changeSummary
  });
  return true;
};
 
// Global wrapper — single row, e.g. run from the script editor or a
// prompt-driven menu item with a specific parentID.
function acceptDriftForParentID(parentID) {
  const ctx = Engine.getContext();
  return Engine.Ingest.acceptImportDrift(ctx, parentID);
}
 
// Global wrapper — bulk, with a confirmation dialog. Accepts every Parent
// Lineup row currently sitting at SyncStatus = "Manual Review". Deliberately
// separate from the single-row version rather than the default behavior.
function acceptAllFlaggedDrift() {
  const ctx = Engine.getContext();
  const ss = ctx.ss;
  const pSheet = ss.getSheetByName("Parent Lineup");
  const pMap = ctx.getMap("Parent Lineup");
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const pData = pSheet.getDataRange().getValues();
  pData.shift();
 
  const ui = SpreadsheetApp.getUi();
  const flaggedIds = pData
    .filter(row => row[pCol("SyncStatus")] === "Manual Review")
    .map(row => row[pCol("parentID")]);
 
  if (!flaggedIds.length) {
    ui.alert("No Parent Lineup rows are currently flagged for Manual Review.");
    return;
  }
 
  const response = ui.alert('CAUTION', `Accept drift for all ${flaggedIds.length} flagged row(s)? This overwrites Source (Read-Only) fields from import.`, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
 
  let accepted = 0;
  flaggedIds.forEach(id => {
    if (Engine.Ingest.acceptImportDrift(ctx, id)) accepted++;
  });
  ui.alert(`Accepted drift for ${accepted} of ${flaggedIds.length} row(s).`);
}
 