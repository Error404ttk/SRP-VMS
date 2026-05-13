import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, serviceAccountAuth);

async function run() {
  await doc.loadInfo();
  const vehicles = await doc.sheetsByTitle['vehicles'].getRows();
  console.log('Total vehicles:', vehicles.length);
  if (vehicles.length > 0) {
    console.log('First vehicle:', vehicles[0].toObject());
  }
}
run().catch(console.error);
