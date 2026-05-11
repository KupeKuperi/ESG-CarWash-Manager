// ============================================================
//  ESG Car Wash Manager Terminal – Google Apps Script Backend
//  Code.gs – v3 (Box pay, Drive folders, Pending, Live View)
// ============================================================

// ── USER CONFIG ─────────────────────────────────────────────
const SPREADSHEET_ID   = '1ufhpPY_J366QJ1qf5wEjpvlbHVORIZX59EBwbn3NZsc';
const MANAGER_PIN      = '2329';
const ROOT_FOLDER_NAME = 'ESG CarWash';

// ── SALARY RULES ────────────────────────────────────────────
const MANAGER_BASE          = 175;
const VIP_BONUS_PER_WASH    = 10;
const DAILY_BONUS_THRESHOLD = 1600;
const DAILY_BONUS           = 50;
const WASHER_STANDARD_RATE  = 0.35;
const WASHER_VIP_RATE       = 0.40;

// ── SHEET NAMES ─────────────────────────────────────────────
const SH = {
  DAILY       : 'Daily',
  SUMMARY     : 'Summary',
  DAILY_SALES : 'Daily_Sales',
  DATA        : 'Data',
  LISTS       : 'Lists'
};

// ── DAILY SHEET COLUMNS (0-based) ───────────────────────────
const COL = {
  PLATE    : 0,
  CAR_TYPE : 1,
  WASH_TYPE: 2,
  COST     : 3,
  PAYMENT  : 4,
  BOX      : 5,
  TIMESTAMP: 6,
  NOTES    : 7,
  STATUS   : 8   // 'Paid' | 'Pending'
};

// ── DEFAULT PRICE TABLE ─────────────────────────────────────
const PRICES = {
  'სედანი'  : { 'სტანდარტი':30, 'VIP':80,  'შიგნიდან':15, 'გარედან':15, 'ორივე':30, 'სხვა':0 },
  'ჯიპი'    : { 'სტანდარტი':40, 'VIP':120, 'შიგნიდან':20, 'გარედან':20, 'ორივე':40, 'სხვა':0 },
  'ჯიპი XL' : { 'სტანდარტი':50, 'VIP':150, 'შიგნიდან':25, 'გარედან':25, 'ორივე':50, 'სხვა':0 }
};

const BOXES = ['Box 1','Box 2','Box 3','Box 4'];

