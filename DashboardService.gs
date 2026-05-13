function getDashboardData(filters, token) {
  try {
    requireAdmin(token);

    return successResponse('โหลดข้อมูล Dashboard เรียบร้อยแล้ว', buildDashboardPayload(filters || {}));
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function getDashboardInitialData(filters, token) {
  try {
    requireAdmin(token);
    filters = filters || {};

    return successResponse('โหลดหน้า Dashboard เรียบร้อยแล้ว', {
      vehicles: readVehicleRows(),
      drivers: readDriverRows(),
      missionTypes: getCachedActiveMissionTypes(),
      dashboard: buildDashboardPayload(filters)
    });
  } catch (error) {
    return errorResponse(error.message, null);
  }
}

function buildDashboardPayload(filters) {
    if (shouldUseUsageMonthlySummary(filters || {})) {
      return buildDashboardPayloadFromMonthlySummary(filters || {});
    }

    var range = resolveDashboardDateRange(filters || {});
    var allLogs = readUsageRows();
    var summaryStatus = getUsageSummaryMeta(allLogs.length);
    var filteredLogs = applyDashboardFilters(allLogs, filters || {}, range);
    var countedLogs = filteredLogs.filter(function (row) {
      return row.status !== 'cancelled';
    });
    var completedLogs = filteredLogs.filter(function (row) {
      return row.status === 'completed';
    });
    var vehicleGroups = groupUsage(countedLogs, 'vehicle_name', 'total_km');
    var driverGroups = groupUsage(countedLogs, 'driver_name', 'total_km');
    var missionGroups = groupUsage(countedLogs, 'mission_type', 'total_km');
    var destinationGroups = groupUsage(countedLogs, 'destination', 'total_km');
    var vehicleKmGroups = groupUsage(completedLogs, 'vehicle_name', 'total_km');
    var vehicleTripStats = toSimpleStats(vehicleGroups.slice());
    var vehicleKmStats = toSimpleStats(vehicleKmGroups.slice(), 'km');
    var driverStats = toSimpleStats(driverGroups.slice());
    var missionStats = toSimpleStats(missionGroups.slice());
    var topVehicle = vehicleTripStats.length > 0 ? vehicleTripStats[0].name : 'ไม่มีข้อมูล';
    var topDriver = driverStats.length > 0 ? driverStats[0].name : 'ไม่มีข้อมูล';

    return {
      summary: {
        totalTrips: countedLogs.length,
        totalKm: sumKm(completedLogs),
        totalRefer: countedLogs.filter(function (row) { return row.mission_type === 'Refer ผู้ป่วย'; }).length,
        activeVehicles: countUnique(countedLogs, 'vehicle_id'),
        topVehicle: topVehicle,
        topDriver: topDriver,
        rangeLabel: getDashboardRangeLabel(range)
      },
      dailyTrend: toDailyTrend(countedLogs),
      missionTypeStats: missionStats,
      missionTypeShare: missionStats,
      topVehiclesByTrips: vehicleTripStats.slice(0, 5),
      topVehiclesByKm: vehicleKmStats.slice(0, 5),
      topDrivers: driverStats.slice(0, 5),
      topDestinations: toSimpleStats(destinationGroups).slice(0, 10),
      vehicleKmStats: vehicleKmStats,
      latestLogs: countedLogs.slice().sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }).slice(0, 10),
      performance: summaryStatus
    };
}

function buildDashboardPayloadFromMonthlySummary(filters) {
  var range = resolveDashboardDateRange(filters || {});
  var summaryRows = filterUsageMonthlySummary(readUsageMonthlySummaryRows(), buildSummaryFiltersFromDateFilters(filters || {}));
  var vehicleTripStats = toSimpleStats(groupSummaryRows(summaryRows, 'vehicle_name'));
  var vehicleKmStats = toSimpleStats(groupSummaryRows(summaryRows, 'vehicle_name'), 'km');
  var driverStats = toSimpleStats(groupSummaryRows(summaryRows, 'driver_name'));
  var missionStats = toSimpleStats(groupSummaryRows(summaryRows, 'mission_type'));
  var monthlyTrend = toMonthlyTrend(summaryRows);
  var totalTrips = summaryRows.reduce(function (total, row) { return total + parseNumber(row.trip_count); }, 0);
  var totalKm = summaryRows.reduce(function (total, row) { return total + parseNumber(row.total_km); }, 0);

  return {
    summary: {
      totalTrips: totalTrips,
      totalKm: totalKm,
      totalRefer: summaryRows.reduce(function (total, row) {
        return total + (row.mission_type === 'Refer ผู้ป่วย' ? parseNumber(row.trip_count) : 0);
      }, 0),
      activeVehicles: countUnique(summaryRows, 'vehicle_id'),
      topVehicle: vehicleTripStats.length > 0 ? vehicleTripStats[0].name : 'ไม่มีข้อมูล',
      topDriver: driverStats.length > 0 ? driverStats[0].name : 'ไม่มีข้อมูล',
      rangeLabel: getDashboardRangeLabel(range)
    },
    dailyTrend: monthlyTrend,
    missionTypeStats: missionStats,
    missionTypeShare: missionStats,
    topVehiclesByTrips: vehicleTripStats.slice(0, 5),
    topVehiclesByKm: vehicleKmStats.slice(0, 5),
    topDrivers: driverStats.slice(0, 5),
    topDestinations: [],
    vehicleKmStats: vehicleKmStats,
    latestLogs: [],
    performance: {
      usageRowCount: getUsageDetailRowCount(),
      summaryRowCount: summaryRows.length,
      summaryAvailable: true,
      shouldUseSummary: true,
      latestSummaryUpdate: getLatestSummaryUpdate(summaryRows),
      dataMode: 'summary'
    }
  };
}

