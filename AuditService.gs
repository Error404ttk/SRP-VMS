function writeAuditLog(action, module, detail, user) {
  try {
    var currentUser = user || {};

    appendRowObject(SHEET_NAMES.AUDIT_LOGS, {
      audit_id: generateUuid(),
      action: action || '',
      module: module || '',
      detail: detail || '',
      username: currentUser.username || '',
      full_name: currentUser.full_name || '',
      role: currentUser.role || '',
      timestamp: nowString(),
      user_agent: ''
    });

    return successResponse('บันทึก Audit log เรียบร้อยแล้ว', {});
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getAuditLogs(filters, token) {
  try {
    requireAdmin(token);
    var allRows = readAuditRows();
    var rows = applyAuditFilters(allRows, filters || {});
    var page = normalizePagination(filters, 20, 200);

    return successResponse('โหลดประวัติระบบเรียบร้อยแล้ว', {
      rows: rows.slice(page.offset, page.offset + page.limit),
      totalRows: rows.length,
      limit: page.limit,
      offset: page.offset,
      actions: getUniqueAuditValues(allRows, 'action'),
      modules: getUniqueAuditValues(allRows, 'module')
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getRecentAdminToolAuditLogs(token) {
  try {
    requireAdmin(token);

    var actions = [
      'REBUILD_USAGE_SUMMARY',
      'ARCHIVE_USAGE',
      'ARCHIVE_USAGE_SCHEDULED',
      'SETUP_ARCHIVE_SCHEDULE',
      'REMOVE_ARCHIVE_SCHEDULE',
      'UPDATE_BUILD_DATE',
      'SAVE_PROVIDER_AUTH_SETTINGS',
      'APPROVE_PROVIDER_LOGIN',
      'TEST_PROVIDER_PUBLIC_KEY',
      'TEST_PROVIDER_PUBLIC_KEY_FAILED'
    ];
    var rows = readAuditRows().filter(function (row) {
      return actions.indexOf(row.action) !== -1;
    }).sort(function (a, b) {
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    }).slice(0, 5);

    return successResponse('โหลดประวัติเครื่องมือผู้ดูแลระบบเรียบร้อยแล้ว', rows);
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function cleanupAuditLogs(retentionDays, token) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var user = requireAdmin(token);
    retentionDays = Number(retentionDays) || DEFAULT_ARCHIVE_RETENTION_DAYS;

    if (retentionDays < MIN_AUDIT_RETENTION_DAYS) {
      return errorResponse('ต้องเก็บ Audit Log อย่างน้อย ' + MIN_AUDIT_RETENTION_DAYS + ' วัน', null);
    }

    var sheet = getSheetByName(SHEET_NAMES.AUDIT_LOGS);

    if (!sheet || sheet.getLastRow() < 2) {
      return successResponse('ไม่มี Audit Log ที่ต้องล้าง', {
        deletedRows: 0,
        retentionDays: retentionDays
      });
    }

    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    var rows = readAuditRows();
    var remainingRows = rows.filter(function (row) {
      var timestampDate = parseAuditTimestamp(row.timestamp);
      return !timestampDate || timestampDate >= cutoff;
    });
    var deletedRows = rows.length - remainingRows.length;

    if (deletedRows > 0) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      if (remainingRows.length > 0) {
        var headers = getSheetHeaders(sheet);
        var values = remainingRows.map(function (row) {
          return headers.map(function (header) {
            return row[header] !== undefined ? row[header] : '';
          });
        });
        sheet.getRange(2, 1, values.length, headers.length).setValues(values);
      }
    }

    writeAuditLog('CLEANUP_AUDIT', 'Audit', 'ล้าง Audit Log เก่ากว่า ' + retentionDays + ' วัน จำนวน ' + deletedRows + ' รายการ', user);

    return successResponse('ล้าง Audit Log เรียบร้อยแล้ว', {
      deletedRows: deletedRows,
      retentionDays: retentionDays
    });
  } catch (error) {
    return errorResponse(error.message, null);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function readAuditRows() {
  return readSheetRowsBySchema(SHEET_NAMES.AUDIT_LOGS, SHEET_HEADERS.audit_logs, function (auditLog) {
      return {
        audit_id: String(auditLog.audit_id || ''),
        action: String(auditLog.action || ''),
        module: String(auditLog.module || ''),
        detail: String(auditLog.detail || ''),
        username: String(auditLog.username || ''),
        full_name: String(auditLog.full_name || ''),
        role: String(auditLog.role || ''),
        timestamp: String(auditLog.timestamp || ''),
        user_agent: String(auditLog.user_agent || '')
      };
    })
    .filter(function (auditLog) {
      return String(auditLog.audit_id || auditLog.action || auditLog.timestamp || '').trim() !== '';
    });
}

function applyAuditFilters(rows, filters) {
  var startDate = String(filters.startDate || '').trim();
  var endDate = String(filters.endDate || '').trim();
  var action = String(filters.action || '').trim();
  var moduleName = String(filters.module || '').trim();
  var role = String(filters.role || '').trim();
  var keyword = String(filters.keyword || '').trim().toLowerCase();

  return rows.filter(function (row) {
    var isoDate = toAuditIsoDate(row.timestamp);

    if (startDate && isoDate && isoDate < startDate) return false;
    if (endDate && isoDate && isoDate > endDate) return false;
    if (action && row.action !== action) return false;
    if (moduleName && row.module !== moduleName) return false;
    if (role && row.role !== role) return false;

    if (keyword) {
      var searchText = [
        row.action,
        row.module,
        row.detail,
        row.username,
        row.full_name,
        row.role,
        row.timestamp
      ].join(' ').toLowerCase();
      if (searchText.indexOf(keyword) === -1) return false;
    }

    return true;
  }).sort(function (a, b) {
    return toAuditSortKey(b.timestamp).localeCompare(toAuditSortKey(a.timestamp));
  });
}

function toAuditIsoDate(timestamp) {
  var text = String(timestamp || '').trim();
  var match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

  if (!match) {
    return text.slice(0, 10);
  }

  return match[3] + '-' + match[2] + '-' + match[1];
}

function toAuditSortKey(timestamp) {
  var text = String(timestamp || '').trim();
  var match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);

  if (!match) {
    return text;
  }

  return match[3] + '-' + match[2] + '-' + match[1] + ' ' + (match[4] || '00') + ':' + (match[5] || '00') + ':' + (match[6] || '00');
}

function parseAuditTimestamp(timestamp) {
  var text = String(timestamp || '').trim();
  var match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);

  if (!match) {
    return null;
  }

  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
}

function getUniqueAuditValues(rows, key) {
  var seen = {};

  rows.forEach(function (row) {
    if (row[key]) {
      seen[row[key]] = true;
    }
  });

  return Object.keys(seen).sort();
}
