function getReportData(filters, token) {
  try {
    requireAdmin(token);

    if (shouldUseUsageMonthlySummary(filters || {})) {
      return successResponse('โหลดข้อมูลรายงานสรุปรายเดือนเรียบร้อยแล้ว', buildReportSummaryDataFromMonthlySummary(filters || {}));
    }

    var allRows = readUsageRows();
    var rows = applyReportFilters(allRows, filters || {});
    var page = normalizePagination(filters, 50, 500);
    var completedRows = rows.filter(function (row) {
      return row.status === 'completed';
    });

    return successResponse('โหลดข้อมูลรายงานเรียบร้อยแล้ว', {
      rows: rows.slice(page.offset, page.offset + page.limit),
      limit: page.limit,
      offset: page.offset,
      summary: buildReportSummary(rows, completedRows),
      performance: getUsageSummaryMeta(allRows.length)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getReportInitialData(filters, token) {
  try {
    requireAdmin(token);
    filters = filters || {};

    var reportData;

    if (shouldUseUsageMonthlySummary(filters)) {
      reportData = buildReportSummaryDataFromMonthlySummary(filters);
    } else {
      var allRows = readUsageRows();
      var rows = applyReportFilters(allRows, filters);
      var page = normalizePagination(filters, 50, 500);
      var completedRows = rows.filter(function (row) {
        return row.status === 'completed';
      });
      reportData = {
        rows: rows.slice(page.offset, page.offset + page.limit),
        limit: page.limit,
        offset: page.offset,
        summary: buildReportSummary(rows, completedRows),
        performance: getUsageSummaryMeta(allRows.length)
      };
    }

    return successResponse('โหลดหน้ารายงานเรียบร้อยแล้ว', {
      vehicles: getCachedActiveVehicles(),
      drivers: getCachedActiveDrivers(),
      missionTypes: getCachedActiveMissionTypes(),
      report: reportData
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function buildReportSummaryDataFromMonthlySummary(filters) {
  var rows = filterUsageMonthlySummary(readUsageMonthlySummaryRows(), buildSummaryFiltersFromDateFilters(filters || {}));
  var totalTrips = rows.reduce(function (total, row) { return total + parseNumber(row.trip_count); }, 0);
  var completedTrips = rows.reduce(function (total, row) { return total + parseNumber(row.completed_trip_count); }, 0);
  var totalKm = rows.reduce(function (total, row) { return total + parseNumber(row.total_km); }, 0);

  return {
    rows: rows.map(function (row) {
      return {
        usage_date: row.summary_month,
        start_time: '',
        end_time: '',
        vehicle_name: row.vehicle_name,
        plate_no: '',
        driver_name: row.driver_name,
        mission_type: row.mission_type,
        destination: 'สรุปรายเดือน',
        requester_name: '',
        requester_department: '',
        total_km: row.total_km,
        passenger_count: '',
        status: 'summary',
        created_by_name: ''
      };
    }),
    limit: rows.length,
    offset: 0,
    summary: {
      totalRows: totalTrips,
      completedTrips: completedTrips,
      cancelledTrips: 0,
      totalKm: totalKm,
      totalPassengers: 0
    },
    performance: {
      usageRowCount: getUsageDetailRowCount(),
      summaryRowCount: rows.length,
      summaryAvailable: true,
      shouldUseSummary: true,
      latestSummaryUpdate: getLatestSummaryUpdate(rows),
      dataMode: 'summary'
    }
  };
}

function buildReportSummary(rows, completedRows) {
  return {
    totalRows: rows.length,
    completedTrips: completedRows.length,
    cancelledTrips: rows.filter(function (row) { return row.status === 'cancelled'; }).length,
    totalKm: completedRows.reduce(function (total, row) {
      return total + parseNumber(row.total_km);
    }, 0),
    totalPassengers: completedRows.reduce(function (total, row) {
      return total + parseNumber(row.passenger_count);
    }, 0)
  };
}

function exportUsageCsv(filters, token) {
  try {
    var user = requireAdmin(token);
    var rows = applyReportFilters(readUsageRows(), filters || {});

    if (rows.length > REPORT_CSV_DIRECT_EXPORT_LIMIT) {
      return errorResponse('ข้อมูลสำหรับ Export CSV มี ' + rows.length + ' รายการ เกินขีดจำกัด ' + REPORT_CSV_DIRECT_EXPORT_LIMIT + ' รายการ กรุณากรองช่วงวันที่หรือเงื่อนไขให้แคบลงก่อนส่งออก', {
        rowCount: rows.length,
        limit: REPORT_CSV_DIRECT_EXPORT_LIMIT
      });
    }

    var headers = [
      'วันที่',
      'เวลาออก',
      'เวลากลับ',
      'รถ',
      'ทะเบียน',
      'พนักงานขับรถ',
      'ประเภทภารกิจ',
      'สถานที่ไป',
      'ผู้ขอใช้รถ',
      'หน่วยงาน',
      'เลขไมล์ก่อนออก',
      'เลขไมล์หลังกลับ',
      'ระยะทางรวม (กม.)',
      'จำนวนผู้โดยสาร',
      'หมายเหตุ',
      'สถานะ',
      'ผู้บันทึก',
      'วันที่บันทึก',
      'วันที่แก้ไข',
      'เหตุผลยกเลิก'
    ];
    var csvRows = [headers].concat(rows.map(function (row) {
      return [
        formatThaiBuddhistDate(row.usage_date),
        normalizeTimeValue(row.start_time),
        normalizeTimeValue(row.end_time),
        row.vehicle_name,
        row.plate_no,
        row.driver_name,
        row.mission_type,
        row.destination,
        row.requester_name,
        row.requester_department,
        row.start_mileage,
        row.end_mileage,
        row.total_km,
        row.passenger_count,
        row.note,
        row.status,
        row.created_by_name,
        row.created_at,
        row.updated_at,
        row.cancel_reason
      ];
    }));
    var csvContent = '\uFEFF' + csvRows.map(toCsvLine).join('\r\n');
    var fileName = buildReportCsvFileName(filters || {});

    writeAuditLog('EXPORT_REPORT', 'Report', 'Export CSV รายงานการใช้รถ ' + rows.length + ' รายการ', user);

    return successResponse('สร้างไฟล์ CSV เรียบร้อยแล้ว', {
      fileName: fileName,
      mimeType: 'text/csv;charset=utf-8',
      content: csvContent,
      rowCount: rows.length
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function applyReportFilters(rows, filters) {
  var normalizedFilters = normalizeReportFilters(filters);

  return rows.filter(function (row) {
    if (normalizedFilters.startDate && row.usage_date < normalizedFilters.startDate) return false;
    if (normalizedFilters.endDate && row.usage_date > normalizedFilters.endDate) return false;
    if (normalizedFilters.vehicleId && row.vehicle_id !== normalizedFilters.vehicleId) return false;
    if (normalizedFilters.driverId && row.driver_id !== normalizedFilters.driverId) return false;
    if (normalizedFilters.missionType && row.mission_type !== normalizedFilters.missionType) return false;
    if (normalizedFilters.status && row.status !== normalizedFilters.status) return false;

    if (normalizedFilters.keyword) {
      var searchText = [
        row.usage_date,
        row.vehicle_name,
        row.plate_no,
        row.driver_name,
        row.mission_type,
        row.destination,
        row.requester_name,
        row.requester_department,
        row.created_by_name,
        row.note,
        row.cancel_reason
      ].join(' ').toLowerCase();
      if (searchText.indexOf(normalizedFilters.keyword) === -1) return false;
    }

    return true;
  }).sort(function (a, b) {
    var dateCompare = String(a.usage_date || '').localeCompare(String(b.usage_date || ''));
    if (dateCompare !== 0) return dateCompare;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
}

function normalizeReportFilters(filters) {
  return {
    startDate: String(filters.startDate || '').trim(),
    endDate: String(filters.endDate || '').trim(),
    vehicleId: String(filters.vehicleId || '').trim(),
    driverId: String(filters.driverId || '').trim(),
    missionType: String(filters.missionType || '').trim(),
    status: String(filters.status || '').trim(),
    keyword: String(filters.keyword || '').trim().toLowerCase()
  };
}

function toCsvLine(values) {
  return values.map(function (value) {
    var text = value === null || value === undefined ? '' : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',');
}

function buildReportCsvFileName(filters) {
  var normalizedFilters = normalizeReportFilters(filters);
  var startDate = normalizedFilters.startDate || 'all';
  var endDate = normalizedFilters.endDate || 'all';
  return 'sph-vehicle-usage-report-' + startDate + '-to-' + endDate + '.csv';
}
