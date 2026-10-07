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
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
 
  if (!iSheet || !pSheet) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Import or Parent Lineup sheet not found for the active mode's target season.", "Error");
    return;
  }
 
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
  const iSheetName = iSheet.getName();
  const pSheetName = pSheet.getName();
  const iData = iSheet.getDataRange().getValues();
  const pData = pSheet.getDataRange().getValues();
 
  iData.shift();
  pData.shift();
 
  const iCol = fieldName => ctx.getCol(iRole, fieldName);
  const pCol = fieldName => ctx.getCol(pRole, fieldName);
  const pWidth = Math.max(...Object.keys(pMap).map(fieldName => pMap[fieldName]).filter(index => index >= 0)) + 1;
  // Source fields mirror import. System fields are maintained by this
  // operation so every successful import pass has a visible audit state.
  const sourceFields = Engine.Ingest.getParentSourceFields(ctx, iMap, pMap);

  /* ── "Delete Pending" pre-pass ──
  * User-marked deletions are applied as part of the ingest pass (documented
  * in OPERATIONS.md). Deleted bottom-up so row numbers stay valid, and each
  * pending decision referencing that parentID is superseded with an audit
  * entry before the row is removed.
  */
  
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
        sheetName: pSheetName,
        rowIdx: item.rowNumber,
        id: parentID,
        type: "DELETE_PENDING_APPLIED",
        details: `Row deleted from Parent Lineup per user status Delete Pending. ${title}`
      });
      pSheet.deleteRow(item.rowNumber);
      deletedPending++;
    });
  }

  // Shared normalize (scriptLib SL.Utils); see sourceValuesEqual above for the
  // canonical tier used across ingest lookups: collapse + typographic fold.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });

  const usedParentIDs = new Set(pData.map(row => String(row[pCol("parentID")] || "").trim()).filter(Boolean));
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
      let newParentID = "";
      do {
        newParentID = "P-" + Utilities.getUuid().split('-')[0].toUpperCase();
      } while (usedParentIDs.has(newParentID));
      usedParentIDs.add(newParentID);
      rowArray[pCol("parentID")] = newParentID;
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
      Engine.Status.paint(ctx, pRole, match.rowIdx, "Manual Review");
      flaggedForReview++;
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: pSheetName,
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
    Engine.Status.paint(ctx, pRole, match.rowIdx, "Active");
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

Engine.Ingest.getParentSourceFields = function(ctxOrIMap, maybeIMapOrPMap, maybePMap) {
  let ctx = null;
  let iMap = null;
  let pMap = null;

  if (maybePMap !== undefined) {
    ctx = ctxOrIMap;
    iMap = maybeIMapOrPMap;
    pMap = maybePMap;
  } else if (ctxOrIMap && (ctxOrIMap.sheetDefs || ctxOrIMap.schema)) {
    ctx = ctxOrIMap;
    const iRole = Engine.Roles.resolve(ctx, "IMPORT");
    const pRole = Engine.Roles.resolve(ctx, "PARENT");
    iMap = maybeIMapOrPMap || ctx.getMap(iRole);
    pMap = ctx.getMap(pRole);
  } else {
    iMap = ctxOrIMap;
    pMap = maybeIMapOrPMap;
  }

  const canonicalFields = [
    "EventName", "Series", "Opening", "Range", "DatesAndTimes", "Venue", "Pricing", "Pit"
  ];
  const importRole = ctx && Engine.Roles.resolve(ctx, "IMPORT");
  const registrySourceFields = Object.keys(iMap || {}).filter(fieldName => {
    const behavior = ctx
      ? Engine.getSyncBehavior(ctx, importRole, fieldName)
      : (typeof (iMap[fieldName]) === "object" ? iMap[fieldName].syncBehavior : "");
    return behavior === "Source (Read-Only)" && Engine.getColumnIndex(pMap, fieldName) >= 0;
  });
  if (registrySourceFields.length) return registrySourceFields;

  return canonicalFields.filter(fieldName =>
    Engine.getColumnIndex(iMap, fieldName) >= 0 && Engine.getColumnIndex(pMap, fieldName) >= 0
  );
};

Engine.Ingest.sourceValuesEqual = function(ctx, fieldName, left, right) {
  // Single-field case of the generic row comparer (Engine.IO.compare) — kept
  // as a wrapper so the existing call sites stay unchanged. All normalization
  // (string tier + Date formatting) now happens in one place, Engine.IO.
  return Engine.IO.compare(ctx, {
    source: { [fieldName]: left },
    destination: { [fieldName]: right },
    sourceRole: Engine.Roles.resolve(ctx, "IMPORT"),
    destinationRole: Engine.Roles.resolve(ctx, "PARENT"),
    fields: [fieldName],
    identifier: fieldName
  }).equal;
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
  const pSheet = Engine.getSeasonSheet(ctx, "PARENT");
  if (generated && generated.hash && pSheet) pSheet.getRange(rowNumber, hashCol + 1).setValue(generated.hash);
};

Engine.Ingest.resolveParentDuplicates = function(ctx, options) {
  options = options || {};
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const sheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const map = ctx.getMap(pRole);
  if (!sheet || !map) return { groups: [], merged: 0 };
  const col = field => Engine.getColumnIndex(map, field);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
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
        stage: "INGEST", sheetName: pRole, rowIdx: item.rowNumber,
        id: item.row[col("parentID")], type: "PARENT_DUPLICATE",
        details: `Duplicate candidate for ${keep.row[col("parentID")]}; retained earliest row ${keep.rowNumber}.`
      });
      if (options.merge === true) {
        const statusCol = col("SyncStatus");
        if (statusCol >= 0) sheet.getRange(item.rowNumber, statusCol + 1).setValue("Manual Review");
        Engine.Status.paint(ctx, pRole, item.rowNumber, "Manual Review");
        merged++;
      }
    });
  });
  return { groups: duplicateGroups.map(group => group.map(item => item.rowNumber)), merged: merged };
};

