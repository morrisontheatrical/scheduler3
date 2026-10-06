var Engine = Engine || {};
Engine.IO = Engine.IO || {};

/**
 * Serializes a row object into a JSON string for snapshotting/auditing.
 */
Engine.IO.serializeRow = function(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("serializeRow expects a row object.");
  }

  const encode = value => {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) throw new TypeError("Cannot serialize an invalid Date.");
      return { __scheduler3Type: "Date", value: value.toISOString() };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") {
      const result = {};
      Object.keys(value).forEach(key => { result[key] = encode(value[key]); });
      return result;
    }
    return value;
  };

  const serializable = {};
  Object.keys(obj).forEach(key => {
    if (key !== "_rowNum") serializable[key] = obj[key];
  });
  return JSON.stringify(encode(serializable));
};

/**
 * Deserializes a JSON string back into a row object.
 */
Engine.IO.deserializeRow = function(jsonString, rowNum) {
  if (typeof jsonString !== "string" || !jsonString.trim()) {
    throw new TypeError("deserializeRow expects a non-empty JSON string.");
  }
  if (rowNum !== undefined && (!Number.isInteger(rowNum) || rowNum < 1)) {
    throw new RangeError("deserializeRow rowNum must be a positive integer.");
  }

  const decode = value => {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      if (value.__scheduler3Type === "Date" && typeof value.value === "string") {
        const date = new Date(value.value);
        if (isNaN(date.getTime())) throw new TypeError(`Invalid serialized Date: ${value.value}`);
        return date;
      }
      const result = {};
      Object.keys(value).forEach(key => { result[key] = decode(value[key]); });
      return result;
    }
    return value;
  };

  const obj = decode(JSON.parse(jsonString));
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("deserializeRow JSON must describe a row object.");
  }
  return rowNum !== undefined ? { ...obj, _rowNum: rowNum } : obj;
};

Engine.IO.sortLogByDate = function(ctx, role) {
  const sheet = Engine.getSheetByRole(ctx, role);
  const map = ctx.getMap(role);
  if (!sheet || !map) throw new Error(`Cannot sort calendar log: sheet or map missing for role "${role}".`);
  const dateCol = Engine.getColumnIndex(map, "Date");
  const startCol = Engine.getColumnIndex(map, "Start");
  if (dateCol < 0) throw new Error(`Cannot sort calendar log role "${role}": Date field is not mapped.`);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol < 1) return 0;

  const sortSpecs = [{ column: dateCol + 1, ascending: true }];
  if (startCol >= 0 && startCol !== dateCol) {
    sortSpecs.push({ column: startCol + 1, ascending: true });
  }
  sheet.getRange(2, 1, lastRow - 1, lastCol).sort(sortSpecs);
  Engine.Log.info(ctx, "SORT", `Sorted ${role} by Date${startCol >= 0 && startCol !== dateCol ? " and Start" : ""}.`);
  return lastRow - 1;
};

/**
 * Generic row-to-row field comparison — the single shared drift-detection
 * primitive (see ARCHITECTURE.md). Works on scanSheet-style row objects
 * ({field: value}) or raw array rows (pass the maps), so ingest, sync, and
 * the verify flows all share one comparison instead of each re-implementing it.
 *
 * String normalization is the universal scriptLib tier. Date comparison is
 * workbook-owned because it needs ctx.timeZone and Map_Registry data types.
 *
 * @param {Object} ctx
 * @param {Object} params
 *   - source / destination: row objects, or array rows + sourceMap / destMap
 *   - fields:           field names to compare, in source-field terms
 *   - fieldAliases:     { sourceField: destinationField } for sheets that name
 *                       the same concept differently (e.g. EventName→Title)
 *   - sourceRole / destinationRole: roles or sheet names used to obtain
 *                       Map_Registry data types for array or object rows
 *   - comparisonModes:  optional { field: "date"|"time"|"timestamp" }
 *                       overrides for values whose operational meaning differs
 *                       from their stored Map_Registry type
 *   - identifier:       parentID/UUID/row label, carried through to evidence
 * @return {{equal: boolean, changed: Array, unchanged: Array, identifier: string}}
 *   `changed[]` entries are the before/after evidence (ROADMAP #8).
 */
