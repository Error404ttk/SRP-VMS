function doGet(e) {
  var page = e && e.parameter && e.parameter.page ? e.parameter.page : 'login';
  var publicPages = ['login'];
  var template;

  if (page === 'provider-callback' || (e && e.parameter && e.parameter.code)) {
    return renderProviderCallback(e && e.parameter ? e.parameter : {});
  }

  if (publicPages.indexOf(page) !== -1 || !PAGE_MAP[page]) {
    template = HtmlService.createTemplateFromFile('Login');
  } else {
    template = HtmlService.createTemplateFromFile('Layout');
    template.contentPage = PAGE_MAP[page];
    template.currentPage = page;
  }

  template.page = page;
  template.appConfig = getAppConfig();

  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_SHORT_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderProviderCallback(parameters) {
  var code = String((parameters || {}).code || '').trim();
  var state = String((parameters || {}).state || '').trim();

  if (!code) {
    var loginTemplate = HtmlService.createTemplateFromFile('Login');
    loginTemplate.page = 'login';
    loginTemplate.appConfig = getAppConfig();
    loginTemplate.loginError = 'ไม่พบ code จาก Health ID';

    return loginTemplate
      .evaluate()
      .setTitle(APP_CONFIG.APP_SHORT_NAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Phase 1: Render loading page IMMEDIATELY. 
  // We completely skip getAppConfig() here to avoid ANY spreadsheet reads,
  // which ensures a lightning-fast response (<100ms) to the MOPH ID redirect.
  var callbackTemplate = HtmlService.createTemplateFromFile('ProviderCallback');
  callbackTemplate.page = 'provider-callback';
  callbackTemplate.callbackCode = code;
  callbackTemplate.callbackState = state;
  
  // Provide bare minimum config for the loading screen
  var webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch(e) {}
  
  callbackTemplate.appConfig = {
    appShortName: APP_CONFIG.APP_SHORT_NAME,
    webAppUrl: webAppUrl
  };

  return callbackTemplate
    .evaluate()
    .setTitle(APP_CONFIG.APP_SHORT_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Async callback handler — called from ProviderCallback.html via google.script.run.
 * This separates the slow OAuth API calls from the initial page render.
 */
function handleProviderCallbackAsync(code, state) {
  return handleProviderCallback({ code: code, state: state });
}

function doPost(e) {
  var username = e && e.parameter && e.parameter.username ? e.parameter.username : '';
  var password = e && e.parameter && e.parameter.password ? e.parameter.password : '';
  var response = login(username, password);

  if (!response.success) {
    var loginTemplate = HtmlService.createTemplateFromFile('Login');
    loginTemplate.page = 'login';
    loginTemplate.appConfig = getAppConfig();
    loginTemplate.loginError = response.message;

    return loginTemplate
      .evaluate()
      .setTitle(APP_CONFIG.APP_SHORT_NAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var user = response.data.user;
  var page = response.data.targetPage || (user.role === 'admin' ? 'dashboard' : 'usage-form');

  var template = HtmlService.createTemplateFromFile('Layout');
  template.page = page;
  template.contentPage = PAGE_MAP[page] || 'UsageForm';
  template.currentPage = PAGE_MAP[page] ? page : 'usage-form';
  template.appConfig = getAppConfig();
  template.initialAuth = response.data;

  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_SHORT_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSheetByName(name) {
  return getSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(sheetName) {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  return sheet;
}

function getSpreadsheet() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      PropertiesService.getScriptProperties().deleteProperty('SPREADSHEET_ID');
    }
  }

  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (activeSpreadsheet) {
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', activeSpreadsheet.getId());
    return activeSpreadsheet;
  }

  // ใช้เฉพาะกรณี Web App เป็น standalone และยังไม่ได้ตั้งค่า Spreadsheet ID
  var spreadsheet = SpreadsheetApp.create(APP_CONFIG.APP_SHORT_NAME + ' Database');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

function setSpreadsheetId(spreadsheetId) {
  spreadsheetId = String(spreadsheetId || '').trim();

  if (!spreadsheetId) {
    return errorResponse('กรุณาระบุ Spreadsheet ID', null);
  }

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  return successResponse('ตั้งค่า Spreadsheet ID เรียบร้อยแล้ว', {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName()
  });
}

function ensureDatabaseReady() {
  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    var sheet = getOrCreateSheet(sheetName);
    setHeadersIfEmpty(sheet, SHEET_HEADERS[sheetName]);
    syncMissingHeaders(sheet, SHEET_HEADERS[sheetName]);
  });

  if (getRowsAsObjects(SHEET_NAMES.USERS).length === 0) {
    seedUsers();
  }

  if (getRowsAsObjects(SHEET_NAMES.VEHICLES).length === 0) {
    seedVehicles();
  }

  if (getRowsAsObjects(SHEET_NAMES.DRIVERS).length === 0) {
    seedDrivers();
  }

  if (getRowsAsObjects(SHEET_NAMES.DEPARTMENTS).length === 0) {
    seedDepartments();
  }

  if (getRowsAsObjects(SHEET_NAMES.MISSION_TYPES).length === 0) {
    seedMissionTypes();
  }

  if (getRowsAsObjects(SHEET_NAMES.DESTINATIONS).length === 0) {
    seedDestinations();
  }

  if (getRowsAsObjects(SHEET_NAMES.SETTINGS).length === 0) {
    seedSettings();
  }
}

function setHeadersIfEmpty(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function syncMissingHeaders(sheet, headers) {
  if (!sheet || sheet.getLastRow() === 0) {
    return;
  }

  var currentHeaders = getSheetHeaders(sheet);
  var missingHeaders = headers.filter(function (header) {
    return currentHeaders.indexOf(header) === -1;
  });

  if (missingHeaders.length === 0) {
    return;
  }

  sheet.getRange(1, currentHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
}

function getRowsAsObjects(sheetName) {
  var sheet = getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(function (header) {
    return String(header || '').trim();
  });

  return values
    .filter(function (row) {
      return row.some(function (cell) {
        return cell !== '';
      });
    })
    .map(function (row) {
      var object = {};
      headers.forEach(function (header, index) {
        object[header] = normalizeCellValue(row[index]);
      });
      return object;
    });
}

function readSheetRowsBySchema(sheetName, schemaHeaders, normalizer) {
  var sheet = getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var columnCount = Math.max(sheet.getLastColumn(), schemaHeaders.length);
  var headerValues = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0].map(function (header) {
    return String(header || '').trim();
  });
  var headerIndexMap = {};

  headerValues.forEach(function (header, index) {
    if (header && headerIndexMap[header] === undefined) {
      headerIndexMap[header] = index;
    }
  });

  var dataValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getDisplayValues();

  return dataValues
    .filter(function (row) {
      return row.some(function (cell) {
        return String(cell || '').trim() !== '';
      });
    })
    .map(function (row) {
      var object = {};

      schemaHeaders.forEach(function (header, schemaIndex) {
        var actualIndex = headerIndexMap[header] !== undefined ? headerIndexMap[header] : -1;
        var valueIndex = actualIndex > -1 ? actualIndex : schemaIndex;
        object[header] = row[valueIndex] !== undefined ? row[valueIndex] : '';
      });

      return normalizer ? normalizer(object) : object;
    });
}

function appendRowObject(sheetName, object) {
  var sheet = getSheetByName(sheetName);
  var headers = getSheetHeaders(sheet);
  var row = headers.map(function (header) {
    return object[header] !== undefined ? object[header] : '';
  });

  sheet.appendRow(row);
  return object;
}

function updateObjectById(sheetName, idColumn, idValue, newData) {
  var sheet = getSheetByName(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header || '').trim();
  });
  var idIndex = headers.indexOf(idColumn);

  if (idIndex === -1) {
    return null;
  }

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(idValue)) {
      var rowValues = values[i].slice();
      headers.forEach(function (header, index) {
        if (newData[header] !== undefined) {
          rowValues[index] = newData[header];
        }
      });
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([rowValues]);

      // Build updated object from rowValues directly instead of re-reading the entire sheet.
      var updatedObject = {};
      headers.forEach(function (header, index) {
        updatedObject[header] = normalizeCellValue(rowValues[index]);
      });
      invalidateSheetCache(sheetName);
      return updatedObject;
    }
  }

  return null;
}

function findObjectById(sheetName, idColumn, idValue) {
  var rows = getCachedSheetRows(sheetName);

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn]) === String(idValue)) {
      return rows[i];
    }
  }

  return null;
}