Engine.Ingest.buildParentDuplicateSuggestions = function(ctx, options) {
  options = options || {};
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const sheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const map = ctx.getMap(pRole);
  if (!sheet || !map) return { created: 0, suggested: 0 };
  const parentSheetName = sheet.getName();

  const col = field => Engine.getColumnIndex(map, field);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  // (compact stays local: it strips all non-alphanumerics — a different tier
  // used for similarity scoring, not equality.)
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
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
      SourceSheet: parentSheetName,
      SourceRow: current.rowNumber,
      SourceID: current.parentID,
      SourceLink: Engine.makeSheetRowLink(ctx, parentSheetName, current.rowNumber, `Row ${current.rowNumber}`),
      CandidateSheet: parentSheetName,
      CandidateRow: best.rowNumber,
      CandidateID: best.parentID,
      CandidateLink: Engine.makeSheetRowLink(ctx, parentSheetName, best.rowNumber, `Row ${best.rowNumber}`),
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
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
  if (!parentSheet || !parentMap || !Engine.Decisions) return { created: 0, suggested: 0 };
  const parentSheetName = parentSheet.getName();

  const col = field => Engine.getColumnIndex(parentMap, field);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
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
        SourceSheet: parentSheetName,
        SourceRow: current.rowNumber,
        SourceID: current.parentID,
        CandidateSheet: parentSheetName,
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
  const decisionSheet = Engine.getSheetByRole(ctx, "DECISIONS");
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

  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map not found for the active mode's target season");
  const parentIdCol = Engine.getColumnIndex(parentMap, "parentID");
  const parentData = parentSheet.getDataRange().getValues();
  const duplicateRow = parentData.findIndex((row, index) => index > 0 && row[parentIdCol] === duplicateParentID);
  if (duplicateRow < 0) throw new Error(`Duplicate Parent Lineup row not found: ${duplicateParentID}`);
  const keepRow = parentData.findIndex((row, index) => index > 0 && row[parentIdCol] === keepParentID);
  if (keepRow < 0) throw new Error(`Keeper Parent Lineup row not found: ${keepParentID}`);

  const keepValues = parentData[keepRow];
  const duplicateValues = parentData[duplicateRow];
  const duplicateSnapshot = {};
  Object.keys(parentMap).forEach(field => {
    const column = Engine.getColumnIndex(parentMap, field);
    if (column >= 0) duplicateSnapshot[field] = duplicateValues[column];
  });
  const duplicateTitleCol = Engine.getColumnIndex(parentMap, "EventName");
  const duplicateTitle = duplicateTitleCol >= 0 ? duplicateValues[duplicateTitleCol] : "";
  const duplicateFingerprint = Engine.IO.serializeRow(duplicateSnapshot);
  if (Engine.IDService && typeof Engine.IDService.upsert === "function") {
    Engine.IDService.upsert(ctx, {
      id: duplicateParentID,
      type: pRole,
      title: duplicateTitle,
      parentId: duplicateParentID,
      fingerprint: duplicateFingerprint,
      location: `${parentSheet.getName()}!R${duplicateRow + 1}`,
      status: "Active",
      details: `Snapshot captured before merge into ${keepParentID}.`
    });
  }
  const sourceFields = [...new Set([
    "EventName", "Series", "Opening", "Range", "DatesAndTimes", "Venue", "Pricing", "Pit",
    ...Object.keys(parentMap).filter(fieldName => Engine.getSyncBehavior(ctx, pRole, fieldName) === "Source (Read-Only)")
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
    const sheet = ctx.sheets[sheetName] || ctx.ss.getSheetByName(sheetName);
    const col = Engine.getColumnIndex(map, "parentID") >= 0
      ? Engine.getColumnIndex(map, "parentID")
      : Engine.getColumnIndex(map, "ParentID");
    if (!sheet || col < 0 || sheet === parentSheet) return;
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][col] || "").trim() === String(duplicateParentID).trim()) {
        sheet.getRange(i + 1, col + 1).setValue(keepParentID);
        changedLocations.push(`${sheetName}!R${i + 1}`);
      }
    }
  });

  const now = new Date();
  const idLog = ctx.sheets.ID_LOG || ctx.ss.getSheetByName("idLog");
  const idMap = ctx.maps.ID_LOG || {};
  const idCol = Engine.getColumnIndex(idMap, "UniqueID");
  const idStatusCol = Engine.getColumnIndex(idMap, "SyncStatus");
  const idDetailsCol = Engine.getColumnIndex(idMap, "LogDetails");
  const idLastUpdatedCol = Engine.getColumnIndex(idMap, "LastUpdated");
  const idMergedCol = Engine.getColumnIndex(idMap, "MergedIDs") >= 0
    ? Engine.getColumnIndex(idMap, "MergedIDs")
    : Engine.getColumnIndex(idMap, "Merged IDs");

  const idData = idLog && idLog.getDataRange().getValues();
  if (idData && idCol >= 0) {
    // 2a. Update duplicate row in idLog to 'Merged'
    const idRow = idData.findIndex((row, index) => index > 0 && String(row[idCol] || "").trim() === String(duplicateParentID).trim());
    if (idRow >= 0) {
      if (idStatusCol >= 0) idLog.getRange(idRow + 1, idStatusCol + 1).setValue("Merged");
      if (idDetailsCol >= 0) idLog.getRange(idRow + 1, idDetailsCol + 1).setValue(`Merged into ParentID ${keepParentID}`);
      if (idLastUpdatedCol >= 0) idLog.getRange(idRow + 1, idLastUpdatedCol + 1).setValue(now);
    } else if (Engine.IDService && typeof Engine.IDService.upsert === "function") {
      Engine.IDService.upsert(ctx, {
        id: duplicateParentID,
        type: pRole,
        title: duplicateValues[Engine.getColumnIndex(parentMap, "EventName")] || "Merged Duplicate",
        parentId: "N/A",
        status: "Merged",
        details: `Merged into ParentID ${keepParentID}`
      });
    }

    // 2b. Append duplicateParentID to survivor row's MergedIDs
    const survivorRow = idData.findIndex((row, index) => index > 0 && String(row[idCol] || "").trim() === String(keepParentID).trim());
    if (survivorRow >= 0 && idMergedCol >= 0) {
      const existingMergedStr = String(idData[survivorRow][idMergedCol] || "").trim();
      const existingMergedList = existingMergedStr.split(",").map(s => s.trim()).filter(Boolean);
      if (!existingMergedList.includes(duplicateParentID)) {
        existingMergedList.push(duplicateParentID);
        idLog.getRange(survivorRow + 1, idMergedCol + 1).setValue(existingMergedList.join(", "));
        if (idLastUpdatedCol >= 0) idLog.getRange(survivorRow + 1, idLastUpdatedCol + 1).setValue(now);
      }
    }
  }

  // 3. Re-point any active pending decisions in decision_log that reference the duplicate ID
  let repointedDecisions = 0;
  try {
    const dSheet = Engine.getSheetByRole(ctx, "DECISIONS");
    const dMap = ctx.getMap("DECISIONS");
    if (dSheet && dMap) {
      const dData = dSheet.getDataRange().getValues();
      const dStatusCol = Engine.getColumnIndex(dMap, "ActionStatus");
      const dExistingParentCol = Engine.getColumnIndex(dMap, "ExistingParentID");
      const dCandidateCol = Engine.getColumnIndex(dMap, "CandidateID");
      const dKeepParentCol = Engine.getColumnIndex(dMap, "KeepParentID");
      const dDupParentCol = Engine.getColumnIndex(dMap, "DuplicateParentID");
      const dDetailsCol = Engine.getColumnIndex(dMap, "ActionDetails");
      const dReviewIdCol = Engine.getColumnIndex(dMap, "ReviewID");

      for (let i = 1; i < dData.length; i++) {
        const row = dData[i];
        const status = dStatusCol >= 0 ? String(row[dStatusCol] || "PENDING").trim().toUpperCase() : "PENDING";
        if (status !== "PENDING" && status !== "FAILED") continue;

        let rowChanged = false;
        if (dExistingParentCol >= 0 && String(row[dExistingParentCol] || "").trim() === String(duplicateParentID).trim()) {
          dSheet.getRange(i + 1, dExistingParentCol + 1).setValue(keepParentID);
          rowChanged = true;
        }
        if (dCandidateCol >= 0 && String(row[dCandidateCol] || "").trim() === String(duplicateParentID).trim()) {
          dSheet.getRange(i + 1, dCandidateCol + 1).setValue(keepParentID);
          rowChanged = true;
        }
        if (dKeepParentCol >= 0 && String(row[dKeepParentCol] || "").trim() === String(duplicateParentID).trim()) {
          dSheet.getRange(i + 1, dKeepParentCol + 1).setValue(keepParentID);
          rowChanged = true;
        }
        if (dDupParentCol >= 0 && String(row[dDupParentCol] || "").trim() === String(duplicateParentID).trim()) {
          dSheet.getRange(i + 1, dDupParentCol + 1).setValue(keepParentID);
          rowChanged = true;
        }

        if (rowChanged) {
          repointedDecisions++;
          const reviewId = dReviewIdCol >= 0 ? row[dReviewIdCol] : `Row ${i + 1}`;
          if (dDetailsCol >= 0) {
            dSheet.getRange(i + 1, dDetailsCol + 1).setValue(`Repointed from merged ParentID ${duplicateParentID} to ${keepParentID}`);
          }
          Engine.Log.write(ctx, {
            stage: "DECISION",
            sheetName: "decision_log",
            rowIdx: i + 1,
            id: reviewId,
            type: "DECISION_REPOINTED",
            details: `Repointed decision referencing merged ${duplicateParentID} to surviving ${keepParentID}.`
          });
        }
      }
    }
  } catch (decErr) {
    Engine.Log.warn(ctx, "INGEST", `Could not repoint decisions during merge: ${decErr.message}`);
  }

  const syncStatusCol = Engine.getColumnIndex(parentMap, "SyncStatus");
  const lastSyncedCol = Engine.getColumnIndex(parentMap, "LastSynced");
  const lastUpdatedCol = Engine.getColumnIndex(parentMap, "LastUpdated");
  const updateDetailsCol = Engine.getColumnIndex(parentMap, "UpdateDetails");
  if (syncStatusCol >= 0) parentSheet.getRange(keepRow + 1, syncStatusCol + 1).setValue("Active");
  Engine.Status.paint(ctx, pRole, keepRow + 1, "Active");
  if (lastSyncedCol >= 0) parentSheet.getRange(keepRow + 1, lastSyncedCol + 1).setValue(now);
  if (lastUpdatedCol >= 0) parentSheet.getRange(keepRow + 1, lastUpdatedCol + 1).setValue(now);
  if (updateDetailsCol >= 0) {
    parentSheet.getRange(keepRow + 1, updateDetailsCol + 1).setValue(
      `Merged ${duplicateParentID}; imported source fields: ${copiedFields.join(", ") || "none"}`
    );
  }

  parentSheet.deleteRow(duplicateRow + 1);
  if (Engine.IDService && typeof Engine.IDService.upsert === "function") {
    Engine.IDService.upsert(ctx, {
      id: duplicateParentID,
      fingerprint: duplicateFingerprint,
      status: "Merged",
      location: "",
      details: `Merged into ParentID ${keepParentID}; pre-merge snapshot retained in Fingerprint.`
    });
  }
  Engine.Log.write(ctx, {
    stage: "INGEST",
    sheetName: pRole,
    id: duplicateParentID,
    type: "PARENT_DUPLICATE_MERGED",
    details: `Merged into ${keepParentID}. Copied source fields: ${copiedFields.join(", ") || "none"}. Repointed ${changedLocations.length} dependent row(s). Repointed ${repointedDecisions} decision(s).`
  });
  return {
    keepParentID: keepParentID,
    duplicateParentID: duplicateParentID,
    copiedFields: copiedFields,
    changedLocations: changedLocations,
    repointedDecisions: repointedDecisions
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
Engine.Ingest.lineupOccurrenceKey = function(ctx, dateValue, timeValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(date.getTime())) return "";
  const timeZone = ctx.timeZone || Session.getScriptTimeZone();
  const dateKey = Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
  let timeKey = "";
  if (timeValue instanceof Date && !isNaN(timeValue.getTime())) {
    timeKey = Utilities.formatDate(timeValue, timeZone, "HH:mm:ss");
  } else {
    const match = String(timeValue || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (match) {
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] || 0);
      const meridiem = String(match[4] || "").toUpperCase();
      if (minutes > 59 || seconds > 59 || hours > (meridiem ? 12 : 23) || (meridiem && hours < 1)) return "";
      if (meridiem === "AM" && hours === 12) hours = 0;
      if (meridiem === "PM" && hours !== 12) hours += 12;
      timeKey = [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
    }
  }
  if (!timeKey) timeKey = Utilities.formatDate(date, timeZone, "HH:mm:ss");
  return `${dateKey}|${timeKey}`;
};

Engine.Ingest.nextLineupUUID = function(parentID, usedUUIDs) {
  const prefix = `${parentID}-C`;
  let suffix = 0;
  usedUUIDs.forEach(id => {
    const candidate = String(id);
    if (!candidate.startsWith(prefix)) return;
    const number = candidate.slice(prefix.length);
    if (/^\d+$/.test(number)) suffix = Math.max(suffix, Number(number));
  });
  let uuid = `${prefix}${String(suffix + 1).padStart(2, "0")}`;
  while (usedUUIDs.has(uuid)) {
    suffix++;
    uuid = `${prefix}${String(suffix + 1).padStart(2, "0")}`;
  }
  usedUUIDs.add(uuid);
  return uuid;
};

