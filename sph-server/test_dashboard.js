import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { getMasterData } from './services/googleSheets.js';
import { parseThaiDateTime } from './utils/formatters.js';

dotenv.config();

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, serviceAccountAuth);

async function test() {
  await doc.loadInfo();
  const logsSheet = doc.sheetsByTitle['usage_logs'];
  const rawLogs = await logsSheet.getRows();
  let logs = rawLogs.map(r => r.toObject());
  
  // Sort newest first
  logs.sort((a, b) => parseThaiDateTime(b.created_at) - parseThaiDateTime(a.created_at));

  const countedLogs = logs.filter(l => l.status !== 'cancelled');
  console.log('Total Counted Logs:', countedLogs.length);
  if (countedLogs.length > 0) {
    console.log('Sample Log Date:', countedLogs[0].usage_date);
  }

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

  const trend = toDailyTrend(countedLogs);
  console.log('Daily Trend Result:', trend.slice(0, 5));
}

test().catch(console.error);
