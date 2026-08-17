/**
 * Scans a Source sheet against a Destination sheet and logs discrepancies.
 * Automatically resolves 'Date' vs 'DatesAndTimes' column mappings.
 *
 * @param {string} stageName - Workflow stage for logging.
 * @param {string} sourceName - Source sheet name.
 * @param {string} destName - Destination sheet name.
 * @param {Object} sourceMap - Mapping object for source sheet columns.
 * @param {Object} destMap - Mapping object for destination sheet columns.
 * @param {string} sourceIdKey - Map key for source ID.
 * @param {string} destIdKey - Map key for destination ID.
 * @param {string} [dateKey] - Optional map key for date column override.
 * @return {number} Count of discrepancies found.
 */
function verifySheetSync(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey, dateKey) {
  //UPDATE_NOTES 8/17/26
  //This is a combined function of verifyImport / verifyTDL / verifyEvent from 0_verify.gs
  //Not called


  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceName);
  const destSheet = ss.getSheetByName(destName);
  
  if (!sourceSheet || !destSheet) {
    console.warn(`[VERIFY] Missing required sheet: ${sourceName} or ${destName}`);
    return 0;
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  const destData = destSheet.getDataRange().getValues();
  
  // Clear previous highlights from the source sheet
  sourceSheet.getDataRange().setBackground(null);

  // Build Lookup for Destination
  const destLookup = {};
  for (let i = 1; i < destData.length; i++) {
    const id = destData[i][destMap[destIdKey]];
    if (id) destLookup[id] = destData[i];
  }

  // Resolve dynamic date column indices across mapping variations
  const sDateCol = sourceMap[dateKey] ?? sourceMap.Date ?? sourceMap.DatesAndTimes;
  const dDateCol = destMap[dateKey] ?? destMap.Date ?? destMap.DatesAndTimes;

  let errorCount = 0;

  for (let i = 1; i < sourceData.length; i++) {
    const sRow = sourceData[i];
    const sID = sRow[sourceMap[sourceIdKey]];
    const rowIdx = i + 1;
    
    if (!sID) continue;

    const dRow = destLookup[sID];

    // Check 1: Missing from Destination
    if (!dRow) {
      logDiscrepancy(stageName, sourceName, rowIdx, sID, "MISSING", `ID not found in ${destName}`);
      errorCount++;
      continue;
    }

    // Check 2: Fingerprint Mismatch (Data drift check on Title, Date, Location)
    const sFingerprint = `${sRow[sourceMap.Title]}|${sRow[sDateCol]}|${sRow[sourceMap.Location]}`;
    const dFingerprint = `${dRow[destMap.Title]}|${dRow[dDateCol]}|${dRow[destMap.Location]}`;

    if (sFingerprint !== dFingerprint) {
      logDiscrepancy(stageName, sourceName, rowIdx, sID, "MISMATCH", `Data drift between sheets.`);
      errorCount++;
    }
  }
  
  return errorCount;
}

// --- OPTIONAL ALIASES FOR BACKWARDS COMPATIBILITY ---
function verifyImport(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  return verifySheetSync(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey, "DatesAndTimes");
}

function verifyTDL(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  return verifySheetSync(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey, "Date");
}

function verifyEvent(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  return verifySheetSync(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey, "Date");
}