function goLineup() {
  const ctx = Engine.getContext();

  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");

  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);

  const pMap = ctx.getMap(pRole);
  const lMap = ctx.getMap(lRole);

  if (!pSheet || !lSheet || !pMap || !lMap) {
    const utils = Engine.getLibraryModule("Utils");
    if (utils && typeof utils.notify === "function") utils.notify("Parent Lineup or Lineup sheet/map not found.", "Error");
    return;
  }
  
  const pData = pSheet.getDataRange().getValues();
  pData.shift();

  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const lCol = fieldName => Engine.getColumnIndex(lMap, fieldName);
  Engine.Ingest.applyLineupDeletePending(ctx, lRole, lSheet, lMap);
  const lData = lSheet.getDataRange().getValues();
  const deletedOccurrenceKeys = new Set();
  Object.keys(ctx.registry || {}).forEach(id => {
    const registryEntry = ctx.registry[id];
    const snapshot = registryEntry && registryEntry.Snapshot;
    if (String(registryEntry && registryEntry.Status || "").trim().toUpperCase() !== "DELETED" ||
        !String(registryEntry && registryEntry.LogDetails || "").includes("[LINEUP_DELETE_PENDING]") ||
        !snapshot || !snapshot.parentID || !snapshot.Date) return;
    const occurrenceKey = Engine.Ingest.lineupOccurrenceKey(ctx, snapshot.Date, snapshot.Time);
    if (occurrenceKey) deletedOccurrenceKeys.add(`${snapshot.parentID}|${occurrenceKey}`);
  });
  let skippedDeletedOccurrences = 0;
  const lWidth = Math.max(...Object.keys(lMap).map(fieldName => lMap[fieldName]).filter(index => index >= 0)) + 1;
  const spanOverrideCol = pCol("SpanOverride");
  const sourceFields = Object.keys(lMap).filter(fieldName =>
    pCol(fieldName) >= 0 && ![
      "UUID", "parentID", "RawDateStr", "Date", "Time", "EventOfTotal",
      "AfterToday", "WithinQuarter", "WithinMonth", "SyncStatus", "LastSynced",
      "LastUpdated", "UpdateDetails", "SyncHash", "EndDate"
    ].includes(fieldName)
  );
  const sameValue = function(left, right) {
    const leftDate = left instanceof Date ? left : null;
    const rightDate = right instanceof Date ? right : null;
    if (leftDate || rightDate) {
      const leftTime = new Date(left).getTime();
      const rightTime = new Date(right).getTime();
      return !isNaN(leftTime) && !isNaN(rightTime) && leftTime === rightTime;
    }
    return String(left === undefined || left === null ? "" : left) === String(right === undefined || right === null ? "" : right);
  };
  const formulaFor = function(fieldName) {
    const fieldColumn = lCol(fieldName);
    const dateColumn = lCol("Date");
    if (fieldColumn < 0 || dateColumn < 0) return "";
    const dateReference = dateColumn === fieldColumn ? "RC" : `RC[${dateColumn - fieldColumn}]`;
    if (fieldName === "AfterToday") return `=${dateReference}>=TODAY()`;
    if (fieldName === "WithinQuarter") return `=${dateReference}<=EOMONTH(TODAY(),3)`;
    if (fieldName === "WithinMonth") return `=${dateReference}<=EOMONTH(TODAY(),1)`;
    return "";
  };
  const writeChangedFields = function(record, values) {
    const before = {};
    const after = {};
    Object.keys(values).forEach(fieldName => {
      const column = lCol(fieldName);
      if (column < 0 || sameValue(record.row[column], values[fieldName])) return;
      before[fieldName] = record.row[column];
      after[fieldName] = values[fieldName];
    });
    if (Engine.IO.serializeRow(before) === Engine.IO.serializeRow(after)) return [];

    Object.keys(after).forEach(fieldName => {
      lSheet.getRange(record.rowIdx, lCol(fieldName) + 1).setValue(after[fieldName]);
    });
    return Object.keys(after);
  };
  const ensureDerivedFormulas = function(rowIdx) {
    ["AfterToday", "WithinQuarter", "WithinMonth"].forEach(fieldName => {
      const column = lCol(fieldName);
      const formula = formulaFor(fieldName);
      if (column >= 0 && formula && !lSheet.getRange(rowIdx, column + 1).getFormula()) {
        lSheet.getRange(rowIdx, column + 1).setFormulaR1C1(formula);
      }
    });
  };

  // ...rest is unchanged — everything downstream already goes through pCol/lCol

  const existingRecords = {};
  const usedLineupUUIDs = new Set(Object.keys(ctx.registry || {}).map(id => String(id)));
  lData.forEach((row, idx) => {
    const existingUUID = String(row[lCol("UUID")] || "").trim();
    if (existingUUID) usedLineupUUIDs.add(existingUUID);
    const occurrenceKey = Engine.Ingest.lineupOccurrenceKey(ctx, row[lCol("Date")], row[lCol("Time")]);
    if (!occurrenceKey) return;
    const key = `${row[lCol("parentID")]}|${occurrenceKey}`;
    existingRecords[key] = { rowIdx: idx + 1, row: row, uuid: row[lCol("UUID")] };
  });

  pData.forEach((pRow, idx) => {
    const parentID = pRow[pCol("parentID")];
    const rawDates = pRow[pCol("DatesAndTimes")];
    if (!parentID || !rawDates) return;

    const rowIdx = idx + 2;
    const parsedDates = Engine.Ingest.parseParentDatesAndTimes(rawDates);

    if (parsedDates.dates.length === 0 && parsedDates.spans.length === 0) {
      Engine.Status.apply(ctx, pRole, rowIdx, "Manual Review", {
        stage: "INGEST",
        id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || rawDates}`
      });
      return;
    }

    // Build the final set of Lineup entries this row should produce.
    const entries = parsedDates.dateEntries.map(entry => ({ date: entry.date, raw: entry.raw, endDate: null }));

    parsedDates.spans.forEach(span => {
      const override = spanOverrideCol >= 0 ? String(pRow[spanOverrideCol] || "").trim().toUpperCase() : "";
      const policy = override || ctx.mode.spanDatePolicy || "BYPASS";

      if (policy === "MULTI_DAY") {
        entries.push({ date: span.start, endDate: span.end });
        return;
      }

      if (policy === "DAY_BY_DAY") {
        for (let d = new Date(span.start); d <= span.end; d.setDate(d.getDate() + 1)) {
          entries.push({ date: new Date(d), raw: span.raw, endDate: null });
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
      const occurrenceKey = Engine.Ingest.lineupOccurrenceKey(ctx, entry.date, entry.date);
      const lookupKey = `${parentID}|${occurrenceKey}`;
      const record = existingRecords[lookupKey];
      if (!record && deletedOccurrenceKeys.has(lookupKey)) {
        skippedDeletedOccurrences++;
        return;
      }
      const values = {};
      sourceFields.forEach(fieldName => {
        values[fieldName] = pRow[pCol(fieldName)];
      });
      values.parentID = parentID;
      values.Date = entry.date;
      values.Time = entry.date;
      values.RawDateStr = entry.raw || "";
      values.EventOfTotal = `${index + 1} of ${entries.length}`;
      values.EndDate = entry.endDate || "";

      const identity = Engine.getLibraryModule("Identity");
      if (identity && typeof identity.generate === "function") {
        values.SyncHash = identity.generate({
          title: values.EventName,
          date: values.Date,
          time: values.Time,
          venue: values.Venue
        }).hash;
      }

      if (record) {
        const currentStatus = record.row[lCol("SyncStatus")];
        if (Engine.Status.blocksWrite(ctx, currentStatus)) {
          Engine.Log.write(ctx, {
            stage: "INGEST",
            sheetName: lRole,
            rowIdx: record.rowIdx,
            id: record.uuid || parentID,
            type: "REFRESH_BLOCKED",
            details: `Parent Lineup update skipped because existing status "${currentStatus}" blocks writes.`
          });
          return;
        }

        const changedFields = writeChangedFields(record, values);
        if (changedFields.length) {
          if (lCol("LastUpdated") >= 0) {
            lSheet.getRange(record.rowIdx, lCol("LastUpdated") + 1).setValue(new Date());
          }
          Engine.Status.apply(ctx, lRole, record.rowIdx, "Active", {
            stage: "INGEST",
            id: record.uuid || parentID,
            details: `Updated from Parent Lineup: ${changedFields.join(", ")}`
          });
        } else if (currentStatus !== "Active") {
          Engine.Status.apply(ctx, lRole, record.rowIdx, "Active", {
            stage: "INGEST",
            id: record.uuid || parentID,
            details: "Confirmed current with Parent Lineup."
          });
        } else {
          const lastSyncedCol = lCol("LastSynced");
          if (lastSyncedCol >= 0) lSheet.getRange(record.rowIdx, lastSyncedCol + 1).setValue(new Date());
        }
        ensureDerivedFormulas(record.rowIdx);
      } else {
        const rowArray = new Array(lWidth).fill("");
        Object.keys(values).forEach(fieldName => {
          const column = lCol(fieldName);
          if (column >= 0) rowArray[column] = values[fieldName];
        });
        rowArray[lCol("UUID")] = Engine.Ingest.nextLineupUUID(parentID, usedLineupUUIDs);
        rowArray[lCol("SyncStatus")] = "Draft";
        if (lCol("LastSynced") >= 0) rowArray[lCol("LastSynced")] = new Date();
        if (lCol("LastUpdated") >= 0) rowArray[lCol("LastUpdated")] = new Date();
        lSheet.appendRow(rowArray);
        ensureDerivedFormulas(lSheet.getLastRow());
        Engine.Status.paint(ctx, lRole, lSheet.getLastRow(), "Draft");
      }
    });
  });

  if (skippedDeletedOccurrences) {
    Engine.Log.write(ctx, {
      stage: "INGEST",
      type: "DELETE_TOMBSTONES_RESPECTED",
      details: `${skippedDeletedOccurrences} previously deleted Lineup occurrence(s) were not regenerated.`
    });
  }
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

Engine.Ingest._lineupEndTime = function(ctx, lineupRow, lineupMap) {
  const startCol = Engine.getColumnIndex(lineupMap, "Date");
  const endDateCol = Engine.getColumnIndex(lineupMap, "EndDate");
  const start = startCol >= 0 ? new Date(lineupRow[startCol]) : new Date(NaN);
  if (isNaN(start.getTime())) return null;

  const rawEndDate = endDateCol >= 0 ? lineupRow[endDateCol] : "";
  if (rawEndDate) {
    const end = new Date(rawEndDate);
    if (!isNaN(end.getTime())) {
      end.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
      if (end > start) return end;
    }
  }

  const configuredDuration = Number(ctx.mode && ctx.mode.defaultDuration) || 2;
  return new Date(start.getTime() + configuredDuration * 60 * 60 * 1000);
};

/**
 * Parses the multiline DatesAndTimes cells used by Parent Lineup.
 */
Engine.Ingest.parseParentDatesAndTimes = function(rawDates) {
  const result = { dates: [], dateEntries: [], spans: [], errors: [] };
  const parserModule = Engine.getLibraryModule("TheatricalParser");
  if (!parserModule || typeof parserModule.parse !== "function" || !rawDates) {
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

    const parsed = parserModule.parse(content);
    if (parsed && parsed.startDate && !isNaN(parsed.startDate.getTime())) {
      result.dateEntries.push({ date: parsed.startDate, raw: line });
    } else if (!(parsed && parsed.isTBD)) {
      result.errors.push(content);
    }
  });

  result.dateEntries.sort((a, b) => a.date.getTime() - b.date.getTime());
  result.dates = result.dateEntries.map(entry => entry.date);
  return result;
};

Engine.Ingest._snapshotAndDeleteLineupRow = function(ctx, params) {
  const sheet = params.sheet;
  const map = params.map;
  const rowNumber = params.rowNumber;
  const uuid = String(params.uuid || "").trim();
  const uuidCol = Engine.getColumnIndex(map, "UUID");
  if (!sheet || !map || rowNumber < 2 || rowNumber > sheet.getLastRow() || uuidCol < 0) {
    throw new Error("Lineup row or UUID mapping is no longer available.");
  }

  const row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (String(row[uuidCol] || "").trim() !== uuid) {
    throw new Error(`Lineup UUID ${uuid} changed or moved before deletion.`);
  }
  if (params.requiredStatus) {
    const statusCol = Engine.getColumnIndex(map, "SyncStatus");
    if (statusCol < 0 || String(row[statusCol] || "").trim().toUpperCase() !== params.requiredStatus.toUpperCase()) {
      throw new Error(`Lineup UUID ${uuid} is no longer marked "${params.requiredStatus}".`);
    }
  }

  const rowObject = {};
  Object.keys(map).forEach(field => {
    const column = Engine.getColumnIndex(map, field);
    if (column >= 0) rowObject[field] = row[column];
  });
  const titleCol = Engine.getColumnIndex(map, "EventName");
  const parentIdCol = Engine.getColumnIndex(map, "parentID");
  const title = params.title !== undefined ? params.title : (titleCol >= 0 ? row[titleCol] : "");
  const parentID = params.parentID !== undefined ? params.parentID : (parentIdCol >= 0 ? row[parentIdCol] : "");
  const fingerprint = Engine.IO.serializeRow(rowObject);
  const location = `${sheet.getName()}!R${rowNumber}`;

  Engine.IDService.upsert(ctx, {
    id: uuid,
    type: params.role,
    title: title,
    parentId: parentID,
    fingerprint: fingerprint,
    location: location,
    status: "Active",
    details: `Snapshot saved before deletion. ${params.details}`
  });
  Engine.Log.write(ctx, {
    stage: params.stage,
    sheetName: sheet.getName(),
    rowIdx: rowNumber,
    id: uuid,
    type: params.logType,
    details: params.details
  });

  sheet.deleteRow(rowNumber);
  Engine.IDService.upsert(ctx, {
    id: uuid,
    status: "Deleted",
    location: "",
    details: `Deleted from ${sheet.getName()}. ${params.details}`
  });
  return { uuid: uuid, title: title, rowNumber: rowNumber };
};

Engine.Ingest._lineupDeletePendingCandidates = function(ctx, role, sheet, map) {
  role = role || Engine.Roles.resolve(ctx, "LINEUP");
  sheet = sheet || (role && Engine.getSheetByRole(ctx, role));
  map = map || (role && ctx.getMap(role));
  if (!role || !sheet || !map) throw new Error("Active Lineup sheet or map is missing.");

  const statusCol = Engine.getColumnIndex(map, "SyncStatus");
  const uuidCol = Engine.getColumnIndex(map, "UUID");
  const titleCol = Engine.getColumnIndex(map, "EventName");
  const parentIdCol = Engine.getColumnIndex(map, "parentID");
  if (statusCol < 0 || uuidCol < 0) {
    throw new Error("Lineup must map SyncStatus and UUID before Delete Pending rows can be processed.");
  }

  const rows = sheet.getDataRange().getValues();
  const uuidCounts = {};
  rows.slice(1).forEach(row => {
    const uuid = String(row[uuidCol] || "").trim();
    if (uuid) uuidCounts[uuid] = (uuidCounts[uuid] || 0) + 1;
  });
  const candidates = [];
  rows.forEach((row, index) => {
    if (index === 0 || String(row[statusCol] || "").trim().toUpperCase() !== "DELETE PENDING") return;
    const uuid = String(row[uuidCol] || "").trim();
    const eligible = !!uuid && uuidCounts[uuid] === 1;
    candidates.push({
      rowNumber: index + 1,
      uuid: uuid,
      title: titleCol >= 0 ? row[titleCol] : "",
      parentID: parentIdCol >= 0 ? row[parentIdCol] : "",
      eligible: eligible,
      reason: !uuid ? "Lineup row has no UUID." : eligible ? "" : `Lineup UUID ${uuid} is not unique.`
    });
  });
  const idMap = ctx.getMap("ID_LOG") || {};
  const idLogSheet = Engine.getSheetByRole(ctx, "ID_LOG");
  const canSnapshot = !!idLogSheet &&
    Engine.getColumnIndex(idMap, "UniqueID") >= 0 &&
    Engine.getColumnIndex(idMap, "SheetLocation") >= 0 &&
    (Engine.getColumnIndex(idMap, "Fingerprint") >= 0 || Engine.getColumnIndex(idMap, "SyncHash") >= 0);
  if (!canSnapshot) {
    candidates.forEach(candidate => {
      if (candidate.eligible) {
        candidate.eligible = false;
        candidate.reason = "idLog must map UniqueID, SheetLocation, and Fingerprint (or legacy SyncHash) to retain a pre-delete snapshot.";
      }
    });
  }
  return { role: role, sheet: sheet, map: map, candidates: candidates };
};

Engine.Ingest.previewLineupDeletePending = function(ctx) {
  const report = this._lineupDeletePendingCandidates(ctx);
  const eligible = report.candidates.filter(item => item.eligible).length;
  const result = {
    eligible: eligible,
    blocked: report.candidates.length - eligible,
    candidates: report.candidates
  };
  Engine.Log.write(ctx, {
    stage: "INGEST",
    sheetName: report.sheet.getName(),
    type: "DELETE_PENDING_PREVIEW",
    details: JSON.stringify(result)
  });
  return result;
};

Engine.Ingest.createLineupDeletionCleanupDecision = function(ctx, role, sheet, candidate) {
  const season = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase();
  const logRole = season === "DRAFT" ? "DRAFTCAL" : "CREWCAL";
  const logSheet = Engine.getSheetByRole(ctx, logRole);
  const logMap = ctx.getMap(logRole);
  if (!logSheet || !logMap) {
    Engine.Log.warn(ctx, "INGEST", `Cannot create calendar cleanup review for ${candidate.uuid}: ${logRole} sheet/map is missing.`);
    return false;
  }

  const uuidCol = Engine.getColumnIndex(logMap, "UUID");
  const sourceCol = Engine.getColumnIndex(logMap, "Source");
  const titleCol = Engine.getColumnIndex(logMap, "Title");
  const eventIdCol = Engine.getColumnIndex(logMap, "EventID");
  if (uuidCol < 0) {
    Engine.Log.warn(ctx, "INGEST", `Cannot create calendar cleanup review for ${candidate.uuid}: ${logRole}.UUID is not mapped.`);
    return false;
  }

  const matches = logSheet.getDataRange().getValues()
    .map((row, index) => ({ row: row, rowNumber: index + 1 }))
    .filter(item => item.rowNumber > 1 &&
      String(item.row[uuidCol] || "").trim() === candidate.uuid &&
      (sourceCol < 0 || String(item.row[sourceCol] || "").trim() === "Lineup"));
  if (!matches.length) {
    Engine.Log.write(ctx, {
      stage: "INGEST",
      sheetName: sheet.getName(),
      id: candidate.uuid,
      type: "LINEUP_DELETE_NO_CALENDAR_LOG",
      details: `Lineup row was deleted; no linked ${logRole} row requires a cleanup decision.`
    });
    return false;
  }
  if (matches.length !== 1) {
    Engine.Log.warn(ctx, "INGEST", `Cannot create calendar cleanup review for ${candidate.uuid}: found ${matches.length} matching ${logRole} rows.`);
    return false;
  }

  if (!Engine.Decisions || typeof Engine.Decisions.addPending !== "function") {
    throw new Error("Decision engine is unavailable; cannot queue the calendar cleanup review.");
  }

  const match = matches[0];
  const eventID = eventIdCol >= 0 ? String(match.row[eventIdCol] || "").trim() : "";
  if (logRole !== "CREWCAL" || !eventID) {
    Engine.Log.write(ctx, {
      stage: "INGEST",
      sheetName: logSheet.getName(),
      rowIdx: match.rowNumber,
      id: candidate.uuid,
      type: "LINEUP_DELETE_NO_CALENDAR_EVENT",
      details: logRole !== "CREWCAL"
        ? "Lineup row was deleted; staging-log row retained because it is not connected to an active calendar event."
        : "Lineup row was deleted; linked Crew Calendar log row retained because it has no EventID."
    });
    return false;
  }
  const suggestedAction = "KEEP_CALENDAR";
  const reviewID = Engine.Decisions.stableReviewID(
    "LINEUP_DELETE_CLEANUP",
    candidate.uuid,
    candidate.uuid,
    `${logRole}|${eventID}`
  );
  return Engine.Decisions.addPending(ctx, {
    ReviewID: reviewID,
    ReviewType: "LINEUP_DELETE_CLEANUP",
    SourceSheet: sheet.getName(),
    SourceID: candidate.uuid,
    CandidateSheet: logSheet.getName(),
    CandidateRow: match.rowNumber,
    CandidateID: candidate.uuid,
    CandidateTitle: titleCol >= 0 ? match.row[titleCol] : candidate.title,
    VenueEventID: eventID,
    Evidence: `Lineup row ${candidate.uuid} was deleted. Linked ${logRole} row ${match.rowNumber} remains${eventID ? ` with EventID ${eventID}` : " without an EventID"}.`,
    SuggestedAction: suggestedAction,
    SuggestionReason: "Default is to keep calendar data unchanged. A reviewer may choose MARK_CALENDAR_DELETE to mark the log row for the normal, permission-gated calendar sync.",
    Decision: "PENDING"
  });
};

Engine.Ingest.applyLineupCalendarCleanup = function(ctx, decision, action) {
  if (String(decision.ReviewType || "") !== "LINEUP_DELETE_CLEANUP") {
    throw new Error("Calendar cleanup actions are only supported for LINEUP_DELETE_CLEANUP reviews.");
  }
  if (action === "KEEP_CALENDAR") {
    return "Calendar log and event retained per reviewer decision.";
  }
  if (action !== "MARK_CALENDAR_DELETE") {
    throw new Error(`Unsupported Lineup calendar cleanup action: ${action}`);
  }

  const season = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase();
  const role = season === "DRAFT" ? "DRAFTCAL" : "CREWCAL";
  const sheet = Engine.getSheetByRole(ctx, role);
  const map = ctx.getMap(role);
  if (role !== "CREWCAL") {
    throw new Error("Calendar-event deletion is currently supported only for CREWCAL; DRAFTCAL is a staging log.");
  }
  if (!sheet || !map || sheet.getName() !== String(decision.CandidateSheet || "")) {
    throw new Error(`Calendar cleanup target does not match active role ${role}.`);
  }
  const uuidCol = Engine.getColumnIndex(map, "UUID");
  const sourceCol = Engine.getColumnIndex(map, "Source");
  const statusCol = Engine.getColumnIndex(map, "SyncStatus");
  const eventIdCol = Engine.getColumnIndex(map, "EventID");
  const uuid = String(decision.CandidateID || "").trim();
  if (!uuid || uuidCol < 0 || statusCol < 0 || eventIdCol < 0) {
    throw new Error(`${role} must map UUID, SyncStatus, and EventID for calendar cleanup.`);
  }

  const matches = sheet.getDataRange().getValues()
    .map((row, index) => ({ row: row, rowNumber: index + 1 }))
    .filter(item => item.rowNumber > 1 &&
      String(item.row[uuidCol] || "").trim() === uuid &&
      (sourceCol < 0 || String(item.row[sourceCol] || "").trim() === "Lineup"));
  if (matches.length !== 1) {
    throw new Error(`Expected one linked ${role} row for ${uuid}; found ${matches.length}.`);
  }
  const match = matches[0];
  if (!String(match.row[eventIdCol] || "").trim()) {
    throw new Error(`Linked ${role} row for ${uuid} has no EventID to delete.`);
  }
  Engine.Status.apply(ctx, role, match.rowNumber, "To Delete on calendar", {
    stage: "DECISION",
    id: uuid,
    details: `Marked for calendar-event deletion after Lineup row deletion (review ${decision.ReviewID}).`
  });
  Engine.Log.write(ctx, {
    stage: "DECISION",
    sheetName: sheet.getName(),
    rowIdx: match.rowNumber,
    id: uuid,
    type: "CALENDAR_DELETE_MARKED",
    details: "Calendar event marked for deletion by the permission-gated calendar sync; calendar-log row retained."
  });
  return `Marked ${uuid} in ${sheet.getName()} as To Delete on calendar; the log row remains for the normal calendar sync.`;
};

Engine.Ingest.applyLineupDeletePending = function(ctx, role, sheet, map) {
  const report = this._lineupDeletePendingCandidates(ctx, role, sheet, map);
  const candidates = report.candidates.slice().sort((a, b) => b.rowNumber - a.rowNumber);
  if (candidates.some(candidate => candidate.eligible)) {
    if (!Engine.Decisions || typeof Engine.Decisions.ensureSchema !== "function") {
      throw new Error("Decision engine is unavailable; refusing Lineup deletion without a calendar cleanup review path.");
    }
    Engine.Decisions.ensureSchema(ctx);
  }
  let deleted = 0;
  let blocked = 0;
  candidates.forEach(candidate => {
    if (!candidate.eligible) {
      blocked++;
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: report.sheet.getName(),
        rowIdx: candidate.rowNumber,
        id: candidate.uuid,
        type: "DELETE_PENDING_BLOCKED",
        details: candidate.reason
      });
      return;
    }
    const details = `[LINEUP_DELETE_SNAPSHOT] [LINEUP_DELETE_PENDING] Lineup row deleted per user status Delete Pending. ${candidate.title || ""}`.trim();
    this._snapshotAndDeleteLineupRow(ctx, {
      role: report.role,
      sheet: report.sheet,
      map: report.map,
      rowNumber: candidate.rowNumber,
      uuid: candidate.uuid,
      title: candidate.title,
      parentID: candidate.parentID,
      requiredStatus: "Delete Pending",
      stage: "INGEST",
      logType: "DELETE_PENDING_APPLIED",
      details: details
    });
    this.createLineupDeletionCleanupDecision(ctx, report.role, report.sheet, candidate);
    deleted++;
  });
  if (deleted) {
    Engine.IDService.syncAll(ctx);
    ctx.registry = Engine.IDService.loadRegistry(ctx);
  }
  if (candidates.length) {
    Engine.Log.write(ctx, {
      stage: "INGEST",
      sheetName: report.sheet.getName(),
      type: "DELETE_PENDING_SUMMARY",
      details: `${deleted} Lineup Delete Pending row(s) deleted; ${blocked} blocked.`
    });
  }
  return { deleted: deleted, blocked: blocked };
};

Engine.Ingest.previewLineupOrphanDeletion = function(ctx, decision) {
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const lMap = ctx.getMap(lRole);
  const pMap = ctx.getMap(pRole);
  if (!lSheet || !pSheet || !lMap || !pMap) {
    return { eligible: false, reason: "Active Parent or Lineup sheet/map is missing." };
  }
  if (String(decision.ReviewType || "") !== "LINEUP_ORPHAN") {
    return { eligible: false, reason: "MARK_DELETE is only supported for LINEUP_ORPHAN reviews." };
  }
  if (String(decision.CandidateSheet || "") !== lSheet.getName()) {
    return { eligible: false, reason: "Decision does not target the active season's Lineup sheet." };
  }

  const uuid = String(decision.CandidateID || "").trim();
  const uuidCol = Engine.getColumnIndex(lMap, "UUID");
  const parentIdCol = Engine.getColumnIndex(lMap, "parentID");
  const eventNameCol = Engine.getColumnIndex(lMap, "EventName");
  const parentKeyCol = Engine.getColumnIndex(pMap, "parentID");
  if (!uuid || uuidCol < 0 || parentIdCol < 0 || parentKeyCol < 0) {
    return { eligible: false, reason: "Decision UUID or identity fields are missing." };
  }

  const matchingRows = lSheet.getDataRange().getValues()
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .filter(item => item.rowNumber > 1 && String(item.row[uuidCol] || "").trim() === uuid);
  if (matchingRows.length !== 1) {
    return {
      eligible: false,
      reason: matchingRows.length === 0
        ? `Lineup UUID ${uuid} no longer exists.`
        : `Lineup UUID ${uuid} is not unique (${matchingRows.length} matching rows).`,
      uuid: uuid
    };
  }

  const match = matchingRows[0];
  const parentID = String(match.row[parentIdCol] || "").trim();
  const parentIDs = new Set(pSheet.getDataRange().getValues().slice(1)
    .map(row => String(row[parentKeyCol] || "").trim())
    .filter(Boolean));
  if (!parentID || parentIDs.has(parentID)) {
    return {
      eligible: false,
      reason: `Lineup UUID ${uuid} is no longer an orphan of the active Parent sheet.`,
      uuid: uuid,
      rowNumber: match.rowNumber,
      parentID: parentID,
      title: eventNameCol >= 0 ? match.row[eventNameCol] : ""
    };
  }

  return {
    eligible: true,
    uuid: uuid,
    rowNumber: match.rowNumber,
    parentID: parentID,
    title: eventNameCol >= 0 ? match.row[eventNameCol] : ""
  };
};

Engine.Ingest.deleteLineupOrphan = function(ctx, decision) {
  const preview = Engine.Ingest.previewLineupOrphanDeletion(ctx, decision);
  if (!preview.eligible) throw new Error(preview.reason);

  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const lSheet = Engine.getSheetByRole(ctx, lRole);
  const lMap = ctx.getMap(lRole);
  const details = `[LINEUP_DELETE_SNAPSHOT] Deleting orphan Lineup row "${preview.title}" per reviewed decision ${decision.ReviewID}; complete pre-delete row snapshot saved in idLog.Fingerprint.`;
  const result = this._snapshotAndDeleteLineupRow(ctx, {
    role: lRole,
    sheet: lSheet,
    map: lMap,
    rowNumber: preview.rowNumber,
    uuid: preview.uuid,
    title: preview.title,
    parentID: preview.parentID,
    stage: "DECISION",
    logType: "ROW_DELETE_APPROVED",
    details: details
  });
  Engine.IDService.syncAll(ctx);
  this.createLineupDeletionCleanupDecision(ctx, lRole, lSheet, {
    uuid: preview.uuid,
    title: preview.title,
    rowNumber: preview.rowNumber
  });
  return result;
};

// Resolves exactly one Parent row for a review. parentID may be duplicated, so CandidateRow/CandidateTitle disambiguate.
Engine.Ingest._resolveParentTarget = function(ctx, decision) {
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const pMap = ctx.getMap(pRole);
  if (!pSheet || !pMap) throw new Error("Active Parent sheet/map is missing.");
  const idCol = Engine.getColumnIndex(pMap, "parentID");
  const titleCol = Engine.getColumnIndex(pMap, "EventName");
  if (idCol < 0) throw new Error("Parent sheet must map parentID.");

  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
  const type = String(decision.ReviewType || "");
  const parentID = String((type === "PARENT_DUPLICATE" ? decision.DuplicateParentID : decision.ExistingParentID) || decision.CandidateID || "").trim();
  if (!parentID) throw new Error("Review has no parentID to act on.");

  const data = pSheet.getDataRange().getValues();
  let matches = data
    .map((row, index) => ({ row: row, rowNumber: index + 1 }))
    .filter(item => item.rowNumber > 1 && String(item.row[idCol] || "").trim() === parentID);
  if (!matches.length) throw new Error(`Parent row ${parentID} no longer exists.`);

  if (matches.length > 1) {
    const hinted = Number(decision.CandidateRow);
    if (String(decision.CandidateSheet || "") === pSheet.getName() && matches.some(item => item.rowNumber === hinted)) {
      matches = matches.filter(item => item.rowNumber === hinted);
    }
  }
  if (matches.length > 1 && titleCol >= 0 && decision.CandidateTitle) {
    const wanted = normalize(decision.CandidateTitle);
    const byTitle = matches.filter(item => normalize(item.row[titleCol]) === wanted);
    if (byTitle.length) matches = byTitle;
  }
  if (matches.length > 1) {
    throw new Error(`parentID ${parentID} is used by ${matches.length} Parent rows; resolve it with a PARENT_ID_DUPLICATE review first.`);
  }

  const match = matches[0];
  return {
    role: pRole,
    sheet: pSheet,
    map: pMap,
    rowNumber: match.rowNumber,
    parentID: parentID,
    title: titleCol >= 0 ? match.row[titleCol] : ""
  };
};

Engine.Ingest.previewParentDeletion = function(ctx, decision) {
  try {
    const target = this._resolveParentTarget(ctx, decision);
    return { eligible: true, uuid: target.parentID, title: target.title, rowNumber: target.rowNumber };
  } catch (error) {
    return { eligible: false, reason: error.message };
  }
};

// Delete Pending is applied (with decision supersede + audit entry) by the next Ingest Season run.
Engine.Ingest.markParentDelete = function(ctx, decision) {
  const target = this._resolveParentTarget(ctx, decision);
  Engine.Status.apply(ctx, target.role, target.rowNumber, "Delete Pending", {
    stage: "DECISION",
    id: target.parentID,
    details: `Marked for deletion per reviewed decision ${decision.ReviewID}.`
  });
  return target;
};

// Bypassed rows are skipped by verification so a retained row is not queued again.
Engine.Ingest.retainParentRow = function(ctx, decision) {
  const target = this._resolveParentTarget(ctx, decision);
  Engine.Status.apply(ctx, target.role, target.rowNumber, "Bypassed", {
    stage: "DECISION",
    id: target.parentID,
    details: `Retained per reviewed decision ${decision.ReviewID}; no matching import row required.`
  });
  return target;
};

Engine.Ingest.reassignParentID = function(ctx, decision) {
  const target = this._resolveParentTarget(ctx, decision);
  const idCol = Engine.getColumnIndex(target.map, "parentID");
  const taken = new Set(target.sheet.getDataRange().getValues().slice(1).map(row => String(row[idCol] || "").trim()));
  let newID = "";
  do {
    newID = "P-" + Utilities.getUuid().split("-")[0].toUpperCase();
  } while (taken.has(newID));

  target.sheet.getRange(target.rowNumber, idCol + 1).setValue(newID);
  Engine.Status.apply(ctx, target.role, target.rowNumber, "Active", {
    stage: "DECISION",
    id: newID,
    details: `parentID reassigned from duplicated ${target.parentID} per reviewed decision ${decision.ReviewID}.`
  });
  Engine.IDService.syncAll(ctx);
  ctx.registry = Engine.IDService.loadRegistry(ctx);
  return { rowNumber: target.rowNumber, title: target.title, oldID: target.parentID, newID: newID };
};

function previewLineupDeletePending() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Preview Lineup Delete Pending");
  return Engine.Ingest.previewLineupDeletePending(ctx);
}

Engine.Ingest.syncLineupToLog = function(ctx, options) {
  options = options || {};
  const isDraftSeason = String((ctx.mode && ctx.mode.targetSeason) || "Current").trim().toUpperCase() === "DRAFT";
  const targetRole = options.targetRole || (isDraftSeason ? "DRAFTCAL" : "CREWCAL");

  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
  const lMap = ctx.getMap(lRole);
  const logSheet = Engine.getSheetByRole(ctx, targetRole);
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
  const requestedUUID = String(options.uuid || "").trim();

  // Anchor identity: a log row is linked to its Lineup row via Source="Lineup" + matching UUID.
  const logRows = scanSheet(targetRole, ctx);
  const existingByUUID = {};
  logRows.forEach(row => {
    if (row.Source === "Lineup" && row.UUID) existingByUUID[row.UUID] = row;
  });

  const newRows = [];
  const changedRows = [];
  let skippedLocked = 0;
  let flaggedBadDate = 0;

  lData.forEach(lRow => {
    const uuid = lRow[lCol("UUID")];
    if (requestedUUID && String(uuid || "").trim() !== requestedUUID) return;
    const title = lRow[lCol("EventName")];
    if (!uuid || !title) return;

    const lineupStatus = String(lRow[lCol("SyncStatus")] || "").trim();
    if (lineupStatus === "Delete Pending" || Engine.Status.blocksWrite(ctx, lineupStatus)) {
      skippedLocked++;
      return;
    }

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

    const end = Engine.Ingest._lineupEndTime(ctx, lRow, lMap);

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
        LastUpdated: new Date(),
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

    const comparison = Engine.IO.compare(ctx, {
      source: { EventName: title, Start: start, End: end, Venue: location },
      destination: existing,
      sourceRole: Engine.Roles.resolve(ctx, "LINEUP"),
      destinationRole: targetRole,
      fields: ["EventName", "Start", "End", "Venue"],
      fieldAliases: { EventName: "Title", Venue: "Location" },
      comparisonModes: { Start: "timestamp", End: "timestamp" },
      identifier: uuid
    });

    if (!comparison.equal) {
      existing.Title = title;
      existing.Date = start;
      existing.Start = start;
      existing.End = end;
      existing.Location = location;
      existing.LastUpdated = new Date();
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
      Engine.Status.paint(ctx, targetRole, logSheet.getLastRow(), obj.SyncStatus || "Manual Review");
    });
  }

  if (changedRows.length > 0) {
    patchRows(targetRole, changedRows, ctx);
  }

  Engine.IO.sortLogByDate(ctx, targetRole);
  Engine.IDService.syncAll(ctx);

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
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const pMap = ctx.getMap(pRole);
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
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
  if (!iSheet || !pSheet || !iMap || !pMap) {
    Engine.Log.error(ctx, "VERIFY_IMPORT", "import or Parent Lineup sheet/map not found.");
    return;
  }
  const iSheetName = iSheet.getName();
  const pSheetName = pSheet.getName();

  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  const iData = iSheet.getDataRange().getValues();
  iData.shift();
  const pData = pSheet.getDataRange().getValues();
  pData.shift();

  // Shared normalize (scriptLib SL.Utils) — collapse + fold so titles that
  // picked up smart punctuation via IMPORTRANGE still match their Parent row.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
  const pByName = {};
  pData.forEach((row, idx) => {
    const name = normalize(row[pCol("EventName")]);
    if (name) pByName[name] = { row: row, rowIdx: idx + 2 };
  });

  const fieldsToCompare = ["EventName", "Series", "Opening", "Range", "Venue", "Pricing"];
  const pRowValue = (row, fieldName) => {
    const index = pCol(fieldName);
    return index >= 0 ? row[index] : "";
  };
  const normalizeForCompare = value => normalize(value).toLowerCase();
  const comparisonTokens = value => normalizeForCompare(value).match(/[a-z0-9]+/g) || [];
  const titleSimilarityScore = (a, b) => {
    const leftTokens = comparisonTokens(a);
    const rightTokens = comparisonTokens(b);
    const left = leftTokens.join(" ");
    const right = rightTokens.join(" ");
    if (!left || !right) return 0;
    if (left === right) return 100;
    if (left.includes(right) || right.includes(left)) return 80;
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const overlap = Array.from(leftSet).filter(token => rightSet.has(token)).length;
    return Math.round((overlap / Math.max(leftSet.size, rightSet.size)) * 100);
  };
  const openingSimilarity = (left, right) => {
    const a = left instanceof Date ? left : new Date(left);
    const b = right instanceof Date ? right : new Date(right);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return { score: 0, reason: "" };
    const days = Math.abs(a.getTime() - b.getTime()) / 86400000;
    if (a.getFullYear() === b.getFullYear() && days <= 60) {
      return { score: Math.round(20 * (1 - days / 61)), reason: `openings ${Math.round(days)} day(s) apart` };
    }
    const anchorA = Date.UTC(2000, a.getMonth(), a.getDate());
    const anchorB = Date.UTC(2000, b.getMonth(), b.getDate());
    const dayDifference = Math.abs(anchorA - anchorB) / 86400000;
    const calendarDistance = Math.min(dayDifference, 366 - dayDifference);
    return calendarDistance <= 30
      ? { score: Math.round(12 * (1 - calendarDistance / 31)), reason: `openings near the same annual date (${calendarDistance} day(s) apart)` }
      : { score: 0, reason: "" };
  };
  const scoreImportParentCandidate = (parentRow, importRow, importRowNumber) => {
    const reasons = [];
    let score = 0;
    const titleScore = titleSimilarityScore(pRowValue(parentRow, "EventName"), importRow[iCol("EventName")]);
    if (titleScore) {
      const points = Math.round(titleScore * 0.35);
      score += points;
      reasons.push(`title similarity ${titleScore}%`);
    }

    const parentSeries = normalizeForCompare(pRowValue(parentRow, "Series"));
    const importSeries = normalizeForCompare(importRow[iCol("Series")]);
    if (parentSeries && importSeries && parentSeries === importSeries) {
      score += 25;
      reasons.push("same series");
    }

    const parentVenue = normalizeForCompare(pRowValue(parentRow, "Venue"));
    const importVenue = normalizeForCompare(importRow[iCol("Venue")]);
    if (parentVenue && importVenue && parentVenue === importVenue) {
      score += 15;
      reasons.push("same venue");
    }

    const opening = openingSimilarity(pRowValue(parentRow, "Opening"), importRow[iCol("Opening")]);
    if (opening.score) {
      score += opening.score;
      reasons.push(opening.reason);
    }

    const parentRange = normalizeForCompare(pRowValue(parentRow, "Range"));
    const importRange = normalizeForCompare(importRow[iCol("Range")]);
    if (parentRange && importRange && parentRange === importRange) {
      score += 15;
      reasons.push("same date range");
    }
    return {
      importRow: importRowNumber,
      importTitle: importRow[iCol("EventName")] || "",
      importOpening: importRow[iCol("Opening")] || "",
      importRange: importRow[iCol("Range")] || "",
      importVenue: importRow[iCol("Venue")] || "",
      score: Math.min(100, score),
      reasons: reasons
    };
  };
  const likelyParentMatches = function(parentRow) {
    return iData
      .map((iRow, index) => scoreImportParentCandidate(parentRow, iRow, index + 2))
      .filter(match => match.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(match => Object.assign({}, match, { reasons: match.reasons.join(", ") }));
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
    // A reviewer already decided these rows (retain / delete); do not queue them again.
    if (["Bypassed", "Delete Pending"].includes(String(currentStatus || "").trim())) return false;
    if (Engine.Status.blocksWrite(ctx, currentStatus)) {
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: pSheetName,
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
    Engine.Status.apply(ctx, pRole, rowIdx, statusName, {
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
    let renameMatchEvidence = "";

    if (!match) {
      const candidates = pData
        .map((row, rowIndex) => ({
          row: row,
          rowIdx: rowIndex + 2,
          evidence: scoreImportParentCandidate(row, iRow, index + 2)
        }))
        .filter(candidate => !matchedParentRows[candidate.rowIdx] && candidate.evidence.score >= 55)
        .sort((a, b) => b.evidence.score - a.evidence.score);
      const best = candidates[0];
      const runnerUp = candidates[1];
      if (best && (!runnerUp || best.evidence.score - runnerUp.evidence.score >= 12)) {
        match = best;
        isRenameCandidate = true;
        renameMatchEvidence = `Likely same event: ${best.evidence.reasons.join(", ")} (match score ${best.evidence.score}/100).`;
        renamedCandidate++;
      } else {
        importOnly++;
        Engine.Log.write(ctx, {
          stage: "VERIFY_IMPORT",
          sheetName: iSheetName,
          rowIdx: index + 2,
          id: name,
          type: "IMPORT_ONLY",
          details: candidates.length
            ? `No confident Parent match. Leading candidates: ${candidates.slice(0, 3).map(candidate => `${candidate.row[pCol("EventName")]} (${candidate.evidence.score}/100: ${candidate.evidence.reasons.join(", ")})`).join("; ")}.`
            : "No matching Parent Lineup row found."
        });
        return;
      }
    }

    matchedParentRows[match.rowIdx] = true;

    // One shared comparison per matched pair (Engine.IO.compare) — drives
    // drift detection, the changed-field list, the readable comparison
    // string, and the decision evidence. Only fields present in BOTH maps
    // are compared (a missing column is not drift, matching the old behavior).
    const compareFields = fieldsToCompare.filter(field => iCol(field) >= 0 && pCol(field) >= 0);
    const comparison = Engine.IO.compare(ctx, {
      source: iRow,
      destination: match.row,
      sourceMap: iMap,
      destMap: pMap,
      fields: compareFields,
      identifier: match.row[pCol("parentID")] || "NO_PARENT_ID"
    });
    const drifted = !comparison.equal;
    const fieldComparison = comparison.changed.map(entry =>
      `${entry.field}: import="${entry.source}" | Parent="${entry.destination}"`
    ).join(" | ");

    if (drifted || isRenameCandidate) {
      flagged++;
      const wantedAction = isRenameCandidate ? "ACCEPT_IMPORT" : "REVIEW_IMPORT_DRIFT";
      const changedFields = isRenameCandidate
        ? Array.from(new Set(["EventName"].concat(comparison.changed.map(entry => entry.field))))
        : comparison.changed.map(entry => entry.field);
      const reviewType = isRenameCandidate ? "IMPORT_RENAME" : "IMPORT_DRIFT";
      const evidenceStr = isRenameCandidate
        ? `${renameMatchEvidence} Import fields: ${fieldComparison || "no mapped differences"}`
        : fieldComparison;
      const parentId = match.row[pCol("parentID")] || "NO_PARENT_ID";
      const reviewId = Engine.Decisions && typeof Engine.Decisions.stableReviewID === "function"
        ? Engine.Decisions.stableReviewID(reviewType, name, parentId, evidenceStr)
        : `IMPORT_PARENT_${index + 2}_${parentId}`;

      const decisionValues = {
        ReviewID: reviewId,
        ReviewType: reviewType,
        SourceSheet: iSheetName,
        SourceRow: index + 2,
        SourceID: name,
        CandidateSheet: pSheetName,
        CandidateRow: match.rowIdx,
        CandidateID: match.row[pCol("parentID")],
        ImportTitle: name,
        ParentTitle: match.row[pCol("EventName")],
        ExistingParentID: match.row[pCol("parentID")],
        MatchedFields: isRenameCandidate ? match.evidence.reasons.join(", ") : "EventName",
        ChangedFields: changedFields.join(", "),
        ChangedDetails: isRenameCandidate
          ? `Possible cross-layer match. Parent "${match.row[pCol("EventName")]}" vs Import "${name}". ${fieldComparison}`
          : fieldComparison,
        Evidence: isRenameCandidate
          ? `Import row ${index + 2} vs Parent Lineup row ${match.rowIdx}: ${evidenceStr}`
          : `Import row ${index + 2} vs Parent Lineup row ${match.rowIdx}: ${fieldComparison}`,
        Confidence: isRenameCandidate ? (match.evidence.score >= 75 ? "HIGH" : "MEDIUM") : "LOW",
        SuggestedAction: wantedAction,
        SuggestionReason: isRenameCandidate
          ? "Multiple title, series, date, range, and venue signals suggest a related event; confirm identity and intended field changes before applying."
          : "Row differs from import and needs explicit review before mutation.",
        SuggestedKeepID: match.row[pCol("parentID")] || "",
        CandidateIDs: match.row[pCol("parentID")] || "",
        KeepChoice: isRenameCandidate ? "KEEP_EXISTING" : "",
        RequestedAction: wantedAction
      };
      // Rename candidates are a drift/rename situation (import is the source
      // of truth), NOT a duplicate — import and Parent rows matching on
      // Opening/Range/Venue is expected. "Possible Duplicate" is reserved for
      // Parent Lineup rows that look like *each other*.
      applyReviewStatus(
        match.rowIdx,
        match.row[pCol("parentID")],
        "Manual Review",
        isRenameCandidate ? `Possible renamed event: import "${name}" vs Parent "${match.row[pCol("EventName")]}"` : "Parent Lineup no longer matches import.",
        decisionValues
      );
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: pSheetName,
        rowIdx: match.rowIdx,
        id: match.row[pCol("parentID")],
        type: isRenameCandidate ? "RENAME_CANDIDATE" : "DRIFT_DETECTED",
        details: isRenameCandidate
          ? `Possible renamed event: import "${name}" vs Parent Lineup "${match.row[pCol("EventName")]}".`
          : "Parent Lineup no longer matches import for this event."
      });
    } else {
      // Clean match: Parent Lineup matches import.
      // If the parent row was previously flagged with an engine diagnostic status (Manual Review, Data Drift Detected),
      // heal it back to 'Synced' and supersede any active drift decisions for this parentID.
      const currentStatus = String(match.row[pCol("SyncStatus")] || "").trim();
      const parentId = match.row[pCol("parentID")];
      const healableStatuses = ["Manual Review", "Data Drift Detected"];
      if (healableStatuses.includes(currentStatus) && !Engine.Status.blocksWrite(ctx, currentStatus)) {
        Engine.Status.apply(ctx, pRole, match.rowIdx, "Synced", {
          stage: "VERIFY_IMPORT",
          id: parentId,
          details: "Drift resolved: Parent Lineup now cleanly matches import source.",
          suppressLog: false
        });

        // Mark any pending IMPORT_DRIFT / IMPORT_PARENT decision as SUPERSEDED
        if (parentId && Engine.Decisions && typeof Engine.Decisions.reviewable === "function") {
          Engine.Decisions.reviewable(ctx)
            .filter(d => (d.ExistingParentID === parentId || d.CandidateID === parentId) &&
                         ["IMPORT_DRIFT", "IMPORT_PARENT", "IMPORT_RENAME"].includes(String(d.ReviewType || "")))
            .forEach(d => {
              Engine.Decisions.markSuperseded(ctx, d.ReviewID, "Drift resolved: Parent Lineup now cleanly matches import.");
            });
        }
      } else if (!Engine.Status.blocksWrite(ctx, currentStatus) && pCol("LastSynced") >= 0) {
        // Verified clean against import, so record that this pass confirmed the row.
        pSheet.getRange(match.rowIdx, pCol("LastSynced") + 1).setValue(new Date());
      }
    }
  });

  // Rows sharing a parentID: the import-matched (else first) row keeps the ID; the rest get a review.
  const idRows = {};
  pData.forEach((row, idx) => {
    const id = String(row[pCol("parentID")] || "").trim();
    if (id) (idRows[id] = idRows[id] || []).push(idx + 2);
  });
  const duplicateSecondary = {};
  let duplicateParentIDs = 0;
  Object.keys(idRows).filter(id => idRows[id].length > 1).forEach(id => {
    const rows = idRows[id];
    const primary = rows.find(rowNum => matchedParentRows[rowNum]) || rows[0];
    rows.filter(rowNum => rowNum !== primary).forEach(rowNum => {
      const row = pData[rowNum - 2];
      const status = String(row[pCol("SyncStatus")] || "").trim();
      if (["Bypassed", "Delete Pending"].includes(status)) return;
      duplicateSecondary[rowNum] = true;
      duplicateParentIDs++;
      const title = row[pCol("EventName")] || "";
      const matchedImport = Boolean(matchedParentRows[rowNum]);
      const suggested = matchedImport ? "REASSIGN_PARENT_ID" : "MARK_DELETE";
      Engine.Status.apply(ctx, pRole, rowNum, "Duplicate (ID Match)", {
        stage: "VERIFY_IMPORT",
        id: id,
        details: `parentID ${id} is also used by row ${primary}.`,
        suppressLog: true
      });
      addDecision({
        ReviewID: Engine.Decisions.stableReviewID("PARENT_ID_DUPLICATE", id, title, title),
        ReviewType: "PARENT_ID_DUPLICATE",
        SourceSheet: pSheetName,
        SourceRow: rowNum,
        SourceID: id,
        CandidateSheet: pSheetName,
        CandidateRow: rowNum,
        CandidateID: id,
        CandidateTitle: title,
        ParentTitle: title,
        ExistingParentID: id,
        Evidence: `parentID ${id} is used by rows ${rows.join(", ")}. Row ${rowNum} "${title}" ${matchedImport ? "also matches an import row" : "has no import match"}; row ${primary} keeps the ID.`,
        Confidence: "HIGH",
        SuggestedAction: suggested,
        SuggestionReason: matchedImport
          ? "Both rows are live events; give this row its own parentID."
          : "Leftover row with no import match; mark it for deletion, or choose MARK_BYPASS to keep it.",
        RequestedAction: suggested,
        Decision: "PENDING",
        ActionStatus: "PENDING"
      });
      Engine.Log.write(ctx, {
        stage: "VERIFY_IMPORT",
        sheetName: pSheetName,
        rowIdx: rowNum,
        id: id,
        type: "DUPLICATE_PARENT_ID",
        details: `parentID ${id} is also used by row ${primary}.`
      });
    });
  });

  pData.forEach((pRow, index) => {
    const rowIdx = index + 2;
    if (matchedParentRows[rowIdx] || duplicateSecondary[rowIdx]) return;
    if (String(pRow[pCol("SyncStatus")] || "").trim() === "Bypassed") return;
    parentOnly++;
    const likelyMatches = likelyParentMatches(pRow);
    const bestMatch = likelyMatches[0];
    const hasExactSourceMatch = bestMatch &&
      normalize(pRowValue(pRow, "Opening")) === normalize(bestMatch.importOpening) &&
      normalize(pRowValue(pRow, "Range")) === normalize(bestMatch.importRange) &&
      normalize(pRowValue(pRow, "Venue")) === normalize(bestMatch.importVenue);
    const hasConfidentLikelyMatch = bestMatch &&
      bestMatch.score >= 55 &&
      (!likelyMatches[1] || bestMatch.score - likelyMatches[1].score >= 12);
    const sourceCandidate = hasExactSourceMatch || hasConfidentLikelyMatch ? bestMatch : null;
    const likelyCandidateEvidence = likelyMatches.length
      ? `Likely Import candidates: ${likelyMatches.map((candidate, candidateIndex) =>
        `#${candidateIndex + 1} row ${candidate.importRow} "${candidate.importTitle}" (${candidate.score}/100; ${candidate.reasons})`
      ).join("; ")}.`
      : "No likely Import candidates scored.";
    const parentId = pRow[pCol("parentID")] || rowIdx;
    const reviewId = Engine.Decisions && typeof Engine.Decisions.stableReviewID === "function"
      ? Engine.Decisions.stableReviewID("PARENT_ONLY", "NONE", parentId, pRow[pCol("EventName")] || "")
      : `PARENT_ONLY_${parentId}`;
    const decisionValues = {
      ReviewID: reviewId,
      ReviewType: "PARENT_ONLY",
      SourceSheet: sourceCandidate ? iSheetName : "",
      SourceRow: sourceCandidate ? sourceCandidate.importRow : "",
      SourceID: sourceCandidate ? sourceCandidate.importTitle : "",
      CandidateSheet: pSheetName,
      CandidateRow: rowIdx,
      CandidateID: pRow[pCol("parentID")],
      CandidateTitle: pRow[pCol("EventName")],
      ImportTitle: sourceCandidate ? sourceCandidate.importTitle : "",
      ParentTitle: pRow[pCol("EventName")],
      ExistingParentID: pRow[pCol("parentID")],
      MatchedFields: sourceCandidate ? sourceCandidate.reasons : "",
      Evidence: `${likelyCandidateEvidence} ${hasExactSourceMatch
        ? "Top candidate matches the existing schedule/venue fallback."
        : hasConfidentLikelyMatch
          ? "Top candidate is a unique likely relationship; confirm it is the same event before applying changes."
          : "No source candidate was selected; do not treat these similarity results as an identity match."}`,
      Confidence: hasExactSourceMatch ? "HIGH" : hasConfidentLikelyMatch ? (bestMatch.score >= 75 ? "HIGH" : "MEDIUM") : "LOW",
      SuggestedAction: hasExactSourceMatch ? "ACCEPT_IMPORT" : "REVIEW_PARENT_ONLY",
      SuggestionReason: hasExactSourceMatch
        ? `Exact import match at row ${bestMatch.importRow}; accept import as the source of truth for the retained Parent ID.`
        : hasConfidentLikelyMatch
          ? "A likely related Import row was found from title, series, date, range, and venue signals. Review the evidence; no source change is applied automatically."
          : likelyMatches.length
            ? "Likely Import candidates are ambiguous or below the selection threshold. Review candidate evidence; no identity match is assumed."
            : "No confident matching import row found; review before deleting or merging.",
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
      sheetName: pSheetName,
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
    details: `Checked ${iData.length} import rows.\n${flagged} flagged (${renamedCandidate} possible rename)\n${importOnly} import-only\n${parentOnly} Parent Lineup-only\n${parentDuplicateSuggestions.created} Parent duplicate suggestions created\n${duplicateParentIDs} duplicated parentID row(s)`
  });

  return {
    checked: iData.length,
    flagged: flagged,
    renamedCandidate: renamedCandidate,
    importOnly: importOnly,
    parentOnly: parentOnly,
    parentDuplicateSuggestions: parentDuplicateSuggestions.created,
    duplicateParentIDs: duplicateParentIDs
  };
};

Engine.Ingest.refreshParentOnlyDecisions = function(ctx) {
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const importSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const parentMap = ctx.getMap(pRole);
  const importMap = ctx.getMap(iRole);
  if (!parentSheet || !importSheet || !parentMap || !importMap) {
    throw new Error("Parent Lineup, import, or their maps are missing");
  }

  const pCol = field => Engine.getColumnIndex(parentMap, field);
  const iCol = field => Engine.getColumnIndex(importMap, field);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
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
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const parentSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const parentMap = ctx.getMap(pRole);
  if (!parentSheet || !parentMap) throw new Error("Parent Lineup sheet or map is missing for the active mode's target season");

  const pCol = field => Engine.getColumnIndex(parentMap, field);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });
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

Engine.Ingest.refreshRelevantDecisions = function(ctx) {
  let totalSuperseded = 0;
  try {
    const parentOnlyRes = Engine.Ingest.refreshParentOnlyDecisions(ctx);
    totalSuperseded += (parentOnlyRes && parentOnlyRes.superseded) || 0;
  } catch (e) {
    Engine.Log.warn(ctx, "DECISION", `refreshParentOnlyDecisions: ${e.message}`);
  }

  try {
    const parentDupRes = Engine.Ingest.refreshParentDuplicateDecisions(ctx);
    totalSuperseded += (parentDupRes && parentDupRes.superseded) || 0;
  } catch (e) {
    Engine.Log.warn(ctx, "DECISION", `refreshParentDuplicateDecisions: ${e.message}`);
  }

  // Check Lineup drift decisions
  try {
    const lRole = Engine.Roles.resolve(ctx, "LINEUP");
    const lSheet = Engine.getSheetByRole(ctx, lRole);
    const lMap = ctx.getMap(lRole);
    if (lSheet && lMap && Engine.Decisions && typeof Engine.Decisions.reviewable === "function") {
      const lData = lSheet.getDataRange().getValues();
      const uuidCol = Engine.getColumnIndex(lMap, "UUID");
      const statusCol = Engine.getColumnIndex(lMap, "SyncStatus");
      const lByUuid = {};
      for (let i = 1; i < lData.length; i++) {
        const u = lData[i][uuidCol];
        if (u) lByUuid[u] = lData[i];
      }

      Engine.Decisions.reviewable(ctx)
        .filter(d => String(d.ReviewType || "") === "PARENT_LINEUP_DRIFT")
        .forEach(d => {
          const row = lByUuid[d.CandidateID];
          if (!row || (statusCol >= 0 && String(row[statusCol] || "").trim() === "Synced")) {
            if (Engine.Decisions.markSuperseded(ctx, d.ReviewID, "Lineup performance is now Synced or row was removed.")) {
              totalSuperseded++;
            }
          }
        });
    }
  } catch (lErr) {
    Engine.Log.warn(ctx, "DECISION", `refreshRelevantDecisions Lineup pass: ${lErr.message}`);
  }

  return { superseded: totalSuperseded };
};

function refreshRelevantDecisions() {
  const ctx = Engine.getContext();
  Engine.Log.command(ctx, "Refresh Stale Reviews");
  const results = Engine.Ingest.refreshRelevantDecisions(ctx);
  Engine.Log.write(ctx, { stage: "USER_COMMAND", id: "Refresh Stale Reviews", type: "COMMAND_COMPLETE", details: JSON.stringify(results) });
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
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const lRole = Engine.Roles.resolve(ctx, "LINEUP");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const lSheet = lRole && Engine.getSheetByRole(ctx, lRole);
  const pMap = ctx.getMap(pRole);
  const lMap = ctx.getMap(lRole);
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
    const status = String(row[lCol("SyncStatus")] || "").trim();
    const statusBehaviors = Engine.Status.getBehavior(ctx, status);
    if (statusBehaviors.includes("BYPASS")) return;
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
      Engine.Status.apply(ctx, pRole, pData.indexOf(pRow) + 2, "Manual Review", {
        stage: "VERIFY_PARENT",
        id: parentID,
        type: "UNPARSEABLE_DATES",
        details: `No usable dates found: ${parsedDates.errors.join(" | ") || rawDates}`
      });
      return;
    }

    const children = lByParent[parentID] || [];
    children.forEach((child, index) => {
      checked++;
      const expected = expectedDates[index];
      const expectedValid = expected && !isNaN(new Date(expected).getTime());
      const parentTitle = pRow[pCol("EventName")];
      const parentSeries = pCol("Series") >= 0 ? pRow[pCol("Series")] : "";
      const parentFields = {
        EventName: parentTitle,
        Series: parentSeries,
        Date: expected,
        Venue: venue
      };
      const lineupTitleField = lCol("EventName") >= 0
        ? "EventName"
        : lCol("Title") >= 0 ? "Title" : "";
      const compareFields = ["EventName", "Series", "Date", "Venue"]
        .filter(field => (field === "Date" ? expectedValid : pCol(field) >= 0) &&
          (field === "EventName" ? Boolean(lineupTitleField) : lCol(field) >= 0));
      const comparison = Engine.IO.compare(ctx, {
        source: parentFields,
        destination: child.row,
        sourceMap: pMap,
        destMap: lMap,
        fieldAliases: lineupTitleField ? { EventName: lineupTitleField } : {},
        sourceRole: pRole,
        destinationRole: lRole,
        // Compare the performance's calendar day, not hidden fractional time.
        comparisonModes: { Date: "date" },
        fields: compareFields,
        identifier: child.row[lCol("UUID")] || parentID
      });

      if (!comparison.equal) {
        flagged++;
        const currentStatus = child.row[lCol("SyncStatus")];
        const changedFields = (comparison.changed || []).map(entry => entry.field);
        const details = `Lineup row differs from Parent Lineup in: ${changedFields.join(", ") || "mapped fields"}.`;
        if (Engine.Status.blocksWrite(ctx, currentStatus)) {
          Engine.Log.write(ctx, {
            stage: "VERIFY_PARENT",
            sheetName: lSheet.getName(),
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
        Engine.Status.paint(ctx, lRole, child.rowIdx, "Manual Review");
        Engine.Log.write(ctx, {
          stage: "VERIFY_PARENT",
          sheetName: lSheet.getName(),
          rowIdx: child.rowIdx,
          id: child.row[lCol("UUID")],
          type: "DRIFT_DETECTED",
          details: details
        });

        // Queue structured decision in decision_log
        const uuid = child.row[lCol("UUID")] || "NO_UUID";
        const evidenceStr = comparison.changed
          ? comparison.changed.map(e => `${e.field}: Parent="${e.source}" | Lineup="${e.destination}"`).join(" | ")
          : details;
        if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
          const reviewId = typeof Engine.Decisions.stableReviewID === "function"
            ? Engine.Decisions.stableReviewID("PARENT_LINEUP_DRIFT", parentID, uuid, evidenceStr)
            : `PARENT_LINEUP_${parentID}_${uuid}`;
          Engine.Decisions.addPending(ctx, {
            ReviewID: reviewId,
            ReviewType: "PARENT_LINEUP_DRIFT",
            SourceSheet: pSheet.getName(),
            SourceRow: pData.indexOf(pRow) + 2,
            SourceID: parentID,
            CandidateSheet: lSheet.getName(),
            CandidateRow: child.rowIdx,
            CandidateID: uuid,
            ParentTitle: parentTitle || "",
            CandidateTitle: child.row[lCol("EventName")] || child.row[lCol("Title")] || "",
            ExistingParentID: parentID,
            MatchedFields: "parentID",
            ChangedFields: changedFields.join(", "),
            Evidence: evidenceStr,
            Confidence: "HIGH",
            SuggestedAction: "SYNC_PARENT_TO_LINEUP",
            SuggestionReason: "Parent ID anchors the related records; title, series, date, and venue differences are evidence for review. No change is applied by verification.",
            Decision: "PENDING",
            ActionStatus: "PENDING"
          });
        }
      } else {
        // Clean match: Lineup matches Parent Lineup
        const currentStatus = String(child.row[lCol("SyncStatus")] || "").trim();
        const uuid = child.row[lCol("UUID")];
        if (currentStatus === "Manual Review" && !Engine.Status.blocksWrite(ctx, currentStatus)) {
          const statusCol = lCol("SyncStatus");
          if (statusCol >= 0) lSheet.getRange(child.rowIdx, statusCol + 1).setValue("Synced");
          Engine.Status.paint(ctx, lRole, child.rowIdx, "Synced");
        }

        // Supersede stale drift reviews for this performance even when its status is no longer Manual Review.
        if (uuid && Engine.Decisions && typeof Engine.Decisions.reviewable === "function") {
          Engine.Decisions.reviewable(ctx)
            .filter(d => d.CandidateID === uuid && d.ReviewType === "PARENT_LINEUP_DRIFT")
            .forEach(d => {
              Engine.Decisions.markSuperseded(ctx, d.ReviewID, "Drift resolved: Lineup performance cleanly matches Parent.");
            });
        }
      }
    });

    // Check if Parent expected more performances than exist in Lineup
    if (expectedDates.length > children.length) {
      flagged++;
      Engine.Log.warn(ctx, "VERIFY_PARENT", `Parent ${parentID} expects ${expectedDates.length} performances, but Lineup only has ${children.length}.`);
      if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
        const reviewId = typeof Engine.Decisions.stableReviewID === "function"
          ? Engine.Decisions.stableReviewID("LINEUP_MISSING", parentID, `count-${expectedDates.length}-${children.length}`)
          : `LINEUP_MISSING_${parentID}`;
        Engine.Decisions.addPending(ctx, {
          ReviewID: reviewId,
          ReviewType: "LINEUP_MISSING_PERFORMANCE",
          SourceSheet: pSheet.getName(),
          SourceRow: pData.indexOf(pRow) + 2,
          SourceID: parentID,
          ParentTitle: pRow[pCol("EventName")] || "",
          ExistingParentID: parentID,
          Evidence: `Expected ${expectedDates.length} performances (${expectedDates.join(", ")}), found ${children.length} in Lineup.`,
          Confidence: "HIGH",
          SuggestedAction: "EXPLODE_LINEUP",
          SuggestionReason: "Parent DatesAndTimes has additional performances not yet exploded to Lineup.",
          Decision: "PENDING",
          ActionStatus: "PENDING"
        });
      }
    }
  });

  // Check for orphan Lineup rows (parentID not in Parent Lineup)
  const validParentIDs = new Set(pData.map(r => String(r[pCol("parentID")] || "").trim()).filter(Boolean));
  let orphans = 0;
  lData.forEach((row, idx) => {
    const childPid = String(row[lCol("parentID")] || "").trim();
    if (!childPid || validParentIDs.has(childPid)) return;

    // Check if childPid was merged in idLog
    const regEntry = ctx.registry && ctx.registry[childPid];
    const isMerged = regEntry && (regEntry.MergedIDs || regEntry.Location);
    // Search survivor in registry
    let survivorId = null;
    if (ctx.registry) {
      Object.keys(ctx.registry).forEach(regId => {
        const mergedList = String(ctx.registry[regId].MergedIDs || "").split(",").map(s => s.trim());
        if (mergedList.includes(childPid)) survivorId = regId;
      });
    }

    if (survivorId && validParentIDs.has(survivorId)) {
      // Auto-repoint orphan to survivor
      const pidCol = lCol("parentID");
      if (pidCol >= 0) lSheet.getRange(idx + 2, pidCol + 1).setValue(survivorId);
      Engine.Log.write(ctx, {
        stage: "VERIFY_PARENT",
        sheetName: lSheet.getName(),
        rowIdx: idx + 2,
        id: row[lCol("UUID")],
        type: "PARENT_REPOINTED",
        details: `Auto-repointed orphaned Lineup row from merged ParentID ${childPid} to survivor ${survivorId}.`
      });
    } else {
      orphans++;
      if (Engine.Decisions && typeof Engine.Decisions.addPending === "function") {
        const uuid = row[lCol("UUID")] || `R${idx + 2}`;
        const reviewId = typeof Engine.Decisions.stableReviewID === "function"
          ? Engine.Decisions.stableReviewID("LINEUP_ORPHAN", childPid, uuid)
          : `LINEUP_ORPHAN_${childPid}_${uuid}`;
        Engine.Decisions.addPending(ctx, {
          ReviewID: reviewId,
          ReviewType: "LINEUP_ORPHAN",
          CandidateSheet: lSheet.getName(),
          CandidateRow: idx + 2,
          CandidateID: uuid,
          CandidateTitle: row[lCol("EventName")] || row[lCol("Title")] || "",
          ExistingParentID: childPid,
          Evidence: `ParentID ${childPid} does not exist in Parent Lineup.`,
          Confidence: "HIGH",
          SuggestedAction: "REVIEW_LINEUP_ORPHAN",
          SuggestionReason: "Lineup row references a non-existent parentID.",
          Decision: "PENDING",
          ActionStatus: "PENDING"
        });
      }
    }
  });

  Engine.Log.write(ctx, {
    stage: "VERIFY_PARENT",
    type: "VERIFY_PARENT_COMPLETE",
    details: `Checked ${checked} Lineup rows against Parent Lineup. ${flagged} drifted, ${unparseable} Parent Lineup row(s) had unparseable date ranges, ${orphans} orphan(s) detected.`
  });

  return { checked: checked, flagged: flagged, unparseable: unparseable, orphans: orphans };
};

// ============================================================
// engine_ingest.js — new: Engine.Ingest.acceptImportDrift()
// The explicit, deliberate merge step for RENAME_CANDIDATE (and any
// DRIFT_DETECTED) rows goParent() correctly refused to auto-apply.
// ============================================================
Engine.Ingest.acceptImportDrift = function(ctx, parentID, options) {
  options = options || {};
  const iRole = Engine.Roles.resolve(ctx, "IMPORT");
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const iSheet = iRole && Engine.getSheetByRole(ctx, iRole);
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const iMap = ctx.getMap(iRole);
  const pMap = ctx.getMap(pRole);
  if (!iSheet || !pSheet || !iMap || !pMap) {
    Engine.Log.error(ctx, "INGEST", "Import or Parent Lineup sheet/map not found for the active mode's target season.");
    return false;
  }
  const iSheetName = iSheet.getName();
  const pSheetName = pSheet.getName();
  const iCol = fieldName => Engine.getColumnIndex(iMap, fieldName);
  const pCol = fieldName => Engine.getColumnIndex(pMap, fieldName);
  // Shared normalize (scriptLib SL.Utils), same tier as the other ingest lookups.
  const utils = Engine.getLibraryModule("Utils");
  const normalize = value => utils.normalize(value, { collapse: true, fold: true });

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
  let importRowIdx = -1;
  // Prefer the exact import row recorded on the review; a renamed event cannot be found by name.
  const hintedRow = Number(options.importRow);
  if (Number.isInteger(hintedRow) && hintedRow >= 2 && hintedRow - 2 < iData.length) {
    importRowIdx = hintedRow - 2;
  }
  if (importRowIdx === -1) {
    importRowIdx = iData.findIndex(row => normalize(row[iCol("EventName")]) === pName);
  }

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

  const sourceFields = Engine.Ingest.getParentSourceFields(ctx, iMap, pMap);
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
        SourceSheet: iSheetName,
        SourceRow: importSheetRow,
        SourceID: importRow[iCol("EventName")] || "",
        ImportTitle: importRow[iCol("EventName")] || "",
        CandidateSheet: pSheetName,
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
      sheetName: pSheetName,
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
  Engine.Status.paint(ctx, pRole, sheetRowNum, "Active");

  // Per-field log entries for AUTO_UPDATE_AND_LOG
  if (importUpdatePolicy === "AUTO_UPDATE_AND_LOG") {
    changes.forEach(c => {
      Engine.Log.write(ctx, {
        stage: "INGEST",
        sheetName: pSheetName,
        rowIdx: sheetRowNum,
        id: parentID,
        type: "DRIFT_FIELD_UPDATE",
        details: `${c.fieldName}: "${c.oldVal}" -> "${c.newVal}"`
      });
    });
  }

  Engine.Log.write(ctx, {
    stage: "INGEST",
    sheetName: pSheetName,
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
  const pRole = Engine.Roles.resolve(ctx, "PARENT");
  const pSheet = pRole && Engine.getSheetByRole(ctx, pRole);
  const pMap = ctx.getMap(pRole);
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
 