function groupSummaryRows(rows, nameKey) {
  var map = {};

  rows.forEach(function (row) {
    var name = String(row[nameKey] || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
    if (!map[name]) {
      map[name] = {
        name: name,
        count: 0,
        km: 0
      };
    }
    map[name].count += parseNumber(row.trip_count);
    map[name].km += parseNumber(row.total_km);
  });

  return Object.keys(map).map(function (key) {
    return map[key];
  });
}

function toMonthlyTrend(rows) {
  return toSimpleStats(groupSummaryRows(rows, 'summary_month')).sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  }).map(function (item) {
    return {
      date: item.name,
      dateDisplay: formatThaiMonthLabel(item.name),
      count: item.count
    };
  });
}

function formatThaiMonthLabel(monthValue) {
  var parts = String(monthValue || '').split('-');
  if (parts.length !== 2) {
    return monthValue;
  }
  return parts[1] + '/' + (Number(parts[0]) + 543);
}

function getUsageSummaryMeta(usageRowCount) {
  var summaryRows = readUsageMonthlySummaryRows();

  return {
    usageRowCount: usageRowCount,
    summaryRowCount: summaryRows.length,
    summaryAvailable: summaryRows.length > 0,
    shouldUseSummary: usageRowCount >= SUMMARY_THRESHOLD_ROWS,
    latestSummaryUpdate: getLatestSummaryUpdate(summaryRows),
    dataMode: usageRowCount >= SUMMARY_THRESHOLD_ROWS && summaryRows.length > 0 ? 'summary-ready' : 'detail'
  };
}

function applyDashboardFilters(rows, filters, range) {
  range = range || resolveDashboardDateRange(filters);
  var vehicleId = String(filters.vehicleId || '').trim();
  var driverId = String(filters.driverId || '').trim();
  var missionType = String(filters.missionType || '').trim();

  return rows.filter(function (row) {
    if (range.startDate && row.usage_date < range.startDate) return false;
    if (range.endDate && row.usage_date > range.endDate) return false;
    if (vehicleId && row.vehicle_id !== vehicleId) return false;
    if (driverId && row.driver_id !== driverId) return false;
    if (missionType && row.mission_type !== missionType) return false;
    return true;
  });
}

function resolveDashboardDateRange(filters) {
  var startDate = String(filters.startDate || '').trim();
  var endDate = String(filters.endDate || '').trim();
  var month = String(filters.month || '').trim();
  var fiscalYear = String(filters.fiscalYear || '').trim();

  if (month) {
    var parts = month.split('-');
    if (parts.length === 2) {
      var year = Number(parts[0]);
      var monthIndex = Number(parts[1]);
      startDate = year + '-' + pad2(monthIndex) + '-01';
      endDate = formatIsoDate(new Date(year, monthIndex, 0));
    }
  }

  if (fiscalYear) {
    var buddhistYear = Number(fiscalYear);
    var gregorianYear = buddhistYear > 2400 ? buddhistYear - 543 : buddhistYear;
    startDate = (gregorianYear - 1) + '-10-01';
    endDate = gregorianYear + '-09-30';
  }

  if (!startDate && !endDate) {
    var currentMonth = getCurrentMonthRange();
    startDate = currentMonth.startDate;
    endDate = currentMonth.endDate;
  }

  return {
    startDate: startDate,
    endDate: endDate
  };
}

function getDashboardRangeLabel(range) {
  if (range.startDate && range.endDate) {
    return formatThaiBuddhistDate(range.startDate) + ' ถึง ' + formatThaiBuddhistDate(range.endDate);
  }

  if (range.startDate) {
    return 'ตั้งแต่ ' + formatThaiBuddhistDate(range.startDate);
  }

  if (range.endDate) {
    return 'ถึง ' + formatThaiBuddhistDate(range.endDate);
  }

  return 'ทั้งหมด';
}

function groupUsage(rows, nameKey, kmKey) {
  var map = {};

  rows.forEach(function (row) {
    var name = String(row[nameKey] || 'ไม่ระบุ').trim() || 'ไม่ระบุ';

    if (!map[name]) {
      map[name] = {
        name: name,
        count: 0,
        km: 0
      };
    }

    map[name].count += 1;
    map[name].km += parseNumber(row[kmKey]);
  });

  return Object.keys(map).map(function (key) {
    return map[key];
  });
}

function toSimpleStats(items, sortBy) {
  var key = sortBy === 'km' ? 'km' : 'count';

  return items.sort(function (a, b) {
    return b[key] - a[key];
  }).map(function (item) {
    return {
      name: item.name,
      count: item.count,
      km: item.km
    };
  });
}

function toDailyTrend(rows) {
  var grouped = groupUsage(rows, 'usage_date', 'total_km').sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });

  return grouped.map(function (item) {
    return {
      date: item.name,
      dateDisplay: formatThaiBuddhistDate(item.name),
      count: item.count
    };
  });
}

function sumKm(rows) {
  return rows.reduce(function (total, row) {
    return total + parseNumber(row.total_km);
  }, 0);
}

function countUnique(rows, key) {
  var seen = {};
  rows.forEach(function (row) {
    if (row[key]) {
      seen[row[key]] = true;
    }
  });
  return Object.keys(seen).length;
}



function getCurrentMonthRange() {
  var now = new Date();
  var firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: formatIsoDate(firstDay),
    endDate: formatIsoDate(lastDay)
  };
}

function formatIsoDate(date) {
  return Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function pad2(value) {
  return String(value).length === 1 ? '0' + value : String(value);
}
