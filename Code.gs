// ============================================================
//  ESG Car Wash Manager Terminal – Google Apps Script Backend
//  Code.gs
// ============================================================

// ── USER CONFIG ─────────────────────────────────────────────
const SPREADSHEET_ID = '1ufhpPY_J366QJ1qf5wEjpvlbHVORIZX59EBwbn3NZsc';
const MANAGER_PIN    = '2329';

// ── SALARY RULES ────────────────────────────────────────────
const MANAGER_BASE          = 175;   // GEL base daily salary
const VIP_BONUS_PER_WASH    = 10;    // GEL per VIP wash (incl. Talon VIPs)
const DAILY_BONUS_THRESHOLD = 1600;  // GEL revenue trigger
const DAILY_BONUS           = 50;    // GEL bonus when threshold reached
const WASHER_STANDARD_RATE  = 0.35;  // 35% for standard washes
const WASHER_VIP_RATE       = 0.40;  // 40% for VIP washes

// ── SHEET NAMES ─────────────────────────────────────────────
const SH = {
  DAILY       : 'Daily',
  SUMMARY     : 'Summary',
  DAILY_SALES : 'Daily_Sales',
  DATA        : 'Data',
  LISTS       : 'Lists'
};

// ── DEFAULT PRICE TABLE ─────────────────────────────────────
const PRICES = {
  'სედანი'   : { 'სტანდარტი': 30, 'VIP': 80,  'შიგნიდან': 15, 'გარედან': 15, 'ორივე': 30, 'სხვა': 0 },
  'ჯიპი'     : { 'სტანდარტი': 40, 'VIP': 120, 'შიგნიდან': 20, 'გარედან': 20, 'ორივე': 40, 'სხვა': 0 },
  'ჯიპი XL'  : { 'სტანდარტი': 50, 'VIP': 150, 'შიგნიდან': 25, 'გარედან': 25, 'ორივე': 50, 'სხვა': 0 }
};