/**
 * Execution-scoped in-memory cache for sheet reads.
 * Prevents redundant Sheet API calls within the same script execution.
 * Each execution starts fresh; cache is NOT shared across executions.
 */
var _sheetCache = {};

function getCachedSheetRows(sheetName) {
  if (!_sheetCache[sheetName]) {
    _sheetCache[sheetName] = getRowsAsObjects(sheetName);
  }
  return _sheetCache[sheetName];
}

function invalidateSheetCache(sheetName) {
  if (sheetName) {
    delete _sheetCache[sheetName];
  } else {
    _sheetCache = {};
  }
}

function generateUuid() {
  return Utilities.getUuid();
}

function nowString() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
}

function formatDate(date) {
  if (!date) {
    return '';
  }

  return Utilities.formatDate(new Date(date), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy');
}

function formatDateTime(date) {
  if (!date) {
    return '';
  }

  return Utilities.formatDate(new Date(date), APP_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
}

function normalizeIsoDateValue(value) {
  var text = String(value || '').trim();
  var isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  var thaiMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (isoMatch) {
    return isoMatch[1] + '-' + padDatePart(isoMatch[2]) + '-' + padDatePart(isoMatch[3]);
  }

  if (thaiMatch) {
    var year = Number(thaiMatch[3]);
    if (year > 2400) {
      year -= 543;
    }
    return year + '-' + padDatePart(thaiMatch[2]) + '-' + padDatePart(thaiMatch[1]);
  }

  return text;
}

function formatThaiBuddhistDate(value) {
  var isoDate = normalizeIsoDateValue(value);
  var match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return String(value || '');
  }

  return match[3] + '/' + match[2] + '/' + (Number(match[1]) + 543);
}

function normalizeTimeValue(value) {
  var text = String(value || '').trim();
  var match = text.match(/(\d{1,2}):(\d{2})/);

  if (!match) {
    return text;
  }

  return padDatePart(match[1]) + ':' + match[2];
}

function padDatePart(value) {
  value = String(value || '');
  return value.length === 1 ? '0' + value : value;
}

function enforceMaxLength(value, maxLength, label) {
  var text = String(value || '').trim();

  if (text.length > maxLength) {
    throw new Error(label + 'ต้องไม่เกิน ' + maxLength + ' ตัวอักษร');
  }

  return text;
}

function parseNumber(value) {
  var numberValue = Number(value);
  return isNaN(numberValue) ? 0 : numberValue;
}

function normalizePagination(filters, defaultLimit, maxLimit) {
  var rawLimit = Number((filters || {}).limit);
  var rawOffset = Number((filters || {}).offset);
  var limit = isNaN(rawLimit) || rawLimit < 1 ? defaultLimit : rawLimit;
  var offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  return {
    limit: Math.min(limit, maxLimit),
    offset: Math.floor(offset)
  };
}

function getCachedJson(cacheKey) {
  var cached = CacheService.getScriptCache().get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

function putCachedJson(cacheKey, value, seconds) {
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(value), seconds);
  return value;
}

function clearLookupCache() {
  CacheService.getScriptCache().removeAll([
    'SPH_ACTIVE_VEHICLES',
    'SPH_ACTIVE_DRIVERS',
    'SPH_ACTIVE_DEPARTMENTS',
    'SPH_ACTIVE_MISSION_TYPES',
    'SPH_ACTIVE_DESTINATIONS'
  ]);
}

function clearVehicleCache() {
  CacheService.getScriptCache().remove('SPH_ACTIVE_VEHICLES');
}

function clearDriverCache() {
  CacheService.getScriptCache().remove('SPH_ACTIVE_DRIVERS');
}

function clearDepartmentCache() {
  CacheService.getScriptCache().remove('SPH_ACTIVE_DEPARTMENTS');
}

function clearMissionTypeCache() {
  CacheService.getScriptCache().remove('SPH_ACTIVE_MISSION_TYPES');
}

function clearDestinationCache() {
  CacheService.getScriptCache().remove('SPH_ACTIVE_DESTINATIONS');
}

function normalizeCellValue(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDateTime(value);
  }

  return value;
}

function getSheetHeaders(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) {
    return [];
  }

  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (header) {
    return String(header || '').trim();
  });
}

function getSystemDebugInfo(token) {
  try {
    requireAdmin(token);

    var spreadsheet = getSpreadsheet();
    var sheetNames = Object.keys(SHEET_HEADERS);
    var sheets = sheetNames.map(function (sheetName) {
      var sheet = spreadsheet.getSheetByName(sheetName);
      return {
        sheetName: sheetName,
        exists: !!sheet,
        lastRow: sheet ? sheet.getLastRow() : 0,
        lastColumn: sheet ? sheet.getLastColumn() : 0,
        headers: sheet ? getSheetHeaders(sheet) : []
      };
    });

    return successResponse('ตรวจสอบระบบเรียบร้อยแล้ว', {
      spreadsheetId: spreadsheet.getId(),
      spreadsheetName: spreadsheet.getName(),
      sheets: sheets
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function successResponse(message, data) {
  return {
    success: true,
    message: message || 'ดำเนินการสำเร็จ',
    data: data === undefined ? {} : data
  };
}

function errorResponse(message, data) {
  return {
    success: false,
    message: message || 'เกิดข้อผิดพลาด',
    data: data === undefined ? null : data
  };
}