// ============================================================
//  WEB APP ENTRY POINT
// ============================================================
function doGet(e) {
  _autoSetup();
  const page = (e && e.parameter && e.parameter.page) || 'app';
  if (page === 'live') {
    return HtmlService.createTemplateFromFile('live')
      .evaluate()
      .setTitle('ESG Live Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ESG Manager Terminal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function _autoSetup() {
  try { if (!_getSS().getSheetByName(SH.DAILY)) setupSpreadsheet(); } catch(e) {}
}

// ── Expose the deployed Web App URL so the UI can build the live link ──
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ── Run this ONCE from the Apps Script editor to grant Drive access ──
function authorizeAll() {
  // Touch every service so Google shows the full permission dialog
  SpreadsheetApp.openById(SPREADSHEET_ID);
  DriveApp.getRootFolder();
  PropertiesService.getScriptProperties().getProperty('test');
  Logger.log('Authorization complete. All scopes granted.');
  return 'OK';
}

// ============================================================
//  AUTH & SESSION
// ============================================================
function login(managerName, pin) {
  if (!managerName || !managerName.trim())
    return { success:false, message:'გთხოვთ შეიყვანოთ სახელი' };
  if (pin !== MANAGER_PIN)
    return { success:false, message:'PIN კოდი არასწორია' };
  const props = PropertiesService.getScriptProperties();
  props.setProperty('currentManager', managerName.trim());
  props.setProperty('shiftStart', new Date().toISOString());
  return { success:true, managerName:managerName.trim() };
}

// ============================================================
//  LIST DATA
// ============================================================
function getListsData() {
  return {
    carTypes  : ['სედანი', 'ჯიპი', 'ჯიპი XL'],
    washTypes : ['სტანდარტი', 'VIP', 'შიგნიდან', 'გარედან', 'ორივე', 'სხვა'],
    boxes     : BOXES,
    payments  : ['Cash', 'Card', 'Talon'],
    prices    : PRICES
  };
}

// ============================================================
//  DASHBOARD STATS  (box earnings + pending)
// ============================================================
function getDashboardStats() {
  const entries = _getDailyEntries();

  const boxData = {};
  BOXES.forEach(b => { boxData[b] = { salary:0, washes:0 }; });

  let cashTotal=0, cardTotal=0, talonCount=0, talonValue=0;
  let vipCount=0, managerVIPBonus=0, pendingCount=0, pendingValue=0;

  entries.forEach(r => {
    const cost      = parseFloat(r[COL.COST])    || 0;
    const payment   = r[COL.PAYMENT]  || '';
    const washType  = r[COL.WASH_TYPE]|| '';
    const box       = r[COL.BOX]      || '';
    const isPending = (r[COL.STATUS]  || 'Paid') === 'Pending';
    const isVIP     = washType === 'VIP';

    // Washer salary on ALL washes (car was washed regardless of payment)
    const earning = cost * (isVIP ? WASHER_VIP_RATE : WASHER_STANDARD_RATE);
    if (boxData[box]) { boxData[box].salary += earning; boxData[box].washes++; }

    if (isVIP) { vipCount++; managerVIPBonus += VIP_BONUS_PER_WASH; }

    if (isPending) { pendingCount++; pendingValue += cost; }
    else {
      if (payment==='Cash')  cashTotal  += cost;
      if (payment==='Card')  cardTotal  += cost;
      if (payment==='Talon') { talonCount++; talonValue += cost; }
    }
  });

  const totalRevenue = cashTotal + cardTotal + talonValue;
  const projBonus    = totalRevenue >= DAILY_BONUS_THRESHOLD ? DAILY_BONUS : 0;

  return {
    totalWashes  : entries.length,
    pendingCount, pendingValue,
    cashTotal, cardTotal, talonCount, talonValue,
    vipCount, totalRevenue, managerVIPBonus,
    projectedManagerSalary: MANAGER_BASE + managerVIPBonus + projBonus,
    bonusReached : totalRevenue >= DAILY_BONUS_THRESHOLD,
    boxData
  };
}

// ============================================================
//  LIVE VIEW DATA
// ============================================================
function getLiveViewData() {
  const stats  = getDashboardStats();
  const props  = PropertiesService.getScriptProperties().getProperties();
  const recent = getRecentEntries(6);
  return {
    stats,
    managerName  : props.currentManager || '—',
    shiftStart   : props.shiftStart     || null,
    recentEntries: recent,
    serverTime   : new Date().toISOString()
  };
}

// ============================================================
//  ADD ENTRY
// ============================================================
function addEntry(data) {
  try {
    const sheet = _getSheet(SH.DAILY);
    _ensureHeader(sheet, ['Plate Number','Car Type','Wash Type','Cost',
                          'Payment Type','Box','Timestamp','Notes','Status']);
    const isPending = data.status === 'Pending';
    sheet.appendRow([
      (data.plateNumber || '').toUpperCase(),
      data.carType,
      data.washType,
      parseFloat(data.cost) || 0,
      isPending ? 'Pending' : (data.paymentType || 'Cash'),
      data.box,
      new Date(),
      data.loyaltyCode || '',
      isPending ? 'Pending' : 'Paid'
    ]);
    return { success:true };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  GET RECENT ENTRIES
// ============================================================
function getRecentEntries(n) {
  n = n || 10;
  const entries = _getDailyEntries();
  const slice   = entries.slice(-n);
  const offset  = entries.length - slice.length;
  return slice.map((row, i) => ({
    rowIndex    : offset + i,
    plateNumber : row[COL.PLATE]    || '',
    carType     : row[COL.CAR_TYPE] || '',
    washType    : row[COL.WASH_TYPE]|| '',
    cost        : parseFloat(row[COL.COST]) || 0,
    paymentType : row[COL.PAYMENT]  || '',
    box         : row[COL.BOX]      || '',
    timestamp   : row[COL.TIMESTAMP]
      ? Utilities.formatDate(new Date(row[COL.TIMESTAMP]), Session.getScriptTimeZone(), 'HH:mm')
      : '',
    notes       : row[COL.NOTES]  || '',
    status      : row[COL.STATUS] || 'Paid'
  }));
}

// ============================================================
//  MARK PENDING AS PAID
// ============================================================
function markAsPaid(rowIndex, paymentType) {
  try {
    const sheet    = _getSheet(SH.DAILY);
    const sheetRow = rowIndex + 2;
    sheet.getRange(sheetRow, COL.PAYMENT+1).setValue(paymentType);
    sheet.getRange(sheetRow, COL.STATUS+1 ).setValue('Paid');
    return { success:true };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  UPDATE (EDIT) ENTRY
// ============================================================
function updateEntry(rowIndex, data) {
  try {
    const sheet    = _getSheet(SH.DAILY);
    const sheetRow = rowIndex + 2;
    const isPending = data.status === 'Pending';
    sheet.getRange(sheetRow, 1, 1, 9).setValues([[
      (data.plateNumber || '').toUpperCase(),
      data.carType, data.washType,
      parseFloat(data.cost) || 0,
      isPending ? 'Pending' : data.paymentType,
      data.box,
      sheet.getRange(sheetRow, 7).getValue(),
      data.loyaltyCode || '',
      isPending ? 'Pending' : 'Paid'
    ]]);
    return { success:true };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  INVENTORY SALE
// ============================================================
function addInventorySale(data) {
  try {
    const sheet = _getSheet(SH.DAILY_SALES);
    _ensureHeader(sheet, ['Product Name','Quantity','Product ID','Status','Timeline']);
    sheet.appendRow([data.productName, parseFloat(data.quantity)||1,
                     data.productId||'', 'Sold', new Date()]);
    return { success:true };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  CLOSE SHIFT  –  Drive folder + archive sheet
// ============================================================
function closeShift(managerName) {
  try {
    const entries = _getDailyEntries();
    if (!entries.length) return { success:false, message:'დღის ჩანაწერები არ მოიძებნა' };

    const today  = new Date();
    const tz     = Session.getScriptTimeZone();
    const dateStr= Utilities.formatDate(today, tz, 'dd/MM/yyyy');

    // ── Aggregate ───────────────────────────────────────
    const byType = {
      'სედანი'  :{count:0,cash:0,card:0,talon:0,pending:0},
      'ჯიპი'    :{count:0,cash:0,card:0,talon:0,pending:0},
      'ჯიპი XL' :{count:0,cash:0,card:0,talon:0,pending:0},
      'VIP'     :{count:0,cash:0,card:0,talon:0,pending:0}
    };
    const boxSalaries={}, boxWashes={};
    BOXES.forEach(b=>{ boxSalaries[b]=0; boxWashes[b]=0; });

    let cashTotal=0, cardTotal=0, talonValue=0, talonCount=0;
    let pendingTotal=0, pendingCount=0, washerTotal=0, managerVIPBonus=0;

    entries.forEach(row => {
      const carType   = row[COL.CAR_TYPE]  || '';
      const washType  = row[COL.WASH_TYPE] || '';
      const cost      = parseFloat(row[COL.COST])   || 0;
      const payment   = row[COL.PAYMENT]   || '';
      const box       = row[COL.BOX]       || '';
      const isPending = (row[COL.STATUS]   || 'Paid') === 'Pending';
      const isVIP     = washType === 'VIP';

      const earning   = cost * (isVIP ? WASHER_VIP_RATE : WASHER_STANDARD_RATE);
      washerTotal    += earning;
      if (boxSalaries[box]!==undefined){ boxSalaries[box]+=earning; boxWashes[box]++; }

      if (isVIP) managerVIPBonus += VIP_BONUS_PER_WASH;

      if (isPending) { pendingCount++; pendingTotal+=cost; }
      else {
        if (payment==='Cash')  cashTotal +=cost;
        if (payment==='Card')  cardTotal +=cost;
        if (payment==='Talon'){ talonValue+=cost; talonCount++; }
      }

      const tk = byType[carType] ? carType : null;
      if (tk) {
        byType[tk].count++;
        if (isPending)        byType[tk].pending+=cost;
        else if (payment==='Cash')  byType[tk].cash+=cost;
        else if (payment==='Card')  byType[tk].card+=cost;
        else if (payment==='Talon') byType[tk].talon+=cost;
      }
      if (isVIP) {
        byType['VIP'].count++;
        if (isPending)        byType['VIP'].pending+=cost;
        else if (payment==='Cash')  byType['VIP'].cash+=cost;
        else if (payment==='Card')  byType['VIP'].card+=cost;
        else if (payment==='Talon') byType['VIP'].talon+=cost;
      }
    });

    const totalRevenue  = cashTotal + cardTotal + talonValue;
    const dailyBonus    = totalRevenue >= DAILY_BONUS_THRESHOLD ? DAILY_BONUS : 0;
    const managerTotal  = MANAGER_BASE + managerVIPBonus + dailyBonus;
    const totalExpenses = washerTotal + managerTotal;
    const remainCashCard= cashTotal + cardTotal - totalExpenses;

    // ── Write main Summary sheet ─────────────────────────
    const ss       = _getSS();
    const sumSheet = ss.getSheetByName(SH.SUMMARY);
    sumSheet.clearContents();

    const summaryRows = [
      ['ESG Car Wash – '+managerName+' – '+dateStr,'','','','','',''],
      ['','','','','','',''],
      ['შემოსავალი','','','','','',''],
      ['','რაოდენობა','ქეში','ბარათი','ტალონი','სულ','მოლოდინი'],
      _typeRow('სედანი',  byType),
      _typeRow('ჯიპი',    byType),
      _typeRow('ჯიპი XL', byType),
      _typeRow('VIP',     byType),
      ['სულ',entries.length,cashTotal,cardTotal,talonValue,totalRevenue,pendingTotal],
      ['','','','','','',''],
      ['ხარჯები','','','','','',''],
      ['','ბაზა','VIP','ბონუსი','სრული','',''],
      ['მრეცხავები – Box 1',boxSalaries['Box 1'],'','',boxWashes['Box 1']+' რეცხ.','',''],
      ['მრეცხავები – Box 2',boxSalaries['Box 2'],'','',boxWashes['Box 2']+' რეცხ.','',''],
      ['მრეცხავები – Box 3',boxSalaries['Box 3'],'','',boxWashes['Box 3']+' რეცხ.','',''],
      ['მრეცხავები – Box 4',boxSalaries['Box 4'],'','',boxWashes['Box 4']+' რეცხ.','',''],
      ['მენეჯერი ('+managerName+')',MANAGER_BASE,managerVIPBonus,dailyBonus,managerTotal,'',''],
      ['ტალონი',talonCount+' ერთ.','','','','',''],
      ['მოლოდინი',pendingCount+' ერთ. / '+pendingTotal.toFixed(2)+' ₾','','','','',''],
      ['სულ ხარჯები',totalExpenses.toFixed(2),'','','','',''],
      ['','','','','','',''],
      ['დარჩენილი','','','','','',''],
      ['Cash + ბარათი (ხარჯების შემდეგ)',remainCashCard.toFixed(2),'','','','','']
    ];
    sumSheet.getRange(1,1,summaryRows.length,7).setValues(summaryRows);
    sumSheet.getRange('A1').setFontWeight('bold').setFontSize(13);

    // ── Create Archive Sheet (with Drive folder if authorized) ─
    const monthFolderName = Utilities.formatDate(today, tz, 'MMMM yyyy');
    const archiveName     = 'ESGMall ' + Utilities.formatDate(today, tz, 'dd/MM/yyyy');

    // SpreadsheetApp.create() only needs Spreadsheets scope — always works
    const archiveSS = SpreadsheetApp.create(archiveName);

    // Summary tab
    const archSum = archiveSS.getSheets()[0];
    archSum.setName('Summary');
    archSum.getRange(1,1,summaryRows.length,7).setValues(summaryRows);
    archSum.getRange('A1').setFontWeight('bold');

    // Raw data tab
    const archRaw = archiveSS.insertSheet('Raw Data');
    archRaw.appendRow(['Date','Plate','Car Type','Wash Type','Cost','Payment','Box','Notes','Status']);
    entries.forEach(row => {
      archRaw.appendRow([dateStr,
        row[COL.PLATE], row[COL.CAR_TYPE], row[COL.WASH_TYPE],
        parseFloat(row[COL.COST])||0, row[COL.PAYMENT], row[COL.BOX],
        row[COL.NOTES]||'', row[COL.STATUS]||'Paid'
      ]);
    });

    // Try to move into ESG CarWash / May 2026 folder — needs Drive scope
    // If not yet authorized, file stays in Drive root (still accessible)
    let archivePath = archiveName + ' (Drive root)';
    try {
      const rootIter   = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
      const rootFolder = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
      const mthIter    = rootFolder.getFoldersByName(monthFolderName);
      const mthFolder  = mthIter.hasNext() ? mthIter.next() : rootFolder.createFolder(monthFolderName);
      DriveApp.getFileById(archiveSS.getId()).moveTo(mthFolder);
      archivePath = ROOT_FOLDER_NAME + ' / ' + monthFolderName + ' / ' + archiveName;
    } catch(driveErr) {
      // Drive not yet authorized — file saved in Drive root, still works
      Logger.log('Drive folder skipped: ' + driveErr.message);
    }

    // ── Clear Daily & Daily_Sales ────────────────────────
    const dailySheet = _getSheet(SH.DAILY);
    if (dailySheet.getLastRow()>1) dailySheet.deleteRows(2, dailySheet.getLastRow()-1);
    const salesSheet = _getSheet(SH.DAILY_SALES);
    if (salesSheet.getLastRow()>1) salesSheet.deleteRows(2, salesSheet.getLastRow()-1);

    // Clear session
    const p = PropertiesService.getScriptProperties();
    p.deleteProperty('currentManager');
    p.deleteProperty('shiftStart');

    return {
      success: true,
      summary: {
        date:dateStr, totalWashes:entries.length, totalRevenue,
        cashTotal, cardTotal, talonValue, talonCount,
        pendingCount, pendingTotal,
        vipCount:byType['VIP'].count,
        washerTotal, boxSalaries, boxWashes,
        managerBase:MANAGER_BASE, managerVIPBonus, dailyBonus, managerTotal,
        totalExpenses, remainCashCard,
        bonusReached: dailyBonus>0,
        archivePath : archivePath,
        archiveUrl  : archiveSS.getUrl()
      }
    };
  } catch(e) { return { success:false, message:e.message }; }
}

function _typeRow(key, byType) {
  const t = byType[key];
  return [key, t.count, t.cash, t.card, t.talon, t.cash+t.card+t.talon, t.pending];
}

// ============================================================
//  SETUP
// ============================================================
function setupSpreadsheet() {
  const ss = _getSS();
  [SH.DAILY,SH.SUMMARY,SH.DAILY_SALES,SH.DATA,SH.LISTS].forEach(n=>{
    if (!ss.getSheetByName(n)) ss.insertSheet(n);
  });
  const daily = ss.getSheetByName(SH.DAILY);
  if (daily.getLastRow()===0) {
    daily.appendRow(['Plate Number','Car Type','Wash Type','Cost',
                     'Payment Type','Box','Timestamp','Notes','Status']);
    daily.getRange('1:1').setFontWeight('bold');
  }
  return ss.getId();
}

function createAndSetupSheet() {
  const ss = SpreadsheetApp.create('ESG Car Wash Manager – Data');
  ss.getSheets()[0].setName('Daily');
  ['Summary','Daily_Sales','Data','Lists'].forEach(n=>ss.insertSheet(n));
  const d = ss.getSheetByName('Daily');
  d.appendRow(['Plate Number','Car Type','Wash Type','Cost','Payment Type','Box','Timestamp','Notes','Status']);
  d.getRange('1:1').setFontWeight('bold');
  Logger.log('ID='+ss.getId());
  return {id:ss.getId(), url:ss.getUrl()};
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================
function _getSS() {
  return SPREADSHEET_ID && SPREADSHEET_ID!=='YOUR_SPREADSHEET_ID_HERE'
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}
function _getSheet(name) {
  const s = _getSS().getSheetByName(name);
  if (!s) throw new Error('Sheet not found: '+name+'. Run setupSpreadsheet().');
  return s;
}
function _ensureHeader(sheet, headers) {
  if (sheet.getLastRow()===0) {
    sheet.appendRow(headers);
    sheet.getRange('1:1').setFontWeight('bold');
  }
}
function _getDailyEntries() {
  const sheet = _getSheet(SH.DAILY);
  const last  = sheet.getLastRow();
  if (last<=1) return [];
  return sheet.getRange(2,1,last-1,9).getValues().filter(r=>r[0]);
}
