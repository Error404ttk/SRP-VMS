import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyToken, requireAuth, requireAdmin, hashPassword, verifyPassword, getJwtSecret } from '../utils/auth.js';
import { formatThaiDate, formatThaiDateTime, isValidIsoDate, isValidTimeValue, parseThaiDateTime } from '../utils/formatters.js';
import { 
  doc, SHEET_NAMES, CACHE_TTL, sheetCache, sheetCacheTime, masterDataCache, masterDataCacheTime, 
  invalidateCache, getSheetRows, getRowsAsObjects, appendRowObject, findObjectById, 
  updateObjectById, getMasterData, writeAuditLog, updateVehicleMileageFromUsage
} from '../services/googleSheets.js';
import { appConfig, UI_PAGES, providerSettingsStore } from '../utils/config.js';

const router = express.Router();

// Helper to handle async route
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- RPC BACKEND FOR FRONTEND ---

router.post('/api/rpc/:methodName', async (req, res) => {
  const { methodName } = req.params;
  const args = req.body || [];
  
  try {
    // Centralized access control list (Security Level 2) - Role-based RPC visibility mapping
    const rpcRoleMap = {
      // Admin only methods
      getVehicles: ['admin'],
      createVehicle: ['admin'],
      updateVehicle: ['admin'],
      getDrivers: ['admin'],
      createDriver: ['admin'],
      updateDriver: ['admin'],
      getDepartments: ['admin'],
      createDepartment: ['admin'],
      updateDepartment: ['admin'],
      getMissionTypes: ['admin'],
      createMissionType: ['admin'],
      updateMissionType: ['admin'],
      getDestinations: ['admin'],
      createDestination: ['admin'],
      updateDestination: ['admin'],
      getAuditLogs: ['admin'],
      cleanupAuditLogs: ['admin'],
      getRecentAdminToolAuditLogs: ['admin'],
      getUsageDateTimeIssues: ['admin'],
      getUsageMasterDataIssues: ['admin'],
      getUsageSummaryStatus: ['admin'],
      rebuildUsageMonthlySummary: ['admin'],
      archiveOldUsageLogs: ['admin'],
      updateBuildDate: ['admin'],
      getProviderAuthSettings: ['admin'],
      saveProviderAuthSettings: ['admin'],
      getProviderAuthDiagnostics: ['admin'],
      getPendingProviderLogins: ['admin'],
      approvePendingProviderLogin: ['admin'],
      
      // Admin and Manager
      getUsers: ['admin', 'manager'],
      createUser: ['admin', 'manager'],
      updateUser: ['admin', 'manager'],
      
      // Admin, Manager, and Driver Head
      getDashboardInitialData: ['admin', 'manager', 'driver_head'],
      getDashboardData: ['admin', 'manager', 'driver_head'],
      getReportInitialData: ['admin', 'manager', 'driver_head'],
      getReportData: ['admin', 'manager', 'driver_head'],
      exportUsageCsv: ['admin', 'manager', 'driver_head']
    };

    if (rpcRoleMap[methodName]) {
      const token = req.cookies.auth_token;

      if (!token) {
        return res.status(401).json({ success: false, message: 'สิทธิ์ล้มเหลว: กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
      }

      const decoded = verifyToken(token);
      const userRole = (decoded?.role || '').toLowerCase();
      if (!decoded || !rpcRoleMap[methodName].includes(userRole)) {
        return res.status(403).json({ success: false, message: 'สิทธิ์ล้มเหลว: คุณไม่มีระดับสิทธิ์ที่เหมาะสมในการสั่งประมวลผลคำสั่งนี้' });
      }
    }

    // Security Level 1: Methods that require basic authentication (any logged-in user)
    // Note: 'logout' is intentionally excluded — must always succeed to avoid trapping users
    const authRequiredMethods = new Set([
      'getUsageFormOptions', 'createUsageLog', 'updateUsageLog', 'completeUsageLog',
      'cancelUsageLog', 'getUsageListInitialData', 'getUsageLogs'
    ]);
    if (authRequiredMethods.has(methodName)) {
      const token = req.cookies.auth_token;
      if (!token) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
      }
      const decoded = verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ success: false, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
    }
    // 1. logout RPC
    if (methodName === 'logout') {
      const token = req.cookies.auth_token;
      const user = token ? verifyToken(token) : null;
      if (user) {
        await writeAuditLog('LOGOUT', 'Auth', 'ออกจากระบบ', user);
      }
      res.clearCookie('auth_token');
      return res.json({ success: true, result: { success: true } });
    }

    // 2. getUsageFormOptions RPC
    if (methodName === 'getUsageFormOptions') {
      const data = await getMasterData();
      return res.json({
        success: true,
        result: {
          success: true,
          data: data
        }
      });
    }

    // 3. createUsageLog RPC
    if (methodName === 'createUsageLog') {
      const payload = args[0];
      const user = requireAuth(req.cookies.auth_token);
      
      await doc.loadInfo();
      const logsSheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_LOGS];
      const vehiclesSheet = doc.sheetsByTitle[SHEET_NAMES.VEHICLES];
      const driversSheet = doc.sheetsByTitle[SHEET_NAMES.DRIVERS];
      
      const [vRows, dRows, lRows] = await Promise.all([
        vehiclesSheet.getRows(),
        driversSheet.getRows(),
        logsSheet.getRows()
      ]);
      
      const vehicleRow = vRows.find(r => r.get('vehicle_id') === payload.vehicle_id);
      const driverRow = dRows.find(r => r.get('driver_id') === payload.driver_id);
      
      if (!vehicleRow) throw new Error('ไม่พบข้อมูลรถราชการ');
      if (vehicleRow.get('status') === 'repair' || vehicleRow.get('status') === 'inactive') throw new Error('รถคันนี้ไม่พร้อมใช้งาน');
      if (vehicleRow.get('status') === 'in_use') throw new Error('รถคันนี้กำลังถูกใช้งานอยู่');
      if (!driverRow || driverRow.get('status') !== 'active') throw new Error('พนักงานขับรถนี้ไม่อยู่ในสถานะใช้งาน');

      const isDriverBusy = lRows.some(r => r.get('driver_id') === payload.driver_id && String(r.get('status') || '').trim().toLowerCase() === 'in_use');
      if (isDriverBusy) throw new Error('พนักงานขับรถคนนี้กำลังปฏิบัติหน้าที่อยู่ (ยังไม่กลับมาพร้อมรถ)');
      
      const log_id = crypto.randomUUID();
      const thaiNow = formatThaiDateTime(new Date());
      
      const usageLog = {
        log_id: log_id,
        usage_date: payload.usage_date,
        start_time: payload.start_time,
        end_time: '',
        vehicle_id: payload.vehicle_id,
        plate_no: vehicleRow.get('plate_no') || '',
        vehicle_name: vehicleRow.get('vehicle_name') || '',
        driver_id: payload.driver_id,
        driver_name: driverRow.get('full_name') || '',
        mission_type: payload.mission_type,
        destination: payload.destination,
        requester_name: payload.requester_name,
        requester_department: payload.requester_department,
        start_mileage: payload.start_mileage,
        end_mileage: '',
        total_km: 0,
        passenger_count: payload.passenger_count || 0,
        note: payload.note || '',
        status: 'in_use',
        created_by: user.user_id,
        created_by_name: user.full_name,
        created_at: thaiNow,
        updated_at: thaiNow,
        cancel_reason: ''
      };
      
      await logsSheet.addRow(usageLog);
      
      vehicleRow.set('status', 'in_use');
      vehicleRow.set('updated_at', thaiNow);
      await vehicleRow.save();
      
      invalidateCache(SHEET_NAMES.VEHICLES); // Clear cache
      await writeAuditLog('CREATE_USAGE', 'Usage', 'เริ่มใช้งานรถ: ' + usageLog.vehicle_name + ' ไป ' + usageLog.destination, user);

      return res.json({
        success: true,
        result: {
          success: true,
          data: usageLog
        }
      });
    }

    // 4. updateUsageLog RPC
    if (methodName === 'updateUsageLog') {
      const logId = args[0];
      const payload = args[1];
      const user = requireAuth(req.cookies.auth_token);
      
      await doc.loadInfo();
      const logsSheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_LOGS];
      const lRows = await logsSheet.getRows();
      const logRow = lRows.find(r => r.get('log_id') === logId);
      
      if (!logRow) throw new Error('ไม่พบข้อมูลรายการใช้รถ');
      if (user.role !== 'admin' && logRow.get('created_by') !== user.user_id) {
        throw new Error('คุณไม่มีสิทธิ์แก้ไขรายการนี้');
      }
      
      const thaiNow = formatThaiDateTime(new Date());
      logRow.set('usage_date', payload.usage_date);
      logRow.set('start_time', payload.start_time);
      logRow.set('end_time', payload.end_time);
      logRow.set('mission_type', payload.mission_type);
      logRow.set('destination', payload.destination);
      logRow.set('requester_name', payload.requester_name);
      logRow.set('requester_department', payload.requester_department);
      logRow.set('start_mileage', payload.start_mileage);
      logRow.set('end_mileage', payload.end_mileage);
      logRow.set('total_km', Number(payload.end_mileage || 0) - Number(payload.start_mileage || 0));
      logRow.set('passenger_count', payload.passenger_count || 0);
      logRow.set('note', payload.note || '');
      logRow.set('updated_at', thaiNow);
      await logRow.save();

      await updateVehicleMileageFromUsage(payload.vehicle_id, payload.end_mileage);
      await writeAuditLog('UPDATE_USAGE', 'Usage', 'แก้ไขรายการใช้รถ: ' + logId, user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: logRow.toObject()
        }
      });
    }

    // 5. completeUsageLog RPC
    if (methodName === 'completeUsageLog') {
      const logId = args[0];
      const payload = args[1];
      const user = requireAuth(req.cookies.auth_token);
      
      await doc.loadInfo();
      const logsSheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_LOGS];
      const lRows = await logsSheet.getRows();
      const logRow = lRows.find(r => r.get('log_id') === logId);
      
      if (!logRow) throw new Error('ไม่พบข้อมูลรายการใช้รถ');
      if (user.role !== 'admin' && logRow.get('created_by') !== user.user_id) {
        throw new Error('คุณไม่มีสิทธิ์ปิดงานรายการนี้');
      }
      if (logRow.get('status') !== 'in_use') throw new Error('รายการนี้ไม่ได้อยู่ในสถานะกำลังใช้งาน');
      
      const startMil = Number(logRow.get('start_mileage')) || 0;
      const endMil = Number(payload.end_mileage) || 0;
      if (endMil < startMil) throw new Error('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก');
      
      const thaiNow = formatThaiDateTime(new Date());
      logRow.set('end_time', payload.end_time);
      logRow.set('end_mileage', payload.end_mileage);
      logRow.set('total_km', endMil - startMil);
      logRow.set('passenger_count', payload.passenger_count || 0);
      logRow.set('note', payload.note || '');
      logRow.set('status', 'completed');
      logRow.set('updated_at', thaiNow);
      await logRow.save();
      
      await updateVehicleMileageFromUsage(logRow.get('vehicle_id'), endMil);
      await writeAuditLog('COMPLETE_USAGE', 'Usage', 'ปิดงานใช้รถ: ' + logId, user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: logRow.toObject()
        }
      });
    }

    // 6. cancelUsageLog RPC
    if (methodName === 'cancelUsageLog') {
      const logId = args[0];
      const reason = args[1];
      const user = requireAuth(req.cookies.auth_token);
      
      await doc.loadInfo();
      const logsSheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_LOGS];
      const lRows = await logsSheet.getRows();
      const logRow = lRows.find(r => r.get('log_id') === logId);
      
      if (!logRow) throw new Error('ไม่พบข้อมูลรายการใช้รถ');
      if (user.role !== 'admin' && logRow.get('created_by') !== user.user_id) {
        throw new Error('คุณไม่มีสิทธิ์ยกเลิกรายการนี้');
      }
      
      const thaiNow = formatThaiDateTime(new Date());
      logRow.set('status', 'cancelled');
      logRow.set('cancel_reason', reason || '');
      logRow.set('updated_at', thaiNow);
      await logRow.save();
      
      await updateVehicleMileageFromUsage(logRow.get('vehicle_id'), null);
      await writeAuditLog('CANCEL_USAGE', 'Usage', 'ยกเลิกรายการใช้รถ: ' + logId + ' เหตุผล: ' + reason, user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: logRow.toObject()
        }
      });
    }

    // 7. getUsageLogs & InitialData RPCs
    if (['getUsageListInitialData', 'getUsageLogs', 'getDashboardInitialData', 'getDashboardData'].includes(methodName)) {
      const filters = args[0] || {};
      const masterData = await getMasterData();
      
      await doc.loadInfo();
      const logsSheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_LOGS];
      const rawLogs = await logsSheet.getRows();
      let logs = rawLogs.map(r => r.toObject());
      
      // Sort newest first
      logs.sort((a, b) => parseThaiDateTime(b.created_at) - parseThaiDateTime(a.created_at));

      if (methodName === 'getUsageListInitialData' || methodName === 'getUsageLogs') {
        const user = requireAuth(req.cookies.auth_token);
        if (user && user.role !== 'admin') {
          if (user.role === 'driver_head') {
            // driver_head sees all logs, do not filter
          } else if (user.role === 'manager') {
            const managerDept = (user.department || '').trim().toLowerCase();
            logs = logs.filter(l => {
              const reqDept = (l.requester_department || '').trim().toLowerCase();
              return l.created_by === user.user_id || (managerDept && reqDept === managerDept);
            });
          } else if (user.role === 'driver') {
            const driverName = (user.full_name || '').trim().toLowerCase();
            logs = logs.filter(l => {
              const assignedDriver = (l.driver_name || '').trim().toLowerCase();
              return l.created_by === user.user_id || (driverName && assignedDriver === driverName);
            });
          } else {
            logs = logs.filter(l => l.created_by === user.user_id);
          }
        }

        if (filters.status) logs = logs.filter(l => l.status === filters.status);
        if (filters.vehicleId) logs = logs.filter(l => l.vehicle_id === filters.vehicleId);
        
        const page = Number(filters.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        const pagedLogs = {
          rows: logs.slice(offset, offset + limit),
          totalRows: logs.length,
          limit,
          offset
        };
        
        return res.json({
          success: true,
          result: {
            success: true,
            data: methodName === 'getUsageLogs' ? pagedLogs : { ...masterData, logs: pagedLogs }
          }
        });
      }

      if (methodName === 'getDashboardInitialData' || methodName === 'getDashboardData') {
        const pad2 = (val) => String(val).padStart(2, '0');
        const resolveDashboardDateRange = (f) => {
          let startDate = String(f.startDate || '').trim();
          let endDate = String(f.endDate || '').trim();
          const month = String(f.month || '').trim();
          const fiscalYear = String(f.fiscalYear || '').trim();

          if (month) {
            const parts = month.split('-');
            if (parts.length === 2) {
              const year = Number(parts[0]);
              const monthIndex = Number(parts[1]);
              startDate = `${year}-${pad2(monthIndex)}-01`;
              const lastDayDate = new Date(year, monthIndex, 0);
              endDate = `${lastDayDate.getFullYear()}-${pad2(lastDayDate.getMonth() + 1)}-${pad2(lastDayDate.getDate())}`;
            }
          }

          if (fiscalYear) {
            const buddhistYear = Number(fiscalYear);
            const gregorianYear = buddhistYear > 2400 ? buddhistYear - 543 : buddhistYear;
            startDate = `${gregorianYear - 1}-10-01`;
            endDate = `${gregorianYear}-09-30`;
          }

          if (!startDate && !endDate) {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            startDate = `${firstDay.getFullYear()}-${pad2(firstDay.getMonth() + 1)}-01`;
            endDate = `${lastDay.getFullYear()}-${pad2(lastDay.getMonth() + 1)}-${pad2(lastDay.getDate())}`;
          }

          return { startDate, endDate };
        };

        const formatThaiBuddhistDate = (isoDateStr) => {
          if (!isoDateStr) return '';
          const parts = isoDateStr.split('-');
          if (parts.length !== 3) return isoDateStr;
          const year = Number(parts[0]) + 543;
          const month = parts[1];
          const day = parts[2];
          return `${day}/${month}/${year}`;
        };

        const getDashboardRangeLabel = (range) => {
          if (range.startDate && range.endDate) {
            return `${formatThaiBuddhistDate(range.startDate)} ถึง ${formatThaiBuddhistDate(range.endDate)}`;
          }
          if (range.startDate) {
            return `ตั้งแต่ ${formatThaiBuddhistDate(range.startDate)}`;
          }
          if (range.endDate) {
            return `ถึง ${formatThaiBuddhistDate(range.endDate)}`;
          }
          return 'ทั้งหมด';
        };

        const parseComparableDate = (str) => {
          if (!str) return null;
          const cleanStr = String(str).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
            const parts = cleanStr.split('-');
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
          }
          const slashParts = cleanStr.split('/');
          if (slashParts.length === 3) {
            const day = Number(slashParts[0]);
            const month = Number(slashParts[1]) - 1;
            let year = Number(slashParts[2]);
            if (year > 2400) year -= 543;
            return new Date(year, month, day).getTime();
          }
          const parsed = new Date(cleanStr).getTime();
          return isNaN(parsed) ? null : parsed;
        };

        const range = resolveDashboardDateRange(filters);
        const startTimestamp = parseComparableDate(range.startDate);
        const endTimestamp = parseComparableDate(range.endDate);
        const vehicleId = String(filters.vehicleId || '').trim();
        const driverId = String(filters.driverId || '').trim();
        const missionType = String(filters.missionType || '').trim();

        const filteredLogs = logs.filter(row => {
          const rowTimestamp = parseComparableDate(row.usage_date);
          if (!rowTimestamp) return false;
          if (startTimestamp && rowTimestamp < startTimestamp) return false;
          if (endTimestamp && rowTimestamp > endTimestamp) return false;
          if (vehicleId && row.vehicle_id !== vehicleId) return false;
          if (driverId && row.driver_id !== driverId) return false;
          if (missionType && row.mission_type !== missionType) return false;
          return true;
        });

        const completedLogs = filteredLogs.filter(l => l.status === 'completed');
        const countedLogs = filteredLogs.filter(l => l.status !== 'cancelled');
        
        const groupUsage = (rows, nameKey) => {
          const map = {};
          rows.forEach(r => {
            const name = (r[nameKey] || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
            if (!map[name]) map[name] = { name, count: 0, km: 0 };
            map[name].count += 1;
            map[name].km += Number(r.total_km || 0);
          });
          return Object.values(map);
        };

        const toSimpleStats = (items, sortBy = 'count') => {
          return items.sort((a, b) => b[sortBy] - a[sortBy]).map(item => ({
            name: item.name,
            count: item.count,
            km: item.km
          }));
        };

        const toDailyTrend = (rows) => {
          const grouped = groupUsage(rows, 'usage_date').sort((a, b) => String(a.name).localeCompare(String(b.name)));
          return grouped.map(item => {
            const parts = item.name.split('-');
            const display = parts.length === 3 ? `${parts[2]}/${parts[1]}/${Number(parts[0])+543}` : item.name;
            return {
              date: item.name,
              dateDisplay: display,
              count: item.count
            };
          });
        };

        const vehicleTripStats = toSimpleStats(groupUsage(countedLogs, 'vehicle_name'));
        const vehicleKmStats = toSimpleStats(groupUsage(completedLogs, 'vehicle_name'), 'km');
        const driverStats = toSimpleStats(groupUsage(countedLogs, 'driver_name'));
        const missionStats = toSimpleStats(groupUsage(countedLogs, 'mission_type'));
        
        return res.json({
          success: true,
          result: {
            success: true,
            data: {
              vehicles: masterData.vehicles,
              drivers: masterData.drivers,
              missionTypes: masterData.missionTypes,
              dashboard: {
                summary: {
                  totalTrips: countedLogs.length,
                  totalKm: completedLogs.reduce((acc, l) => acc + Number(l.total_km || 0), 0),
                  totalRefer: countedLogs.filter(l => l.mission_type === 'Refer ผู้ป่วย').length,
                  activeVehicles: new Set(countedLogs.map(l => l.vehicle_id)).size,
                  topVehicle: vehicleTripStats.length > 0 ? vehicleTripStats[0].name : 'ไม่มีข้อมูล',
                  topDriver: driverStats.length > 0 ? driverStats[0].name : 'ไม่มีข้อมูล',
                  rangeLabel: getDashboardRangeLabel(range)
                },
                dailyTrend: toDailyTrend(countedLogs),
                missionTypeStats: missionStats,
                missionTypeShare: missionStats,
                topVehiclesByTrips: vehicleTripStats.slice(0, 5),
                topVehiclesByKm: vehicleKmStats.slice(0, 5),
                vehicleKmStats: vehicleKmStats,
                topDrivers: driverStats.slice(0, 5),
                topDestinations: toSimpleStats(groupUsage(countedLogs, 'destination')).slice(0, 10),
                latestLogs: countedLogs.slice(0, 10),
                performance: { dataMode: 'detail' }
              }
            }
          }
        });
      }
    }

    // 8. vehicles RPC
    if (methodName === 'getVehicles') {
      requireAdmin(req.cookies.auth_token);
      const data = await getRowsAsObjects(SHEET_NAMES.VEHICLES);
      return res.json({ success: true, result: { success: true, data } });
    }
    if (methodName === 'createVehicle') {
      const payload = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const item = {
        vehicle_id: crypto.randomUUID(),
        plate_no: payload.plate_no,
        vehicle_name: payload.vehicle_name,
        vehicle_type: payload.vehicle_type || '',
        brand_model: payload.brand_model || '',
        fuel_type: payload.fuel_type || '',
        current_mileage: payload.current_mileage || 0,
        status: payload.status || 'available',
        remark: payload.remark || '',
        created_at: now,
        updated_at: now
      };
      await appendRowObject(SHEET_NAMES.VEHICLES, item);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('CREATE_VEHICLE', 'Vehicle', 'เพิ่มรถราชการ: ' + item.vehicle_name, user);
      return res.json({ success: true, result: { success: true, data: item } });
    }
    if (methodName === 'updateVehicle') {
      const id = args[0];
      const payload = args[1];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const updates = {
        plate_no: payload.plate_no,
        vehicle_name: payload.vehicle_name,
        vehicle_type: payload.vehicle_type || '',
        brand_model: payload.brand_model || '',
        fuel_type: payload.fuel_type || '',
        current_mileage: payload.current_mileage || 0,
        status: payload.status || 'available',
        remark: payload.remark || '',
        updated_at: now
      };
      const updated = await updateObjectById(SHEET_NAMES.VEHICLES, 'vehicle_id', id, updates);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('UPDATE_VEHICLE', 'Vehicle', 'แก้ไขรถราชการ: ' + payload.vehicle_name, user);
      return res.json({ success: true, result: { success: true, data: updated } });
    }

    // 9. drivers RPC
    if (methodName === 'getDrivers') {
      requireAdmin(req.cookies.auth_token);
      const data = await getRowsAsObjects(SHEET_NAMES.DRIVERS);
      return res.json({ success: true, result: { success: true, data } });
    }
    if (methodName === 'createDriver') {
      const payload = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const item = {
        driver_id: crypto.randomUUID(),
        full_name: payload.full_name,
        phone: payload.phone || '',
        license_no: payload.license_no || '',
        status: payload.status || 'active',
        remark: payload.remark || '',
        created_at: now,
        updated_at: now
      };
      await appendRowObject(SHEET_NAMES.DRIVERS, item);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('CREATE_DRIVER', 'Driver', 'เพิ่มพนักงานขับรถ: ' + item.full_name, user);
      return res.json({ success: true, result: { success: true, data: item } });
    }
    if (methodName === 'updateDriver') {
      const id = args[0];
      const payload = args[1];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const updates = {
        full_name: payload.full_name,
        phone: payload.phone || '',
        license_no: payload.license_no || '',
        status: payload.status || 'active',
        remark: payload.remark || '',
        updated_at: now
      };
      const updated = await updateObjectById(SHEET_NAMES.DRIVERS, 'driver_id', id, updates);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('UPDATE_DRIVER', 'Driver', 'แก้ไขพนักงานขับรถ: ' + payload.full_name, user);
      return res.json({ success: true, result: { success: true, data: updated } });
    }

    // 10. departments RPC
    if (methodName === 'getDepartments') {
      requireAdmin(req.cookies.auth_token);
      const data = await getRowsAsObjects(SHEET_NAMES.DEPARTMENTS);
      return res.json({ success: true, result: { success: true, data } });
    }
    if (methodName === 'createDepartment') {
      const payload = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const item = {
        department_id: crypto.randomUUID(),
        department_name: payload.department_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        created_at: now,
        updated_at: now
      };
      await appendRowObject(SHEET_NAMES.DEPARTMENTS, item);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('CREATE_DEPARTMENT', 'Department', 'เพิ่มหน่วยงาน: ' + item.department_name, user);
      return res.json({ success: true, result: { success: true, data: item } });
    }
    if (methodName === 'updateDepartment') {
      const id = args[0];
      const payload = args[1];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const updates = {
        department_name: payload.department_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        updated_at: now
      };
      const updated = await updateObjectById(SHEET_NAMES.DEPARTMENTS, 'department_id', id, updates);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('UPDATE_DEPARTMENT', 'Department', 'แก้ไขหน่วยงาน: ' + payload.department_name, user);
      return res.json({ success: true, result: { success: true, data: updated } });
    }

    // 11. mission-types RPC
    if (methodName === 'getMissionTypes') {
      requireAdmin(req.cookies.auth_token);
      const data = await getRowsAsObjects(SHEET_NAMES.MISSION_TYPES);
      return res.json({ success: true, result: { success: true, data } });
    }
    if (methodName === 'createMissionType') {
      const payload = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const item = {
        mission_type_id: crypto.randomUUID(),
        mission_type_name: payload.mission_type_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        created_at: now,
        updated_at: now
      };
      await appendRowObject(SHEET_NAMES.MISSION_TYPES, item);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('CREATE_MISSION_TYPE', 'MissionType', 'เพิ่มประเภทภารกิจ: ' + item.mission_type_name, user);
      return res.json({ success: true, result: { success: true, data: item } });
    }
    if (methodName === 'updateMissionType') {
      const id = args[0];
      const payload = args[1];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const updates = {
        mission_type_name: payload.mission_type_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        updated_at: now
      };
      const updated = await updateObjectById(SHEET_NAMES.MISSION_TYPES, 'mission_type_id', id, updates);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('UPDATE_MISSION_TYPE', 'MissionType', 'แก้ไขประเภทภารกิจ: ' + payload.mission_type_name, user);
      return res.json({ success: true, result: { success: true, data: updated } });
    }

    // 12. destinations RPC
    if (methodName === 'getDestinations') {
      requireAdmin(req.cookies.auth_token);
      const data = await getRowsAsObjects(SHEET_NAMES.DESTINATIONS);
      return res.json({ success: true, result: { success: true, data } });
    }
    if (methodName === 'createDestination') {
      const payload = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const item = {
        destination_id: crypto.randomUUID(),
        destination_name: payload.destination_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        created_at: now,
        updated_at: now
      };
      await appendRowObject(SHEET_NAMES.DESTINATIONS, item);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('CREATE_DESTINATION', 'Destination', 'เพิ่มสถานที่ไป: ' + item.destination_name, user);
      return res.json({ success: true, result: { success: true, data: item } });
    }
    if (methodName === 'updateDestination') {
      const id = args[0];
      const payload = args[1];
      const user = requireAdmin(req.cookies.auth_token);
      const now = formatThaiDateTime(new Date());
      const updates = {
        destination_name: payload.destination_name,
        status: payload.status || 'active',
        remark: payload.remark || '',
        updated_at: now
      };
      const updated = await updateObjectById(SHEET_NAMES.DESTINATIONS, 'destination_id', id, updates);
      invalidateCache(SHEET_NAMES.VEHICLES);
      await writeAuditLog('UPDATE_DESTINATION', 'Destination', 'แก้ไขสถานที่ไป: ' + payload.destination_name, user);
      return res.json({ success: true, result: { success: true, data: updated } });
    }

    // 13. users RPC
    if (methodName === 'getUsers') {
      requireAuth(req.cookies.auth_token);
      const rows = await getRowsAsObjects(SHEET_NAMES.USERS);
      const users = rows.map(r => {
        const clean = { ...r };
        delete clean.password; // Do not return raw hash to client
        return clean;
      });
      return res.json({ success: true, result: { success: true, data: users } });
    }
    if (methodName === 'createUser') {
      const payload = args[0];
      const user = requireAuth(req.cookies.auth_token);
      if (user.role === 'manager' && payload.role === 'admin') {
        return res.json({ success: true, result: { success: false, message: 'สิทธิ์ล้มเหลว: คุณไม่มีสิทธิ์สร้างบัญชีผู้ดูแลระบบ (Admin)' } });
      }
      if (!/^[A-Za-z0-9]{3,40}$/.test(payload.username)) {
        return res.json({ success: true, result: { success: false, message: 'Username ต้องเป็นตัวอักษรภาษาอังกฤษ และตัวเลข 3-40 ตัวอักษรเท่านั้น (ไม่มีภาษาไทย ช่องว่าง หรือสัญลักษณ์พิเศษ)' } });
      }
      const now = formatThaiDateTime(new Date());
      const item = {
        user_id: crypto.randomUUID(),
        username: payload.username,
        password: hashPassword(payload.password),
        full_name: payload.full_name,
        role: payload.role || 'user',
        department: payload.department || '',
        status: payload.status || 'active',
        created_at: now,
        updated_at: now,
        last_login: '',
        account_id: payload.account_id || '',
        provider_id: payload.provider_id || '',
        hash_cid: payload.hash_cid || '',
        hcode: payload.hcode || '',
        provider_name: payload.provider_name || '',
        provider_last_login: '',
        allowed_pages: payload.allowed_pages || ''
      };
      await appendRowObject(SHEET_NAMES.USERS, item);
      invalidateCache(SHEET_NAMES.USERS);
      await writeAuditLog('CREATE_USER', 'User', 'เพิ่มผู้ใช้งาน: ' + item.username, user);
      const returned = { ...item };
      delete returned.password;
      return res.json({ success: true, result: { success: true, data: returned } });
    }
    if (methodName === 'updateUser') {
      const id = args[0];
      const payload = args[1];
      const user = requireAuth(req.cookies.auth_token);
      
      const rows = await getRowsAsObjects(SHEET_NAMES.USERS);
      const targetUser = rows.find(r => r.user_id === id);
      if (!targetUser) {
        return res.json({ success: true, result: { success: false, message: 'ไม่พบผู้ใช้งานที่ต้องการแก้ไข' } });
      }
      if (user.role === 'manager') {
        if (targetUser.role === 'admin') {
          return res.json({ success: true, result: { success: false, message: 'สิทธิ์ล้มเหลว: คุณไม่สามารถแก้ไขบัญชีผู้ดูแลระบบ (Admin)' } });
        }
        if (payload.role === 'admin') {
          return res.json({ success: true, result: { success: false, message: 'สิทธิ์ล้มเหลว: คุณไม่สามารถกำหนดระดับสิทธิ์ผู้อื่นเป็นผู้ดูแลระบบ (Admin)' } });
        }
      }

      if (!/^[A-Za-z0-9]{3,40}$/.test(payload.username)) {
        return res.json({ success: true, result: { success: false, message: 'Username ต้องเป็นตัวอักษรภาษาอังกฤษ และตัวเลข 3-40 ตัวอักษรเท่านั้น (ไม่มีภาษาไทย ช่องว่าง หรือสัญลักษณ์พิเศษ)' } });
      }
      const now = formatThaiDateTime(new Date());
      const updates = {
        username: payload.username,
        full_name: payload.full_name,
        role: payload.role || 'user',
        department: payload.department || '',
        status: payload.status || 'active',
        account_id: payload.account_id || '',
        provider_id: payload.provider_id || '',
        hash_cid: payload.hash_cid || '',
        hcode: payload.hcode || '',
        provider_name: payload.provider_name || '',
        allowed_pages: payload.allowed_pages || '',
        updated_at: now
      };
      if (payload.password) {
        updates.password = hashPassword(payload.password);
      }
      const updated = await updateObjectById(SHEET_NAMES.USERS, 'user_id', id, updates);
      invalidateCache(SHEET_NAMES.USERS);
      await writeAuditLog('UPDATE_USER', 'User', 'แก้ไขผู้ใช้งาน: ' + payload.username, user);
      const returned = { ...updated };
      delete returned.password;
      return res.json({ success: true, result: { success: true, data: returned } });
    }

    // 14. audit logs RPC
    if (methodName === 'getAuditLogs') {
      const filters = args[0] || {};
      requireAdmin(req.cookies.auth_token);
      
      const allRows = await getRowsAsObjects(SHEET_NAMES.AUDIT_LOGS);
      allRows.sort((a, b) => parseThaiDateTime(b.timestamp) - parseThaiDateTime(a.timestamp));
      
      let filtered = allRows;
      if (filters.action) filtered = filtered.filter(row => row.action === filters.action);
      if (filters.module) filtered = filtered.filter(row => row.module === filters.module);
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        filtered = filtered.filter(row => 
          String(row.detail || '').toLowerCase().includes(kw) ||
          String(row.username || '').toLowerCase().includes(kw) ||
          String(row.full_name || '').toLowerCase().includes(kw)
        );
      }

      const limit = Number(filters.limit) || 20;
      const offset = Number(filters.offset) || 0;
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            rows: filtered.slice(offset, offset + limit),
            totalRows: filtered.length,
            limit,
            offset,
            actions: [...new Set(allRows.map(r => r.action).filter(Boolean))].sort(),
            modules: [...new Set(allRows.map(r => r.module).filter(Boolean))].sort()
          }
        }
      });
    }

    // 15. cleanup audit logs
    if (methodName === 'cleanupAuditLogs') {
      const retentionDays = Number(args[0]) || 730;
      const user = requireAdmin(req.cookies.auth_token);
      
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle[SHEET_NAMES.AUDIT_LOGS];
      const rows = await sheet.getRows();
      
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      
      let deletedRows = 0;
      const cutoffTime = cutoff.getTime();
      for (const r of rows) {
        const timestamp = r.get('timestamp');
        if (timestamp) {
          const rowTime = parseThaiDateTime(timestamp);
          if (rowTime && rowTime < cutoffTime) {
            await r.delete();
            deletedRows++;
          }
        }
      }
      
      await writeAuditLog('CLEANUP_AUDIT', 'Audit', 'ล้าง Audit Log เก่ากว่า ' + retentionDays + ' วัน จำนวน ' + deletedRows + ' รายการ', user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: { deletedRows, retentionDays }
        }
      });
    }

    // 16. getRecentAdminToolAuditLogs
    if (methodName === 'getRecentAdminToolAuditLogs') {
      requireAdmin(req.cookies.auth_token);
      
      const actions = [
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
      
      const rows = await getRowsAsObjects(SHEET_NAMES.AUDIT_LOGS);
      const filtered = rows
        .filter(r => actions.includes(r.action))
        .sort((a, b) => parseThaiDateTime(b.timestamp) - parseThaiDateTime(a.timestamp))
        .slice(0, 5);
        
      return res.json({ success: true, result: { success: true, data: filtered } });
    }

    // 17. Database diagnostic endpoints
    if (methodName === 'getUsageDateTimeIssues') {
      requireAdmin(req.cookies.auth_token);
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      const issues = [];
      
      logs.forEach((row, index) => {
        const rowNumber = index + 2;
        if (!isValidIsoDate(row.usage_date)) {
          issues.push({ rowNumber, logId: row.log_id, field: 'usage_date', value: row.usage_date, message: 'วันที่ต้องเป็นรูปแบบ yyyy-MM-dd หรือ dd/MM/yyyy' });
        }
        if (!isValidTimeValue(row.start_time)) {
          issues.push({ rowNumber, logId: row.log_id, field: 'start_time', value: row.start_time, message: 'เวลาออกต้องเป็นรูปแบบ HH:mm' });
        }
        if (row.end_time && !isValidTimeValue(row.end_time)) {
          issues.push({ rowNumber, logId: row.log_id, field: 'end_time', value: row.end_time, message: 'เวลากลับต้องเป็นรูปแบบ HH:mm' });
        }
      });
      
      return res.json({ success: true, result: { success: true, data: { issueCount: issues.length, issues: issues.slice(0, 200) } } });
    }

    if (methodName === 'getUsageMasterDataIssues') {
      requireAdmin(req.cookies.auth_token);
      
      const [logs, vehicles, drivers, departments, missionTypes, destinations] = await Promise.all([
        getRowsAsObjects(SHEET_NAMES.USAGE_LOGS),
        getRowsAsObjects(SHEET_NAMES.VEHICLES),
        getRowsAsObjects(SHEET_NAMES.DRIVERS),
        getRowsAsObjects(SHEET_NAMES.DEPARTMENTS),
        getRowsAsObjects(SHEET_NAMES.MISSION_TYPES),
        getRowsAsObjects(SHEET_NAMES.DESTINATIONS)
      ]);
      
      const vehiclesMap = Object.fromEntries(vehicles.map(v => [v.vehicle_id, v]));
      const driversMap = Object.fromEntries(drivers.map(d => [d.driver_id, d]));
      const deptsMap = Object.fromEntries(departments.map(d => [d.department_name, d]));
      const missionsMap = Object.fromEntries(missionTypes.map(m => [m.mission_type_name, m]));
      const destsMap = Object.fromEntries(destinations.map(d => [d.destination_name, d]));
      
      const issues = [];
      logs.forEach((row, index) => {
        const rowNumber = index + 2;
        
        // Helper
        const check = (field, val, master, inactiveVal, missingMsg, inactiveMsg) => {
          if (!val) {
            issues.push({ rowNumber, logId: row.log_id, usageDate: row.usage_date, field, value: '', status: row.status, message: 'ไม่มีข้อมูลอ้างอิง' });
            return;
          }
          if (!master) {
            issues.push({ rowNumber, logId: row.log_id, usageDate: row.usage_date, field, value: val, status: row.status, message: missingMsg });
            return;
          }
          if (master.status === inactiveVal) {
            issues.push({ rowNumber, logId: row.log_id, usageDate: row.usage_date, field, value: val, status: row.status, message: inactiveMsg });
          }
        };
        
        check('vehicle_id', row.vehicle_id, vehiclesMap[row.vehicle_id], 'inactive', 'ไม่พบข้อมูลรถราชการ', 'รถราชการถูกปิดใช้งาน');
        check('driver_id', row.driver_id, driversMap[row.driver_id], 'inactive', 'ไม่พบข้อมูลพนักงานขับรถ', 'พนักงานขับรถถูกปิดใช้งาน');
        check('requester_department', row.requester_department, deptsMap[row.requester_department], 'inactive', 'ไม่พบข้อมูลหน่วยงาน', 'หน่วยงานถูกปิดใช้งาน');
        check('mission_type', row.mission_type, missionsMap[row.mission_type], 'inactive', 'ไม่พบข้อมูลประเภทภารกิจ', 'ประเภทภารกิจถูกปิดใช้งาน');
        check('destination', row.destination, destsMap[row.destination], 'inactive', 'ไม่พบข้อมูลสถานที่ไป', 'สถานที่ไปถูกปิดใช้งาน');
      });
      
      return res.json({ success: true, result: { success: true, data: { issueCount: issues.length, issues: issues.slice(0, 300) } } });
    }

    if (methodName === 'getUsageSummaryStatus') {
      requireAdmin(req.cookies.auth_token);
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      const summaries = await getRowsAsObjects(SHEET_NAMES.USAGE_MONTHLY_SUMMARY);
      
      const latestSummaryUpdate = summaries.reduce((latest, row) => 
        String(row.updated_at || '').localeCompare(String(latest || '')) > 0 ? row.updated_at : latest
      , '');

      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            usageRowCount: logs.length,
            summaryRowCount: summaries.length,
            shouldUseSummary: logs.length >= 1000,
            latestSummaryUpdate
          }
        }
      });
    }

    if (methodName === 'rebuildUsageMonthlySummary') {
      const user = requireAdmin(req.cookies.auth_token);
      
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      
      // Group logs by month, vehicle, driver, mission_type
      const groups = {};
      const updatedAt = formatThaiDateTime(new Date());
      
      logs.forEach(row => {
        if (row.status === 'cancelled') return;
        const month = String(row.usage_date || '').slice(0, 7);
        if (!month.match(/^\d{4}-\d{2}$/)) return;
        
        const key = `${month}|${row.vehicle_id}|${row.vehicle_name}|${row.driver_id}|${row.driver_name}|${row.mission_type}`;
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
          groups[key].total_km += Number(row.total_km || 0);
        }
      });
      
      const summaryRows = Object.values(groups).sort((a, b) => 
        a.summary_month.localeCompare(b.summary_month) || a.vehicle_name.localeCompare(b.vehicle_name)
      );
      
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle[SHEET_NAMES.USAGE_MONTHLY_SUMMARY];
      await sheet.clearContents();
      
      const headers = ['summary_month', 'vehicle_id', 'vehicle_name', 'driver_id', 'driver_name', 'mission_type', 'trip_count', 'completed_trip_count', 'total_km', 'updated_at'];
      await sheet.setHeaderRow(headers);
      
      if (summaryRows.length > 0) {
        await sheet.addRows(summaryRows);
      }
      
      await writeAuditLog('REBUILD_USAGE_SUMMARY', 'Report', 'สร้างสรุปรายเดือนจำนวน ' + summaryRows.length + ' แถว จากรายการใช้รถ ' + logs.length + ' รายการ', user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            rowCount: summaryRows.length,
            usageRowCount: logs.length,
            updatedAt
          }
        }
      });
    }

    if (methodName === 'archiveOldUsageLogs') {
      const retentionDays = Number(args[0]) || 365;
      const user = requireAdmin(req.cookies.auth_token);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            archivedRows: 0,
            retentionDays
          }
        }
      });
    }

    if (methodName === 'updateBuildDate') {
      const buildDate = args[0];
      const user = requireAdmin(req.cookies.auth_token);
      appConfig.buildDate = buildDate;
      await writeAuditLog('UPDATE_BUILD_DATE', 'System', 'อัปเดตวันที่ build เป็น ' + buildDate, user);
      return res.json({ success: true, result: { success: true, data: { buildDate } } });
    }

    // 18. Report RPCs
    if (methodName === 'getReportInitialData') {
      const filters = args[0] || {};
      requireAdmin(req.cookies.auth_token);
      
      const vehicles = await getRowsAsObjects(SHEET_NAMES.VEHICLES);
      const drivers = await getRowsAsObjects(SHEET_NAMES.DRIVERS);
      const missionTypes = await getRowsAsObjects(SHEET_NAMES.MISSION_TYPES);
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      
      // Filter logs
      let filtered = logs;
      if (filters.startDate) filtered = filtered.filter(row => row.usage_date >= filters.startDate);
      if (filters.endDate) filtered = filtered.filter(row => row.usage_date <= filters.endDate);
      if (filters.vehicleId) filtered = filtered.filter(row => row.vehicle_id === filters.vehicleId);
      if (filters.driverId) filtered = filtered.filter(row => row.driver_id === filters.driverId);
      if (filters.missionType) filtered = filtered.filter(row => row.mission_type === filters.missionType);
      if (filters.status) filtered = filtered.filter(row => row.status === filters.status);
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        filtered = filtered.filter(row => 
          String(row.vehicle_name || '').toLowerCase().includes(kw) ||
          String(row.driver_name || '').toLowerCase().includes(kw) ||
          String(row.destination || '').toLowerCase().includes(kw) ||
          String(row.requester_name || '').toLowerCase().includes(kw)
        );
      }
      
      filtered.sort((a, b) => b.usage_date.localeCompare(a.usage_date));
      
      const completedRows = filtered.filter(row => row.status === 'completed');
      const limit = Number(filters.limit) || 50;
      const offset = Number(filters.offset) || 0;
      
      const reportData = {
        rows: filtered.slice(offset, offset + limit),
        limit,
        offset,
        summary: {
          totalRows: filtered.length,
          completedTrips: completedRows.length,
          cancelledTrips: filtered.filter(row => row.status === 'cancelled').length,
          totalKm: completedRows.reduce((acc, row) => acc + Number(row.total_km || 0), 0),
          totalPassengers: completedRows.reduce((acc, row) => acc + Number(row.passenger_count || 0), 0)
        },
        performance: { dataMode: 'detail' }
      };

      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            vehicles: vehicles.filter(v => v.status === 'available'),
            drivers: drivers.filter(d => d.status === 'active'),
            missionTypes: missionTypes.filter(m => m.status === 'active'),
            report: reportData
          }
        }
      });
    }

    if (methodName === 'getReportData') {
      const filters = args[0] || {};
      requireAdmin(req.cookies.auth_token);
      
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      let filtered = logs;
      if (filters.startDate) filtered = filtered.filter(row => row.usage_date >= filters.startDate);
      if (filters.endDate) filtered = filtered.filter(row => row.usage_date <= filters.endDate);
      if (filters.vehicleId) filtered = filtered.filter(row => row.vehicle_id === filters.vehicleId);
      if (filters.driverId) filtered = filtered.filter(row => row.driver_id === filters.driverId);
      if (filters.missionType) filtered = filtered.filter(row => row.mission_type === filters.missionType);
      if (filters.status) filtered = filtered.filter(row => row.status === filters.status);
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        filtered = filtered.filter(row => 
          String(row.vehicle_name || '').toLowerCase().includes(kw) ||
          String(row.driver_name || '').toLowerCase().includes(kw) ||
          String(row.destination || '').toLowerCase().includes(kw) ||
          String(row.requester_name || '').toLowerCase().includes(kw)
        );
      }
      
      filtered.sort((a, b) => b.usage_date.localeCompare(a.usage_date));
      const completedRows = filtered.filter(row => row.status === 'completed');
      
      const limit = Number(filters.limit) || 50;
      const offset = Number(filters.offset) || 0;
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            rows: filtered.slice(offset, offset + limit),
            limit,
            offset,
            summary: {
              totalRows: filtered.length,
              completedTrips: completedRows.length,
              cancelledTrips: filtered.filter(row => row.status === 'cancelled').length,
              totalKm: completedRows.reduce((acc, row) => acc + Number(row.total_km || 0), 0),
              totalPassengers: completedRows.reduce((acc, row) => acc + Number(row.passenger_count || 0), 0)
            },
            performance: { dataMode: 'detail' }
          }
        }
      });
    }

    if (methodName === 'exportUsageCsv') {
      const filters = args[0] || {};
      const user = requireAdmin(req.cookies.auth_token);
      
      const logs = await getRowsAsObjects(SHEET_NAMES.USAGE_LOGS);
      let filtered = logs;
      if (filters.startDate) filtered = filtered.filter(row => row.usage_date >= filters.startDate);
      if (filters.endDate) filtered = filtered.filter(row => row.usage_date <= filters.endDate);
      if (filters.vehicleId) filtered = filtered.filter(row => row.vehicle_id === filters.vehicleId);
      if (filters.driverId) filtered = filtered.filter(row => row.driver_id === filters.driverId);
      if (filters.missionType) filtered = filtered.filter(row => row.mission_type === filters.missionType);
      if (filters.status) filtered = filtered.filter(row => row.status === filters.status);
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        filtered = filtered.filter(row => 
          String(row.vehicle_name || '').toLowerCase().includes(kw) ||
          String(row.driver_name || '').toLowerCase().includes(kw) ||
          String(row.destination || '').toLowerCase().includes(kw) ||
          String(row.requester_name || '').toLowerCase().includes(kw)
        );
      }
      
      filtered.sort((a, b) => b.usage_date.localeCompare(a.usage_date));
      
      const headers = ['วันที่', 'เวลาออก', 'เวลากลับ', 'รถ', 'ทะเบียน', 'พนักงานขับรถ', 'ประเภทภารกิจ', 'สถานที่ไป', 'ผู้ขอใช้รถ', 'หน่วยงาน', 'เลขไมล์ก่อนออก', 'เลขไมล์หลังกลับ', 'ระยะทางรวม (กม.)', 'จำนวนผู้โดยสาร', 'หมายเหตุ', 'สถานะ', 'ผู้บันทึก', 'วันที่บันทึก', 'วันที่แก้ไข', 'เหตุผลยกเลิก'];
      
      const toCsvLine = (values) => values.map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',');
      
      const csvRows = [headers].concat(filtered.map(row => [
        formatThaiDate(row.usage_date),
        row.start_time || '',
        row.end_time || '',
        row.vehicle_name || '',
        row.plate_no || '',
        row.driver_name || '',
        row.mission_type || '',
        row.destination || '',
        row.requester_name || '',
        row.requester_department || '',
        row.start_mileage || 0,
        row.end_mileage || '',
        row.total_km || 0,
        row.passenger_count || 0,
        row.note || '',
        row.status || '',
        row.created_by_name || '',
        row.created_at || '',
        row.updated_at || '',
        row.cancel_reason || ''
      ]));
      
      const csvContent = '\uFEFF' + csvRows.map(toCsvLine).join('\r\n');
      const fileName = `sph-vehicle-usage-report-${filters.startDate || 'all'}-to-${filters.endDate || 'all'}.csv`;
      
      await writeAuditLog('EXPORT_REPORT', 'Report', 'Export CSV รายงานการใช้รถ ' + filtered.length + ' รายการ', user);
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            fileName,
            mimeType: 'text/csv;charset=utf-8',
            content: csvContent,
            rowCount: filtered.length
          }
        }
      });
    }



    // --- PROVIDER AUTH RPC ENDPOINTS ---
    if (methodName === 'getProviderLoginUrl') {
      const env = (providerSettingsStore.env || 'UAT').toUpperCase();
      const healthUrl = env === 'PRD' ? 'https://moph.id.th' : 'https://uat-moph.id.th';

      // Build state
      const state = crypto.randomBytes(16).toString('hex');

      // 1. OAuth Redirect URL uses http://localhost:9998/login exactly
      const finalRedirectUri = (providerSettingsStore.redirectUri || '').trim() || 'http://localhost:9998/login';

      const url = `${healthUrl}/oauth/redirect?` + new URLSearchParams({
        client_id: providerSettingsStore.healthClientId || '019536a8-8cf1-733a-9152-19afda1fa199',
        redirect_uri: finalRedirectUri,
        response_type: 'code',
        state: state
      }).toString();

      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            url: url
          }
        }
      });
    }

    if (methodName === 'handleProviderCallback') {
      const code = String(args[0] || '').trim();
      const state = String(args[1] || '').trim();

      if (!code) {
        return res.json({ success: true, result: { success: false, message: 'ไม่พบ code จาก Health ID' } });
      }

      const env = (providerSettingsStore.env || 'UAT').toUpperCase();
      const healthUrl = env === 'PRD' ? 'https://moph.id.th' : 'https://uat-moph.id.th';
      const providerUrl = env === 'PRD' ? 'https://provider.id.th' : 'https://uat-provider.id.th';

      // Check if configured
      const isConfigured = providerSettingsStore.healthClientId && 
                           providerSettingsStore.healthClientSecret && 
                           providerSettingsStore.providerClientId && 
                           providerSettingsStore.providerSecretKey;

      let profile = null;
      let organization = null;

      if (isConfigured) {
        try {
          console.log(`Starting real OAuth Provider ID Login flow for environment ${env}...`);
          
          // ==================== ขั้นตอนที่ 1: การเชื่อมต่อกับ Health ID ====================
          console.log('Step 1: Fetching Health ID Access Token...');
          // POST token exchange redirect_uri must be exactly identical to the authorization request redirect_uri to prevent 422 mismatch error
          const postRedirectUri = (providerSettingsStore.redirectUri || '').trim() || 'http://localhost:9998/login';

          const step1Response = await fetch(`${healthUrl}/api/v1/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: code,
              redirect_uri: postRedirectUri,
              client_id: providerSettingsStore.healthClientId,
              client_secret: providerSettingsStore.healthClientSecret
            })
          });

          if (!step1Response.ok) {
            const errText = await step1Response.text();
            throw new Error(`Health ID Token exchange failed (Status ${step1Response.status}): ${errText}`);
          }

          const step1Data = await step1Response.json();
          const healthAccessToken = step1Data.access_token || (step1Data.data && step1Data.data.access_token);
          
          if (!healthAccessToken) {
            throw new Error('ไม่พบ access_token ใน response จาก Health ID');
          }

          // ==================== ขั้นตอนที่ 2: POST to provider.id.th/api/v1/services/token ====================
          console.log('Step 2: Fetching Provider ID Access Token...');
          const step2Response = await fetch(`${providerUrl}/api/v1/services/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              token: healthAccessToken,
              client_id: providerSettingsStore.providerClientId,
              secret_key: providerSettingsStore.providerSecretKey,
              token_by: 'Health ID'
            })
          });

          if (!step2Response.ok) {
            const errText = await step2Response.text();
            throw new Error(`Provider ID Token exchange failed (Status ${step2Response.status}): ${errText}`);
          }

          const step2Data = await step2Response.json();
          const providerAccessToken = step2Data.access_token || (step2Data.data && step2Data.data.access_token);

          if (!providerAccessToken) {
            throw new Error('ไม่พบ access_token ใน response จาก Provider ID Token endpoint');
          }

          // ==================== ขั้นตอนที่ 3: GET provider.id.th/api/v1/services/profile ====================
          console.log('Step 3: Fetching Provider Profile...');
          const step3Response = await fetch(`${providerUrl}/api/v1/services/profile`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${providerAccessToken}`,
              'client-id': providerSettingsStore.providerClientId,
              'secret-key': providerSettingsStore.providerSecretKey
            }
          });

          if (!step3Response.ok) {
            const errText = await step3Response.text();
            throw new Error(`Provider Profile fetch failed (Status ${step3Response.status}): ${errText}`);
          }

          const step3Data = await step3Response.json();
          const profileData = step3Data.data || step3Data;

          if (!profileData || !profileData.account_id) {
            throw new Error('ดึงข้อมูลโปรไฟล์ผู้ใช้สำเร็จ แต่ไม่พบ account_id หรือโครงสร้างข้อมูลโปรไฟล์ไม่ถูกต้อง');
          }

          profile = profileData;
          organization = (profileData.organizations && profileData.organizations[0]) || {};

        } catch (oauthError) {
          console.error('OAuth flow error:', oauthError);
          return res.json({
            success: true,
            result: {
              success: false,
              message: `การล็อกอินด้วย Provider ID ล้มเหลว: ${oauthError.message}`
            }
          });
        }
      } else {
        // Fallback / Mock mode if keys are not fully configured
        console.log('Provider ID credentials not fully set up. Using simulated fallback mode for local testing...');
        profile = {
          account_id: 'acc_mock_admin',
          provider_id: 'prov_mock_admin',
          hash_cid: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          name_th: 'ผู้ใช้ทดสอบระบบ (Provider ID)'
        };
        organization = {
          hcode: providerSettingsStore.allowedHcode || '10682',
          hname_th: 'โรงพยาบาลสารภี',
          position: 'เจ้าหน้าที่ไอที'
        };
      }

      // ==================== ขั้นตอนที่ 4: ตรวจสอบและเปรียบเทียบในฐานข้อมูล ====================
      const users = await getRowsAsObjects(SHEET_NAMES.USERS);
      
      // ค้นหาผู้ใช้จาก account_id หรือ provider_id ใน Sheet 'USERS'
      let user = users.find(u => 
        u.status === 'active' && 
        ((u.account_id && String(u.account_id).trim() === String(profile.account_id).trim()) || 
         (u.provider_id && String(u.provider_id).trim() === String(profile.provider_id).trim()))
      );

      const now = new Date().toISOString();

      if (!user) {
        // หากไม่พบผู้ใช้ที่ผูกบัญชีไว้ ให้ทำแบบต้นฉบับคือเพิ่มเข้าตาราง PROVIDER_LOGIN_PENDING (รายการรอผูกบัญชี)
        console.log(`User matching account_id '${profile.account_id}' not found. Registering pending connection request...`);
        
        const pendings = await getRowsAsObjects(SHEET_NAMES.PROVIDER_LOGIN_PENDING);
        const existingPending = pendings.find(p => p.account_id === profile.account_id || p.provider_id === profile.provider_id);

        if (existingPending) {
          // อัปเดตรายการรอผูกที่มีอยู่แล้ว
          await updateObjectById(SHEET_NAMES.PROVIDER_LOGIN_PENDING, 'pending_id', existingPending.pending_id, {
            account_id: profile.account_id,
            provider_id: profile.provider_id || '',
            hash_cid: profile.hash_cid || '',
            provider_name: profile.name_th || '',
            hcode: organization.hcode || '',
            hname_th: organization.hname_th || '',
            position: organization.position || '',
            status: existingPending.status === 'approved' ? 'approved' : 'pending',
            updated_at: now,
            last_seen_at: now
          });
        } else {
          // เพิ่มรายการรอผูกใหม่
          await appendRowObject(SHEET_NAMES.PROVIDER_LOGIN_PENDING, {
            pending_id: crypto.randomUUID(),
            account_id: profile.account_id,
            provider_id: profile.provider_id || '',
            hash_cid: profile.hash_cid || '',
            provider_name: profile.name_th || '',
            hcode: organization.hcode || '',
            hname_th: organization.hname_th || '',
            position: organization.position || '',
            status: 'pending',
            matched_user_id: '',
            note: '',
            created_at: now,
            updated_at: now,
            last_seen_at: now
          });
        }

        return res.json({
          success: true,
          result: {
            success: false,
            message: 'ไม่พบความเชื่อมโยงกับผู้ใช้งานในระบบระบบบันทึกการใช้รถราชการ ได้ส่งคำขอผูกผู้ใช้เข้าสู่ตารางรอผูกบัญชีเรียบร้อยแล้ว กรุณาแจ้งผู้ดูแลระบบเพื่ออนุมัติคำขอผูกผู้ใช้'
          }
        });
      }

      // หากพบคู่แมตช์ ให้อัปเดตข้อมูลความพบล่าสุดลงในแถวของผู้ใช้คนนั้น
      await updateObjectById(SHEET_NAMES.USERS, 'user_id', user.user_id, {
        account_id: profile.account_id || user.account_id || '',
        provider_id: profile.provider_id || user.provider_id || '',
        hash_cid: String(profile.hash_cid || user.hash_cid || '').toLowerCase(),
        hcode: organization.hcode || user.hcode || '',
        provider_name: profile.name_th || user.provider_name || '',
        provider_last_login: now,
        last_login: now,
        updated_at: now
      });

      // ดึงข้อมูลผู้ใช้ที่อัปเดตแล้ว
      const updatedUsers = await getRowsAsObjects(SHEET_NAMES.USERS);
      const updatedUser = updatedUsers.find(u => u.user_id === user.user_id);

      // สร้าง JWT session token
      const token = jwt.sign(
        { 
          user_id: updatedUser.user_id, 
          username: updatedUser.username, 
          role: updatedUser.role, 
          full_name: updatedUser.full_name,
          department: updatedUser.department || '',
          status: updatedUser.status || 'active',
          allowed_pages: updatedUser.allowed_pages || ''
        },
        getJwtSecret(),
        { expiresIn: '24h' }
      );

      // บันทึกคุ้กกี้เพื่อใช้ยืนยันหน้าเว็บ — SECURITY: include secure flags
      res.cookie('auth_token', token, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 
      });

      const targetPage = updatedUser.role === 'admin' ? 'dashboard' : 'usage-form';
      
      await writeAuditLog('LOGIN_PROVIDER_ID', 'ProviderAuth', 'เข้าสู่ระบบด้วย Provider ID สำเร็จ: ' + updatedUser.username, {
        user_id: updatedUser.user_id,
        username: updatedUser.username,
        role: updatedUser.role,
        full_name: updatedUser.full_name
      });

      return res.json({
        success: true,
        result: {
          success: true,
          message: 'เข้าสู่ระบบด้วย Provider ID สำเร็จ',
          data: {
            token: token,
            user: {
              user_id: updatedUser.user_id,
              username: updatedUser.username,
              role: updatedUser.role,
              full_name: updatedUser.full_name,
              department: updatedUser.department || ''
            },
            targetPage: targetPage,
            redirectUrl: '/' + targetPage
          }
        }
      });
    }

    if (methodName === 'getProviderAuthSettings') {
      requireAdmin(req.cookies.auth_token);
      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            env: providerSettingsStore.env || 'UAT',
            healthClientId: providerSettingsStore.healthClientId || '',
            healthClientSecretSet: !!providerSettingsStore.healthClientSecret,
            providerClientId: providerSettingsStore.providerClientId || '',
            providerSecretKeySet: !!providerSettingsStore.providerSecretKey,
            allowedHcode: providerSettingsStore.allowedHcode || '',
            redirectUri: providerSettingsStore.redirectUri || '',
            proxyUrl: providerSettingsStore.proxyUrl || '',
            configured: !!(providerSettingsStore.healthClientId && providerSettingsStore.healthClientSecret)
          }
        }
      });
    }

    if (methodName === 'saveProviderAuthSettings') {
      const payload = args[0] || {};
      const user = requireAdmin(req.cookies.auth_token);

      Object.assign(providerSettingsStore, {
        env: payload.env || 'UAT',
        allowedHcode: payload.allowedHcode || '',
        healthClientId: payload.healthClientId || '',
        providerClientId: payload.providerClientId || '',
        redirectUri: payload.redirectUri || '',
        proxyUrl: payload.proxyUrl || ''
      });

      if (payload.healthClientSecret) {
        providerSettingsStore.healthClientSecret = payload.healthClientSecret;
        providerSettingsStore.healthClientSecretSet = true;
      }
      if (payload.providerSecretKey) {
        providerSettingsStore.providerSecretKey = payload.providerSecretKey;
        providerSettingsStore.providerSecretKeySet = true;
      }

      providerSettingsStore.configured = !!(providerSettingsStore.healthClientId && providerSettingsStore.healthClientSecret);

      await writeAuditLog('SAVE_PROVIDER_AUTH_SETTINGS', 'ProviderAuth', 'บันทึกการตั้งค่า Provider ID ' + providerSettingsStore.env, user);

      return res.json({
        success: true,
        result: {
          success: true,
          message: 'บันทึกการตั้งค่าแล้ว',
          data: {
            env: providerSettingsStore.env,
            healthClientId: providerSettingsStore.healthClientId,
            healthClientSecretSet: !!providerSettingsStore.healthClientSecret,
            providerClientId: providerSettingsStore.providerClientId,
            providerSecretKeySet: !!providerSettingsStore.providerSecretKey,
            allowedHcode: providerSettingsStore.allowedHcode,
            redirectUri: providerSettingsStore.redirectUri,
            proxyUrl: providerSettingsStore.proxyUrl,
            configured: providerSettingsStore.configured
          }
        }
      });
    }

    if (methodName === 'getProviderAuthDiagnostics') {
      requireAdmin(req.cookies.auth_token);

      const healthUrl = providerSettingsStore.env === 'PRD' ? 'https://healthid.moph.go.th' : 'https://healthid-uat.moph.go.th';
      const providerUrl = providerSettingsStore.env === 'PRD' ? 'https://providerid.moph.go.th' : 'https://providerid-uat.moph.go.th';

      const proxyUrl = providerSettingsStore.proxyUrl || '';
      const fetchMode = proxyUrl
        ? 'proxy (' + proxyUrl + ')'
        : 'Direct Node Fetch API';

      return res.json({
        success: true,
        result: {
          success: true,
          data: {
            configured: providerSettingsStore.configured,
            env: providerSettingsStore.env,
            healthClientId: providerSettingsStore.healthClientId ? (providerSettingsStore.healthClientId.slice(0, 4) + '***' + providerSettingsStore.healthClientId.slice(-4)) : '-',
            healthClientSecretSet: !!providerSettingsStore.healthClientSecret,
            providerClientId: providerSettingsStore.providerClientId ? (providerSettingsStore.providerClientId.slice(0, 4) + '***' + providerSettingsStore.providerClientId.slice(-4)) : '-',
            providerSecretKeySet: !!providerSettingsStore.providerSecretKey,
            allowedHcode: providerSettingsStore.allowedHcode,
            redirectUri: providerSettingsStore.redirectUri,
            proxyUrl: proxyUrl || 'ไม่ได้ตั้งค่า (เรียก API ตรง)',
            defaultRedirectUri: 'http://localhost:9998/provider-callback',
            healthTokenEndpoint: healthUrl + '/api/v1/token',
            providerTokenEndpoint: providerUrl + '/api/v1/services/token',
            providerProfileEndpoint: providerUrl + '/api/v1/services/profile',
            fetchMode: fetchMode
          }
        }
      });
    }

    if (methodName === 'getPendingProviderLogins') {
      requireAdmin(req.cookies.auth_token);
      
      const rows = await getRowsAsObjects(SHEET_NAMES.PROVIDER_LOGIN_PENDING);
      const pending = rows.filter(r => r.status === 'pending');
      
      return res.json({
        success: true,
        result: {
          success: true,
          data: pending
        }
      });
    }

    if (methodName === 'approvePendingProviderLogin') {
      const pendingId = String(args[0] || '').trim();
      const userId = String(args[1] || '').trim();
      const currentUser = requireAdmin(req.cookies.auth_token);

      if (!pendingId || !userId) {
        return res.json({ success: true, result: { success: false, message: 'กรุณาเลือกรายการ Provider ID และผู้ใช้งาน' } });
      }

      const [pendings, users] = await Promise.all([
        getRowsAsObjects(SHEET_NAMES.PROVIDER_LOGIN_PENDING),
        getRowsAsObjects(SHEET_NAMES.USERS)
      ]);

      const pending = pendings.find(p => p.pending_id === pendingId);
      const user = users.find(u => u.user_id === userId);

      if (!pending) {
        return res.json({ success: true, result: { success: false, message: 'ไม่พบรายการ Provider ID ที่รอผูก' } });
      }

      if (!user) {
        return res.json({ success: true, result: { success: false, message: 'ไม่พบผู้ใช้งานที่ต้องการผูก' } });
      }

      // Update users sheet with the approved provider fields
      await updateObjectById(SHEET_NAMES.USERS, 'user_id', userId, {
        account_id: pending.account_id || '',
        provider_id: pending.provider_id || '',
        hash_cid: String(pending.hash_cid || '').toLowerCase(),
        hcode: pending.hcode || '',
        provider_name: pending.provider_name || '',
        updated_at: new Date().toISOString()
      });

      // Update provider_login_pending status
      await updateObjectById(SHEET_NAMES.PROVIDER_LOGIN_PENDING, 'pending_id', pendingId, {
        status: 'approved',
        matched_user_id: userId,
        updated_at: new Date().toISOString()
      });

      await writeAuditLog('APPROVE_PROVIDER_LOGIN', 'ProviderAuth', 'ผูก Provider ID กับผู้ใช้: ' + user.username, currentUser);

      return res.json({
        success: true,
        result: {
          success: true,
          message: 'ผูก Provider ID กับผู้ใช้งานเรียบร้อยแล้ว'
        }
      });
    }

    res.json({ error: `Method ${methodName} not implemented yet` });
  } catch (error) {
    console.error(`RPC error for ${methodName}:`, error);
    // SECURITY: Don't leak internal error details to client
    res.json({ error: 'เกิดข้อผิดพลาดในการประมวลผลคำสั่ง' });
  }
});


export default router;
