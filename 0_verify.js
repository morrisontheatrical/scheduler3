

/**
 * Scans a Source against a Destination and logs/highlights differences.
 */
function verifyImport(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceName);
  const sourceData = sourceSheet.getDataRange().getValues();
  
  const destSheet = ss.getSheetByName(destName);
  const destData = destSheet.getDataRange().getValues();
  
  // Clear previous highlights from the source sheet before starting
  sourceSheet.getDataRange().setBackground(null);

  // Build Lookup for Destination
  const destLookup = {};
  for (let i = 1; i < destData.length; i++) {
    const id = destData[i][destMap[destIdKey]];
    if (id) destLookup[id] = destData[i];
  }

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

    // Check 2: Fingerprint Mismatch (Data drift)
    // We compare Title, Date, and Location
    const sFingerprint = `${sRow[sourceMap.Title]}|${sRow[sourceMap.DatesAndTimes]}|${sRow[sourceMap.Location]}`;
    const dFingerprint = `${dRow[destMap.Title]}|${dRow[destMap.DatesAndTimes]}|${dRow[destMap.Location]}`;

    if (sFingerprint !== dFingerprint) {
      logDiscrepancy(stageName, sourceName, rowIdx, sID, "MISMATCH", `Data drift between sheets.`);
      errorCount++;
    }
  }
  
  return errorCount;
}

function verifyTDL(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceName);
  const sourceData = sourceSheet.getDataRange().getValues();
  
  const destSheet = ss.getSheetByName(destName);
  const destData = destSheet.getDataRange().getValues();
  
  // Clear previous highlights from the source sheet before starting
  sourceSheet.getDataRange().setBackground(null);

  // Build Lookup for Destination
  const destLookup = {};
  for (let i = 1; i < destData.length; i++) {
    const id = destData[i][destMap[destIdKey]];
    if (id) destLookup[id] = destData[i];
  }

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

    // Check 2: Fingerprint Mismatch (Data drift)
    // We compare Title, Date, and Location
    const sFingerprint = `${sRow[sourceMap.Title]}|${sRow[sourceMap.Date]}|${sRow[sourceMap.Location]}`;
    const dFingerprint = `${dRow[destMap.Title]}|${dRow[destMap.Date]}|${dRow[destMap.Location]}`;

    if (sFingerprint !== dFingerprint) {
      logDiscrepancy(stageName, sourceName, rowIdx, sID, "MISMATCH", `Data drift between sheets.`);
      errorCount++;
    }
  }
  
  return errorCount;
}
function verifyEvent(stageName, sourceName, destName, sourceMap, destMap, sourceIdKey, destIdKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceName);
  const sourceData = sourceSheet.getDataRange().getValues();
  
  const destSheet = ss.getSheetByName(destName);
  const destData = destSheet.getDataRange().getValues();
  
  // Clear previous highlights from the source sheet before starting
  sourceSheet.getDataRange().setBackground(null);

  // Build Lookup for Destination
  const destLookup = {};
  for (let i = 1; i < destData.length; i++) {
    const id = destData[i][destMap[destIdKey]];
    if (id) destLookup[id] = destData[i];
  }

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

    // Check 2: Fingerprint Mismatch (Data drift)
    // We compare Title, Date, and Location
    const sFingerprint = `${sRow[sourceMap.Title]}|${sRow[sourceMap.Date]}|${sRow[sourceMap.Location]}`;
    const dFingerprint = `${dRow[destMap.Title]}|${dRow[destMap.Date]}|${dRow[destMap.Location]}`;

    if (sFingerprint !== dFingerprint) {
      logDiscrepancy(stageName, sourceName, rowIdx, sID, "MISMATCH", `Data drift between sheets.`);
      errorCount++;
    }
  }
  
  return errorCount;
}
