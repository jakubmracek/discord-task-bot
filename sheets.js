// sheets.js – veškerá komunikace s Google Sheets
const { google } = require('googleapis');

// ── Autentizace přes Service Account ─────────────────────────────────────────
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Struktura sloupců v Sheetu (pořadí musí odpovídat hlavičkám)
// A    B       C              D               E         F         G      H       I         J          K
// ID | Název | Přiřazeno | Discord ID | Deadline | Priorita | Stav | Oblast | Zadal | Zadáno dne | Link
const COLUMNS = {
  ID: 0, TITLE: 1, ASSIGNEE_NAME: 2, ASSIGNEE_ID: 3,
  DEADLINE: 4, PRIORITY: 5, STATUS: 6, AREA: 7,
  CREATED_BY: 8, CREATED_AT: 9, MESSAGE_LINK: 10,
};

// ── Inicializace: vytvoří hlavičku pokud Sheet je prázdný ─────────────────────
async function initSheet() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `${process.env.SHEET_NAME}!A1:K1`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          'ID', 'Název', 'Přiřazeno', 'Discord ID',
          'Deadline', 'Priorita', 'Stav', 'Oblast',
          'Zadal', 'Zadáno dne', 'Link na zprávu',
        ]],
      },
    });
    console.log('✅ Sheet inicializován – hlavička přidána.');
  }
}

// ── Přidání nového úkolu ──────────────────────────────────────────────────────
async function appendTask(task) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Získáme aktuální počet řádků pro generování ID
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:A`,
  });
  const rowCount = res.data.values ? res.data.values.length : 1;
  const taskId = rowCount; // řádek 1 = hlavička, první úkol = ID 1

  const row = [
    taskId,
    task.title,
    task.assigneeName,
    task.assigneeId,
    task.deadline,           // formát YYYY-MM-DD
    task.priority,
    'todo',                  // výchozí stav
    task.area,
    task.createdByName,
    new Date().toLocaleDateString('cs-CZ'),
    task.messageLink || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return taskId;
}

// ── Změna stavu úkolu ─────────────────────────────────────────────────────────
async function updateTaskStatus(taskId, newStatus) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => String(r[COLUMNS.ID]) === String(taskId));

  if (rowIndex === -1) return null;

  const sheetRow = rowIndex + 1; // Sheets jsou 1-indexed
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!G${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newStatus]] },
  });

  return rows[rowIndex]; // vrátíme původní řádek pro notifikace
}

// ── Úkoly konkrétního uživatele ───────────────────────────────────────────────
async function getTasksByUser(discordId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
  });

  const rows = res.data.values || [];
  return rows
    .slice(1) // přeskočit hlavičku
    .filter(r => r[COLUMNS.ASSIGNEE_ID] === discordId && r[COLUMNS.STATUS] !== 'done')
    .map(rowToTask);
}

// ── Všechny úkoly s blížícím se deadlinem (zítra) ────────────────────────────
async function getTasksDueTomorrow() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
  });

  const rows = res.data.values || [];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

  return rows
    .slice(1)
    .filter(r => r[COLUMNS.DEADLINE] === tomorrowStr && r[COLUMNS.STATUS] !== 'done')
    .map(rowToTask);
}

// ── Úkoly podle oblasti ───────────────────────────────────────────────────────
async function getTasksByArea(area) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
  });

  const rows = res.data.values || [];
  return rows
    .slice(1)
    .filter(r => (!area || r[COLUMNS.AREA] === area) && r[COLUMNS.STATUS] !== 'done')
    .map(rowToTask);
}

// ── Pomocná funkce: řádek → objekt ───────────────────────────────────────────
function rowToTask(row) {
  return {
    id: row[COLUMNS.ID],
    title: row[COLUMNS.TITLE],
    assigneeName: row[COLUMNS.ASSIGNEE_NAME],
    assigneeId: row[COLUMNS.ASSIGNEE_ID],
    deadline: row[COLUMNS.DEADLINE],
    priority: row[COLUMNS.PRIORITY],
    status: row[COLUMNS.STATUS],
    area: row[COLUMNS.AREA],
    createdBy: row[COLUMNS.CREATED_BY],
    createdAt: row[COLUMNS.CREATED_AT],
    messageLink: row[COLUMNS.MESSAGE_LINK],
  };
}

// ── Uložení Discord message ID zpět do Sheetu ────────────────────────────────
async function updateTaskMessageId(taskId, messageId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:A`,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => String(r[0]) === String(taskId));
  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!K${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[messageId]] },
  });
}

// ── Najít úkol podle Discord message ID (sloupec K) ───────────────────────────
async function getTaskByMessageId(messageId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:K`,
  });

  const rows = res.data.values || [];
  const row = rows.slice(1).find(r => r[COLUMNS.MESSAGE_LINK] === messageId);
  return row || null;
}

module.exports = {
  initSheet,
  appendTask,
  updateTaskStatus,
  getTasksByUser,
  getTasksDueTomorrow,
  getTasksByArea,
  updateTaskMessageId,
  getTaskByMessageId,
};