// ============================================================
//  WEB APP ENTRY POINT
// ============================================================
function doGet(e) {
  _autoSetup();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ESG Manager Terminal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _autoSetup() {
  try {
    const ss = _getSS();
    if (!ss.getSheetByName(SH.DAILY)) setupSpreadsheet();
  } catch(e) {}
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
//  AUTH
// ============================================================
function login(managerName, pin) {
  if (!managerName || !managerName.trim()) {
    return { success: false, message: 'გთხოვთ შეიყვანოთ სახელი' };
  }
  if (pin !== MANAGER_PIN) {
    return { success: false, message: 'PIN კოდი არასწორია' };
  }
  return { success: true, managerName: managerName.trim() };
}

// ============================================================
//  LIST DATA
// ============================================================
function getListsData() {
  return {
    carTypes  : ['სედანი', 'ჯიპი', 'ჯიპი XL'],
    washTypes : ['სტანდარტი', 'VIP', 'შიგნიდან', 'გარედან', 'ორივე', 'სხვა'],
    boxes     : ['Box 1', 'Box 2', 'Box 3', 'Box 4'],
    payments  : ['Cash', 'Card', 'Talon'],
    prices    : PRICES
  };
}

// ============================================================
//  DASHBOARD STATS
// ============================================================
function getDashboardStats() {
  const entries = _getDailyEntries();
  if (!entries.length) {
    return { totalWashes: 0, cashTotal: 0, cardTotal: 0, talonCount: 0,
             talonValue: 0, vipCount: 0, totalRevenue: 0, managerVIPBonus: 0 };
  }

  let cashTotal = 0, cardTotal = 0, talonCount = 0, talonValue = 0, vipCount = 0,
      managerVIPBonus = 0;

  entries.forEach(r => {
    const cost    = parseFloat(r[3]) || 0;
    const payment = r[4];
    const isVIP   = r[2] === 'VIP';
    if (isVIP) { vipCount++; managerVIPBonus += VIP_BONUS_PER_WASH; }
    if (payment === 'Cash')  cashTotal  += cost;
    if (payment === 'Card')  cardTotal  += cost;
    if (payment === 'Talon') { talonCount++; talonValue += cost; }
  });

  const totalRevenue = cashTotal + cardTotal + talonValue;
  const projBonus    = totalRevenue >= DAILY_BONUS_THRESHOLD ? DAILY_BONUS : 0;

  return { totalWashes: entries.length, cashTotal, cardTotal, talonCount,
           talonValue, vipCount, totalRevenue, managerVIPBonus,
           projectedManagerSalary: MANAGER_BASE + managerVIPBonus + projBonus,
           bonusReached: totalRevenue >= DAILY_BONUS_THRESHOLD };
}

// ============================================================
//  ADD ENTRY
// ============================================================
function addEntry(data) {
  try {
    const sheet = _getSheet(SH.DAILY);
    _ensureHeader(sheet, ['Plate Number','Car Type','Wash Type','Cost',
                          'Payment Type','Box','Timestamp','Notes']);
    sheet.appendRow([
      (data.plateNumber || '').toUpperCase(),
      data.carType,
      data.washType,
      parseFloat(data.cost) || 0,
      data.paymentType,
      data.box,
      new Date(),
      data.loyaltyCode || ''
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============================================================
//  GET RECENT ENTRIES (last N rows)
// ============================================================
function getRecentEntries(n) {
  n = n || 10;
  const entries = _getDailyEntries();
  const slice   = entries.slice(-n);
  const offset  = entries.length - slice.length; // 0-based index offset

  return slice.map((row, i) => ({
    rowIndex    : offset + i,           // 0-based among data rows
    plateNumber : row[0] || '',
    carType     : row[1] || '',
    washType    : row[2] || '',
    cost        : parseFloat(row[3]) || 0,
    paymentType : row[4] || '',
    box         : row[5] || '',
    timestamp   : row[6] ? Utilities.formatDate(new Date(row[6]),
                    Session.getScriptTimeZone(), 'HH:mm') : '',
    notes       : row[7] || ''
  }));
}

// ============================================================
//  UPDATE (EDIT) ENTRY
// ============================================================
function updateEntry(rowIndex, data) {
  try {
    const sheet   = _getSheet(SH.DAILY);
    const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-based
    sheet.getRange(sheetRow, 1, 1, 8).setValues([[
      (data.plateNumber || '').toUpperCase(),
      data.carType,
      data.washType,
      parseFloat(data.cost) || 0,
      data.paymentType,
      data.box,
      sheet.getRange(sheetRow, 7).getValue(), // preserve timestamp
      data.loyaltyCode || ''
    ]]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============================================================
//  INVENTORY SALE
// ============================================================
function addInventorySale(data) {
  try {
    const sheet = _getSheet(SH.DAILY_SALES);
    _ensureHeader(sheet, ['Product Name','Quantity','Product ID','Status','Timeline']);
    sheet.appendRow([
      data.productName,
      parseFloat(data.quantity) || 1,
      data.productId || '',
      'Sold',
      new Date()
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============================================================
//  CLOSE SHIFT
// ============================================================
function closeShift(managerName) {
  try {
    const entries = _getDailyEntries();
    if (!entries.length) return { success: false, message: 'დღის ჩანაწერები არ მოიძებნა' };

    const today   = new Date();
    const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd/MM/yyyy');

    // ── Aggregate ───────────────────────────────────────────
    const byType = {
      'სედანი'  : { count:0, cash:0, card:0, talon:0 },
      'ჯიპი'    : { count:0, cash:0, card:0, talon:0 },
      'ჯიპი XL' : { count:0, cash:0, card:0, talon:0 },
      'VIP'     : { count:0, cash:0, card:0, talon:0 }
    };
    const boxSalaries = { 'Box 1':0, 'Box 2':0, 'Box 3':0, 'Box 4':0 };
    let cashTotal = 0, cardTotal = 0, talonValue = 0, talonCount = 0;
    let washerTotal = 0, managerVIPBonus = 0;

    entries.forEach(row => {
      const carType  = row[1] || '';
      const washType = row[2] || '';
      const cost     = parseFloat(row[3]) || 0;
      const payment  = row[4] || '';
      const box      = row[5] || '';
      const isVIP    = washType === 'VIP';

      // Salary always on full cost (Talon included)
      const rate          = isVIP ? WASHER_VIP_RATE : WASHER_STANDARD_RATE;
      const washerEarning = cost * rate;
      washerTotal        += washerEarning;
      if (boxSalaries[box] !== undefined) boxSalaries[box] += washerEarning;

      if (isVIP) { managerVIPBonus += VIP_BONUS_PER_WASH; }

      // Revenue counting
      if (payment === 'Cash')  cashTotal  += cost;
      if (payment === 'Card')  cardTotal  += cost;
      if (payment === 'Talon') { talonValue += cost; talonCount++; }

      // Per-type breakdown (VIP tracked separately AND in car type)
      const typeKey = byType[carType] ? carType : null;
      if (typeKey) {
        byType[typeKey].count++;
        if (payment === 'Cash')  byType[typeKey].cash  += cost;
        if (payment === 'Card')  byType[typeKey].card  += cost;
        if (payment === 'Talon') byType[typeKey].talon += cost;
      }
      if (isVIP) {
        byType['VIP'].count++;
        if (payment === 'Cash')  byType['VIP'].cash  += cost;
        if (payment === 'Card')  byType['VIP'].card  += cost;
        if (payment === 'Talon') byType['VIP'].talon += cost;
      }
    });

    const totalRevenue  = cashTotal + cardTotal + talonValue;
    const dailyBonus    = totalRevenue >= DAILY_BONUS_THRESHOLD ? DAILY_BONUS : 0;
    const managerTotal  = MANAGER_BASE + managerVIPBonus + dailyBonus;
    const totalExpenses = washerTotal + managerTotal;
    const remainCash    = cashTotal - (totalExpenses > cashTotal ? cashTotal : totalExpenses);
    const remainCashCard = cashTotal + cardTotal - totalExpenses;

    // ── Write Summary Sheet ──────────────────────────────────
    const ss      = _getSS();
    const sumSheet = ss.getSheetByName(SH.SUMMARY);
    sumSheet.clearContents();

    const sd = [
      ['ESG Car Wash – ' + managerName + ' – ' + dateStr],
      [],
      ['შემოსავალი'],
      ['', 'რაოდენობა', 'ქეში', 'ბარათი', 'ტალონი', 'სულ თანხა'],
      ['სედანი',   byType['სედანი'].count,  byType['სედანი'].cash,  byType['სედანი'].card,  byType['სედანი'].talon,  byType['სედანი'].cash+byType['სედანი'].card+byType['სედანი'].talon],
      ['ჯიპი',     byType['ჯიპი'].count,    byType['ჯიპი'].cash,    byType['ჯიპი'].card,    byType['ჯიპი'].talon,    byType['ჯიპი'].cash+byType['ჯიპი'].card+byType['ჯიპი'].talon],
      ['ჯიპი XL',  byType['ჯიპი XL'].count, byType['ჯიპი XL'].cash, byType['ჯიპი XL'].card, byType['ჯიპი XL'].talon, byType['ჯიპი XL'].cash+byType['ჯიპი XL'].card+byType['ჯიპი XL'].talon],
      ['VIP',      byType['VIP'].count,     byType['VIP'].cash,     byType['VIP'].card,     byType['VIP'].talon,     byType['VIP'].cash+byType['VIP'].card+byType['VIP'].talon],
      ['სულ',      entries.length,          cashTotal,              cardTotal,              talonValue,              totalRevenue],
      [],
      ['ხარჯები'],
      ['', 'ხელფასები', 'VIP ბონუსი', 'სრული ხელფასი'],
      ['მრეცხავები'],
      ['Box 1', boxSalaries['Box 1'].toFixed(2)],
      ['Box 2', boxSalaries['Box 2'].toFixed(2)],
      ['Box 3', boxSalaries['Box 3'].toFixed(2)],
      ['Box 4', boxSalaries['Box 4'].toFixed(2)],
      ['მენეჯერი (' + managerName + ')', MANAGER_BASE, managerVIPBonus + dailyBonus, managerTotal],
      ['ტალონი', talonCount + ' ერთ.'],
      ['მრეცხავები სულ', washerTotal.toFixed(2)],
      ['ჯამი ხარჯები', totalExpenses.toFixed(2)],
      [],
      [],
      ['დარჩენილი'],
      ['Cash', remainCash.toFixed(2)],
      ['Cash + ბარათი', remainCashCard.toFixed(2)]
    ];

    sumSheet.getRange(1, 1, sd.length, 6).setValues(sd.map(r => {
      while (r.length < 6) r.push('');
      return r;
    }));
    sumSheet.getRange('A1').setFontWeight('bold').setFontSize(13);

    // ── Archive to Month Sheet ───────────────────────────────
    const monthName  = Utilities.formatDate(today, Session.getScriptTimeZone(), 'MMMM_yyyy');
    let   monthSheet = ss.getSheetByName(monthName);
    if (!monthSheet) {
      monthSheet = ss.insertSheet(monthName);
      monthSheet.appendRow(['Date','Plate Number','Car Type','Wash Type',
                            'Cost','Payment','Box','Notes']);
    }
    entries.forEach(row => {
      monthSheet.appendRow([
        dateStr, row[0], row[1], row[2],
        parseFloat(row[3]) || 0, row[4], row[5], row[7] || ''
      ]);
    });

    // ── Clear Daily Sheet ────────────────────────────────────
    const dailySheet = _getSheet(SH.DAILY);
    if (dailySheet.getLastRow() > 1) {
      dailySheet.deleteRows(2, dailySheet.getLastRow() - 1);
    }
    // Also clear Daily_Sales
    const salesSheet = _getSheet(SH.DAILY_SALES);
    if (salesSheet.getLastRow() > 1) {
      salesSheet.deleteRows(2, salesSheet.getLastRow() - 1);
    }

    return {
      success: true,
      summary: {
        date           : dateStr,
        totalWashes    : entries.length,
        totalRevenue,
        cashTotal,
        cardTotal,
        talonValue,
        talonCount,
        vipCount       : byType['VIP'].count,
        washerTotal,
        managerBase    : MANAGER_BASE,
        managerVIPBonus,
        dailyBonus,
        managerTotal,
        totalExpenses,
        remainCash,
        remainCashCard,
        bonusReached   : dailyBonus > 0,
        archivedTo     : monthName
      }
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============================================================
//  CREATE + SETUP – called once by clasp run to bootstrap
// ============================================================
function createAndSetupSheet() {
  const ss  = SpreadsheetApp.create('ESG Car Wash Manager – Data');
  const id  = ss.getId();
  const url = ss.getUrl();

  ss.getSheets()[0].setName('Daily');
  ['Summary','Daily_Sales','Data','Lists'].forEach(name => ss.insertSheet(name));

  const daily = ss.getSheetByName('Daily');
  daily.appendRow(['Plate Number','Car Type','Wash Type','Cost','Payment Type','Box','Timestamp','Notes']);
  daily.getRange('1:1').setFontWeight('bold');

  const sales = ss.getSheetByName('Daily_Sales');
  sales.appendRow(['Product Name','Quantity','Product ID','Status','Timeline']);
  sales.getRange('1:1').setFontWeight('bold');

  const lists = ss.getSheetByName('Lists');
  lists.getRange('A1:F1').setValues([['Car Types','General Wash Types','Boxes','Payments','Map Car Type','Map Wash Type']]);
  lists.getRange('A2:D6').setValues([
    ['სედანი',  'სტანდარტი', 'Box 1', 'Cash', '', ''],
    ['ჯიპი',   'VIP',       'Box 2', 'Card',  '', ''],
    ['ჯიპი XL','შიგნიდან',  'Box 3', 'Talon', '', ''],
    ['',        'გარედან',  'Box 4', '', '', ''],
    ['',        'ორივე',    '', '',     '', '']
  ]);

  Logger.log('SPREADSHEET_ID=' + id);
  return { id: id, url: url };
}

// ============================================================
//  SETUP – run once to prepare sheets
// ============================================================
function setupSpreadsheet() {
  const ss     = _getSS();
  const needed = [SH.DAILY, SH.SUMMARY, SH.DAILY_SALES, SH.DATA, SH.LISTS];
  needed.forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  const daily = ss.getSheetByName(SH.DAILY);
  if (daily.getLastRow() === 0) {
    daily.appendRow(['Plate Number','Car Type','Wash Type','Cost',
                     'Payment Type','Box','Timestamp','Notes']);
    daily.getRange('1:1').setFontWeight('bold');
  }

  const lists = ss.getSheetByName(SH.LISTS);
  if (lists.getLastRow() === 0) {
    lists.getRange('A1:F1').setValues([['Car Types','General Wash Types','Boxes','Payments','Map Car Type','Map Wash Type']]);
    lists.getRange('A2:D6').setValues([
      ['სედანი',  'სტანდარტი', 'Box 1', 'Cash'],
      ['ჯიპი',   'VIP',       'Box 2', 'Card'],
      ['ჯიპი XL','შიგნიდან',  'Box 3', 'Talon'],
      ['',        'გარედან',  'Box 4', ''],
      ['',        'ორივე',    '',      '']
    ]);
  }

  Logger.log('Setup complete. Spreadsheet ID: ' + ss.getId());
  return ss.getId();
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================
function _getSS() {
  return SPREADSHEET_ID && SPREADSHEET_ID !== 'YOUR_SPREADSHEET_ID_HERE'
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function _getSheet(name) {
  const ss    = _getSS();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + '. Run setupSpreadsheet() first.');
  return sheet;
}

function _ensureHeader(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange('1:1').setFontWeight('bold');
  }
}

function _getDailyEntries() {
  const sheet = _getSheet(SH.DAILY);
  const last  = sheet.getLastRow();
  if (last <= 1) return [];
  return sheet.getRange(2, 1, last - 1, 8).getValues().filter(r => r[0]);
}
