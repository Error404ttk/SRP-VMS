function rebuildUsageMonthlySummary(token) {
  try {
    var user = requireAdmin(token);
    var rows = readUsageRows();
    var summaryRows = buildUsageMonthlySummaryRows(rows);
    var sheet = getOrCreateSheet(SHEET_NAMES.USAGE_MONTHLY_SUMMARY);

    sheet.clearContents();
    sheet.getRange(1, 1, 1, SHEET_HEADERS.usage_monthly_summary.length).setValues([SHEET_HEADERS.usage_monthly_summary]);
    sheet.setFrozenRows(1);

    if (summaryRows.length > 0) {
      sheet.getRange(2, 1, summaryRows.length, SHEET_HEADERS.usage_monthly_summary.length).setValues(summaryRows.map(function (row) {
        return SHEET_HEADERS.usage_monthly_summary.map(function (header) {
          return row[header] !== undefined ? row[header] : '';
        });
      }));
    }

    writeAuditLog('REBUILD_USAGE_SUMMARY', 'Report', 'สร้างสรุปรายเดือนจำนวน ' + summaryRows.length + ' แถว จากรายการใช้รถ ' + rows.length + ' รายการ', user);

    return successResponse('สร้างสรุปรายเดือนเรียบร้อยแล้ว', {
      rowCount: summaryRows.length,
      usageRowCount: rows.length,
      updatedAt: nowString()
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageMonthlySummary(filters, token) {
  try {
    requireAdmin(token);
    return successResponse('โหลดสรุปรายเดือนเรียบร้อยแล้ว', filterUsageMonthlySummary(readUsageMonthlySummaryRows(), filters || {}));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageSummaryStatus(token) {
  try {
    requireAdmin(token);

    var usageRows = readUsageRows();
    var summaryRows = readUsageMonthlySummaryRows();

    return successResponse('ตรวจสถานะสรุปรายเดือนเรียบร้อยแล้ว', {
      usageRowCount: usageRows.length,
      summaryRowCount: summaryRows.length,
      shouldUseSummary: usageRows.length >= SUMMARY_THRESHOLD_ROWS,
      latestSummaryUpdate: getLatestSummaryUpdate(summaryRows)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getUsageDetailRowCount() {
  var sheet = getSheetByName(SHEET_NAMES.USAGE_LOGS);
  return sheet ? Math.max(sheet.getLastRow() - 1, 0) : 0;
}

function shouldUseUsageMonthlySummary(filters) {
  filters = filters || {};

  if (String(filters.keyword || '').trim() || String(filters.status || '').trim()) {
    return false;
  }

  return getUsageDetailRowCount() >= SUMMARY_THRESHOLD_ROWS && readUsageMonthlySummaryRows().length > 0;
}

function buildSummaryFiltersFromDateFilters(filters) {
  filters = filters || {};
  var startDate = String(filters.startDate || '').trim();
  var endDate = String(filters.endDate || '').trim();
  var month = String(filters.month || '').trim();
  var fiscalYear = String(filters.fiscalYear || '').trim();

  if (month) {
    startDate = month + '-01';
    endDate = month + '-31';
  }

  if (fiscalYear) {
    var buddhistYear = Number(fiscalYear);
    var gregorianYear = buddhistYear > 2400 ? buddhistYear - 543 : buddhistYear;
    startDate = (gregorianYear - 1) + '-10-01';
    endDate = gregorianYear + '-09-30';
  }

  return {
    startMonth: startDate ? startDate.slice(0, 7) : '',
    endMonth: endDate ? endDate.slice(0, 7) : '',
    vehicleId: String(filters.vehicleId || '').trim(),
    driverId: String(filters.driverId || '').trim(),
    missionType: String(filters.missionType || '').trim()
  };
}

function buildUsageMonthlySummaryRows(rows) {
  var groups = {};
  var updatedAt = nowString();

  rows.forEach(function (row) {
    if (row.status === 'cancelled') {
      return;
    }

    var month = String(row.usage_date || '').slice(0, 7);
    if (!month.match(/^\d{4}-\d{2}$/)) {
      return;
    }

    var key = [
      month,
      row.vehicle_id,
      row.vehicle_name,
      row.driver_id,
      row.driver_name,
      row.mission_type
    ].join('|');

    if (!groups[key]) {
      groups[key] = {
        summary_month: month,
        vehicle_id: row.vehicle_id,
        vehicle_name: row.vehicle_name,
        driver_id: row.driver_id,
        driver_name: row.driver_name,
        mission_type: row.mission_type,
        trip_count: 0,
        completed_trip_count: 0,
        total_km: 0,
        updated_at: updatedAt
      };
    }

    groups[key].trip_count += 1;

    if (row.status === 'completed') {
      groups[key].completed_trip_count += 1;
      groups[key].total_km += parseNumber(row.total_km);
    }
  });

  return Object.keys(groups).map(function (key) {
    return groups[key];
  }).sort(function (a, b) {
    return String(a.summary_month).localeCompare(String(b.summary_month)) ||
      String(a.vehicle_name).localeCompare(String(b.vehicle_name));
  });
}

function readUsageMonthlySummaryRows() {
  return readSheetRowsBySchema(SHEET_NAMES.USAGE_MONTHLY_SUMMARY, SHEET_HEADERS.usage_monthly_summary)
    .filter(function (row) {
      return String(row.summary_month || '').trim() !== '';
    })
    .map(function (row) {
      return {
        summary_month: String(row.summary_month || ''),
        vehicle_id: String(row.vehicle_id || ''),
        vehicle_name: String(row.vehicle_name || ''),
        driver_id: String(row.driver_id || ''),
        driver_name: String(row.driver_name || ''),
        mission_type: String(row.mission_type || ''),
        trip_count: parseNumber(row.trip_count),
        completed_trip_count: parseNumber(row.completed_trip_count),
        total_km: parseNumber(row.total_km),
        updated_at: String(row.updated_at || '')
      };
    });
}

function filterUsageMonthlySummary(rows, filters) {
  var startMonth = String(filters.startMonth || '').trim();
  var endMonth = String(filters.endMonth || '').trim();
  var vehicleId = String(filters.vehicleId || '').trim();
  var driverId = String(filters.driverId || '').trim();
  var missionType = String(filters.missionType || '').trim();

  return rows.filter(function (row) {
    if (startMonth && row.summary_month < startMonth) return false;
    if (endMonth && row.summary_month > endMonth) return false;
    if (vehicleId && row.vehicle_id !== vehicleId) return false;
    if (driverId && row.driver_id !== driverId) return false;
    if (missionType && row.mission_type !== missionType) return false;
    return true;
  });
}

function getLatestSummaryUpdate(summaryRows) {
  return (summaryRows || []).reduce(function (latest, row) {
    return String(row.updated_at || '').localeCompare(String(latest || '')) > 0 ? row.updated_at : latest;
  }, '');
}