Engine.IO.compare = function(ctx, params) {
  params = params || {};
  const fields = params.fields || [];
  const aliases = params.fieldAliases || {};
  const utils = Engine.getLibraryModule("Utils");
  if (!utils || typeof utils.normalize !== "function") {
    throw new Error("Engine.IO.compare requires scriptLib SL.Utils.normalize");
  }

  const fieldDataType = function(roleOrSheet, fieldName) {
    if (!ctx || !ctx.getColumnDef || !roleOrSheet) return "";
    const definition = ctx.getColumnDef(roleOrSheet, fieldName);
    return definition && definition.dataType ? String(definition.dataType).trim().toUpperCase() : "";
  };

  const comparisonMode = function(sourceField, destinationField) {
    const override = params.comparisonModes && params.comparisonModes[sourceField];
    if (override) return String(override).trim().toLowerCase();

    const dataType = params.fieldTypes && params.fieldTypes[sourceField]
      ? String(params.fieldTypes[sourceField]).trim().toUpperCase()
      : fieldDataType(params.sourceRole, sourceField) || fieldDataType(params.destinationRole, destinationField);
    if (dataType === "DATE") return "date";
    if (dataType === "TIME") return "time";
    if (dataType === "DATETIME" || dataType === "TIMESTAMP") return "timestamp";
    return "timestamp";
  };

  // Value → comparison string. A field without type metadata retains the
  // complete instant so the generic fallback never loses a year or time.
  const comparisonForm = function(value, mode) {
    if (!(value instanceof Date) || isNaN(value.getTime())) {
      return utils.normalize(value, { collapse: true, fold: true });
    }
    if (mode === "date") return Utilities.formatDate(value, ctx.timeZone, "yyyy-MM-dd");
    if (mode === "time") return Utilities.formatDate(value, ctx.timeZone, "HH:mm:ss.SSS");
    return Utilities.formatDate(value, ctx.timeZone, "yyyy-MM-dd'T'HH:mm:ss.SSS");
  };

  const getFromRow = function(row, map, fieldName) {
    if (Array.isArray(row)) {
      if (!map) return "";
      const idx = Engine.getColumnIndex(map, fieldName);
      return idx >= 0 ? row[idx] : "";
    }
    return row ? (row[fieldName] !== undefined ? row[fieldName] : "") : "";
  };

  const changed = [];
  const unchanged = [];
  fields.forEach(field => {
    const destField = aliases[field] || field;
    const source = getFromRow(params.source, params.sourceMap, field);
    const destination = getFromRow(params.destination, params.destMap, destField);
    const mode = comparisonMode(field, destField);
    const normalizedSource = comparisonForm(source, mode);
    const normalizedDestination = comparisonForm(destination, mode);
    if (normalizedSource === normalizedDestination) {
      unchanged.push(field);
    } else {
      changed.push({
        field: field,
        source: source,
        destination: destination,
        normalizedSource: normalizedSource,
        normalizedDestination: normalizedDestination
      });
    }
  });

  return {
    equal: changed.length === 0,
    changed: changed,
    unchanged: unchanged,
    identifier: params.identifier || ""
  };
};

/**
 * Converts a sheet into an array of objects based on the Map_Registry
 */
function scanSheet(role, ctx) {
  const sheet = Engine.getSheetByRole(ctx, role);
  const map = ctx.getMap(role);
  if (!sheet || !map) return [];

  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove headers
  
  return data.map((row, index) => {
    const obj = { _rowNum: index + 2 }; // Keep track of the actual row for individual updates
    for (const field in map) {
      const colIndex = Engine.getColumnIndex(map, field);
      if (colIndex < 0) continue;
      obj[field] = row[colIndex];
    }
    return obj;
  });
}

/**
 * Writes a batch of objects back to the sheet and automatically updates SyncHashes.
 */
function batchWrite(role, dataObjects, ctx) {
  const sheet = Engine.getSheetByRole(ctx, role);
  const sheetName = sheet && sheet.getName();
  const map = ctx.getMap(role);
  
  if (!sheet || !map) {
    Engine.Log.error(ctx, "BATCH_WRITE", `Failed to find sheet or map for role: ${role}`);
    return;
  }

  const indices = Object.keys(map).map(field => Engine.getColumnIndex(map, field));
  const lastCol = Math.max(...indices) + 1;
  const generateIdentity = (dataObj) => {
    const identityInput = {
      title: dataObj.Title || dataObj.EventName,
      date: dataObj.Date,
      time: dataObj.Start || dataObj.CallTime,
      venue: dataObj.Location || dataObj.Venue
    };

    const identityModule = Engine.getLibraryModule("Identity");
    if (identityModule && typeof identityModule.generate === "function") {
      return identityModule.generate(identityInput);
    }
    return null;
  };

  const output = dataObjects.map(obj => {
    // 1. Generate Identity Hash when the shared library is available.
    if (map.SyncHash !== undefined) {
      const identity = generateIdentity(obj);
      if (identity && identity.hash) obj.SyncHash = identity.hash;
    }

    // 2. Map object properties to the correct column 0-based indices
    const row = new Array(lastCol).fill("");
    for (const field in map) {
      const colIdx = Engine.getColumnIndex(map, field);
      if (colIdx < 0) continue;
      // Only write if the object actually has a value for this field
      if (obj.hasOwnProperty(field)) {
        row[colIdx] = obj[field];
      }
    }
    return row;
  });

  // 3. Write to sheet (starting at row 2)
  if (output.length > 0) {
    sheet.getRange(2, 1, output.length, lastCol).setValues(output);
    Engine.Log.info(ctx, "BATCH_WRITE", `Successfully wrote ${output.length} rows to ${sheetName}`);
  }
}

function patchRows(role, updatedObjects, ctx) {
  const sheet = Engine.getSheetByRole(ctx, role);
  const map = ctx.getMap(role);
  if (!sheet || !map) return;
  
  updatedObjects.forEach(obj => {
    if (!obj._rowNum) return; // We need to know which row to hit
    
    const identityInput = {
      title: obj.Title,
      date: obj.Date,
      time: obj.Start,
      venue: obj.Location
    };
    const identityModule = Engine.getLibraryModule("Identity");
    const identity = identityModule && typeof identityModule.generate === "function"
      ? identityModule.generate(identityInput)
      : null;
    if (identity) obj.SyncHash = identity.hash;

    const indices = Object.keys(map).map(field => Engine.getColumnIndex(map, field)).filter(index => index >= 0);
    if (!indices.length) return;
    const rowArray = new Array(Math.max(...indices, 0) + 1).fill("");
    for (const field in map) {
      const colIndex = Engine.getColumnIndex(map, field);
      if (colIndex < 0) continue;
      rowArray[colIndex] = obj[field];
    }
    
    // Update only this specific row
    sheet.getRange(obj._rowNum, 1, 1, rowArray.length).setValues([rowArray]);
  });
}