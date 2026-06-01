// ============================================================
//  ESG Car Wash Manager Terminal – Google Apps Script Backend
//  Code.gs – v3 (Box pay, Drive folders, Pending, Live View)
// ============================================================

// ── USER CONFIG ─────────────────────────────────────────────
const SPREADSHEET_ID   = '1ufhpPY_J366QJ1qf5wEjpvlbHVORIZX59EBwbn3NZsc';
const MANAGER_PIN      = '2329';
const ADMIN_VIEW_PIN   = '1234';
const ROOT_FOLDER_NAME = 'ESGTbilisiMall Daily Sheets';

// ── SALARY RULES ────────────────────────────────────────────
const MANAGER_BASE            = 100;
const VIP_BONUS_RATE          = 0.10;  // 10% of each VIP wash cost
const DAILY_BONUS_THRESHOLD   = 1600;
const DAILY_BONUS             = 50;
const DAILY_BONUS_THRESHOLD_2 = 2000;
const DAILY_BONUS_2           = 50;
const WASHER_STANDARD_RATE    = 0.35;
const WASHER_VIP_RATE         = 0.40;

// ── SHEET NAMES ─────────────────────────────────────────────
const SH = {
  DAILY         : 'Daily',
  SUMMARY       : 'Summary',
  DAILY_SALES   : 'Daily_Sales',
  DATA          : 'Data',
  LISTS         : 'Lists',
  SCHEDULED     : 'Scheduled',     // customer QR bookings
  RENO          : 'Reno',          // individual Reno wash log
  RENO_MONTHLY  : 'Reno Monthly'   // monthly Reno totals for billing
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
//  JSON HELPER
// ============================================================
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  EXTERNAL API — called from ESGQR loyalty manager via HTTP
// ============================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'addLoyaltyEntry') {
      var result = addEntry({
        plateNumber : data.customerName || data.userID || 'LOYALTY',
        loyaltyCode : data.userID  || '',
        phone       : data.phone   || '',
        carType     : 'სედანი',
        washType    : data.erpWashType || 'სტანდარტი',
        cost        : 0,
        box         : 'Box 1'
      });
      return jsonOut_(result);
    }
    if (data.action === 'scheduleWash') {
      var result = addScheduledWash({
        phone        : data.phone         || '',
        plate        : data.plate         || '',
        carType      : data.carType       || '',
        washType     : data.washType      || '',
        scheduledTime: data.scheduledTime || ''
      });
      return jsonOut_(result);
    }
    return jsonOut_({ success:false, message:'Unknown action: ' + data.action });
  } catch(err) {
    return jsonOut_({ success:false, message:err.message });
  }
}

// ============================================================
//  WEB APP ENTRY POINT
// ============================================================
function doGet(e) {
  _autoSetup();
  const page = (e && e.parameter && e.parameter.page) || 'app';

  // ?page=reset  →  clear stale shift and redirect to app
  if (page === 'reset') {
    clearShiftState();
    const url = ScriptApp.getService().getUrl();
    return HtmlService.createHtmlOutput(
      '<meta http-equiv="refresh" content="0;url=' + url + '">' +
      '<p>Shift state cleared. <a href="' + url + '">Click here if not redirected.</a></p>'
    );
  }

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

// ── Check if a shift is currently active ─────────────────────
function isShiftActive() {
  const sp    = PropertiesService.getScriptProperties();
  const props = sp.getProperties();
  if (!props.currentManager) return { active: false };
  // Auto-expire shifts older than 20 hours (stale session guard)
  if (props.shiftStart) {
    const hoursElapsed = (Date.now() - new Date(props.shiftStart).getTime()) / 3600000;
    if (hoursElapsed > 20) {
      sp.deleteProperty('currentManager');
      sp.deleteProperty('shiftStart');
      return { active: false };
    }
  }
  return { active: true, managerName: props.currentManager, shiftStart: props.shiftStart || null };
}

// ── One-time helper: clear stale shift from Properties ────────
function clearShiftState() {
  const sp = PropertiesService.getScriptProperties();
  sp.deleteProperty('currentManager');
  sp.deleteProperty('shiftStart');
  Logger.log('Shift state cleared.');
  return 'cleared';
}

// ── Unlock manager access during an active shift ──────────────
function unlockManagerAccess(pin) {
  if (pin !== MANAGER_PIN) return { success: false, message: 'PIN კოდი არასწორია' };
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.currentManager) return { success: false, message: 'ცვლა არ არის დაწყებული' };
  return { success: true, managerName: props.currentManager, shiftStart: props.shiftStart || null };
}

// ── Unlock read-only admin view (separate PIN, non-disruptive) ─
function unlockAdminView(pin) {
  if (pin !== ADMIN_VIEW_PIN) return { success: false, message: 'Admin PIN არასწორია' };
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.currentManager) return { success: false, message: 'ცვლა არ არის დაწყებული' };
  return { success: true, managerName: props.currentManager, shiftStart: props.shiftStart || null };
}

// ── Called when manager clicks "Start Shift" on the confirmation screen ──
function setShiftStart(managerName) {
  const now = new Date();
  PropertiesService.getScriptProperties().setProperties({
    currentManager : managerName,
    shiftStart     : now.toISOString()
  });
  return { success: true, startTime: now.toISOString() };
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
    payments  : ['Cash', 'Card', 'Talon', 'Reno'],
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
  let renoCount=0,  renoValue=0;
  let vipCount=0, managerVIPBonus=0, pendingCount=0, pendingValue=0;

  entries.forEach(r => {
    const cost      = parseFloat(r[COL.COST])    || 0;
    const payment   = r[COL.PAYMENT]  || '';
    const washType  = r[COL.WASH_TYPE]|| '';
    const box       = r[COL.BOX]      || '';
    const isPending = !payment || payment === 'Pending';
    const isVIP     = washType === 'VIP';

    // Washer salary on ALL washes (car was washed regardless of payment)
    const earning = cost * (isVIP ? WASHER_VIP_RATE : WASHER_STANDARD_RATE);
    if (boxData[box]) { boxData[box].salary += earning; boxData[box].washes++; }

    if (isVIP) { vipCount++; managerVIPBonus += cost * VIP_BONUS_RATE; }

    if (isPending) { pendingCount++; pendingValue += cost; }
    else {
      if (payment==='Cash')  cashTotal  += cost;
      if (payment==='Card')  cardTotal  += cost;
      if (payment==='Talon') { talonCount++; talonValue += cost; }
      if (payment==='Reno')  { renoCount++;  renoValue  += cost; }
    }
  });

  const totalRevenue = cashTotal + cardTotal + talonValue + renoValue;
  const projBonus    = (totalRevenue >= DAILY_BONUS_THRESHOLD  ? DAILY_BONUS  : 0) +
                       (totalRevenue >= DAILY_BONUS_THRESHOLD_2 ? DAILY_BONUS_2 : 0);

  return {
    totalWashes  : entries.length,
    pendingCount, pendingValue,
    cashTotal, cardTotal, talonCount, talonValue,
    renoCount, renoValue,
    vipCount, totalRevenue, managerVIPBonus,
    projectedManagerSalary: MANAGER_BASE + managerVIPBonus + projBonus,
    bonusReached  : totalRevenue >= DAILY_BONUS_THRESHOLD,
    bonusReached2 : totalRevenue >= DAILY_BONUS_THRESHOLD_2,
    boxData
  };
}

// ============================================================
//  LIVE VIEW DATA
// ============================================================
function getLiveViewData() {
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.currentManager) return { active: false };
  const stats     = getDashboardStats();
  const entries   = getAllEntries();
  const scheduled = getScheduledWashes();
  return {
    active          : true,
    stats,
    managerName     : props.currentManager,
    shiftStart      : props.shiftStart || null,
    allEntries      : entries,
    scheduledWashes : scheduled,
    serverTime      : new Date().toISOString()
  };
}

// ============================================================
//  SCHEDULED WASHES  (from customer QR webapp)
// ============================================================

// Called by doPost when customer submits a booking
function addScheduledWash(data) {
  try {
    const ss = _getSS();
    let sheet = ss.getSheetByName(SH.SCHEDULED);
    if (!sheet) {
      sheet = ss.insertSheet(SH.SCHEDULED);
      sheet.appendRow(['ID','Phone','Plate','Car Type','Wash Type','Scheduled Time','Status','Created At']);
      sheet.getRange('1:1').setFontWeight('bold');
    }
    const id = 'SCH-' + Date.now();
    sheet.appendRow([
      id,
      data.phone || '',
      (data.plate || '').toUpperCase(),
      data.carType  || '',
      data.washType || '',
      data.scheduledTime || '',
      'Pending',
      new Date()
    ]);
    return { success: true, id: id };
  } catch(e) { return { success: false, message: e.message }; }
}

// Returns all Pending scheduled washes — included in every getLiveViewData call
function getScheduledWashes() {
  try {
    const ss    = _getSS();
    const sheet = ss.getSheetByName(SH.SCHEDULED);
    if (!sheet || sheet.getLastRow() <= 1) return [];
    const tz   = Session.getScriptTimeZone();
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    return rows
      .filter(r => r[0] && r[6] === 'Pending')
      .map(r => ({
        id           : String(r[0]),
        phone        : r[1] || '',
        plate        : r[2] || '',
        carType      : r[3] || '',
        washType     : r[4] || '',
        scheduledTime: r[5] ? String(r[5]) : '',
        status       : r[6] || 'Pending',
        createdAt    : r[7] ? Utilities.formatDate(new Date(r[7]), tz, 'HH:mm') : ''
      }));
  } catch(e) { return []; }
}

// Manager taps OK → marks booking as Confirmed, removes it from live list
function confirmScheduledWash(id) {
  try {
    const sheet = _getSS().getSheetByName(SH.SCHEDULED);
    if (!sheet) return { success: false, message: 'Scheduled sheet not found' };
    const data = sheet.getDataRange().getValues();
    const ri   = data.findIndex((r, i) => i > 0 && String(r[0]) === String(id));
    if (ri === -1) return { success: false, message: 'Booking not found' };
    sheet.getRange(ri + 1, 7).setValue('Confirmed');
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
}

// ============================================================
//  ADD ENTRY
// ============================================================
function addEntry(data) {
  try {
    const sheet = _getSheet(SH.DAILY);
    _ensureHeader(sheet, ['Plate Number','Car Type','Wash Type','Cost',
                          'Payment Type','Box','Timestamp','Notes','Status']);
    // Build notes: loyalty + phone stored together
    const noteParts = [];
    if (data.loyaltyCode && data.loyaltyCode.trim()) noteParts.push('L:' + data.loyaltyCode.trim());
    if (data.phone       && data.phone.trim())        noteParts.push('T:' + data.phone.trim());
    const notes = noteParts.join(' | ');

    // All entries start as Pending — payment collected via Collect button
    const payType = (data.paymentType && data.paymentType !== 'Pending') ? data.paymentType : 'Pending';
    const status  = payType !== 'Pending' ? 'Paid' : 'Pending';
    sheet.appendRow([
      (data.plateNumber || '').toUpperCase(),
      data.carType,
      data.washType,
      parseFloat(data.cost) || 0,
      payType,
      data.box,
      new Date(),
      notes,
      status
    ]);
    const rowIndex = sheet.getLastRow() - 2; // 0-based data index
    if (payType === 'Reno') {
      _logRenoEntry({ plate:(data.plateNumber||'').toUpperCase(),
                      carType:data.carType||'', washType:data.washType||'',
                      cost:parseFloat(data.cost)||0 });
    }
    return { success:true, rowIndex };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  LOYALTY SYNC  (updates Users sheet on Customer QR App)
// ============================================================
function updateLoyalty(loyaltyCode) {
  if (!loyaltyCode || !loyaltyCode.trim()) return { success:false };
  try {
    const ss    = _getSS();
    const sheet = ss.getSheetByName('Users');
    if (!sheet) return { success:false, message:'Users sheet not found' };

    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim().toLowerCase());

    // Find columns by name (flexible mapping)
    const codeCol  = headers.findIndex(h => h.includes('code') || h.includes('loyalty') || h === 'id');
    const washCol  = headers.findIndex(h => h.includes('wash'));
    const streakCol= headers.findIndex(h => h.includes('streak'));
    const dateCol  = headers.findIndex(h => h.includes('last') || h.includes('date') || h.includes('visit'));

    if (codeCol === -1) return { success:false, message:'No loyalty code column in Users sheet' };

    const ri = data.findIndex((r,i) => i>0 && String(r[codeCol]).trim()===loyaltyCode.trim());
    if (ri === -1) return { success:false, message:'Code not found' };

    const today = new Date();
    const sheetRow = ri + 1; // 1-based

    if (washCol  !== -1) sheet.getRange(sheetRow, washCol+1).setValue((parseInt(data[ri][washCol])||0)+1);

    if (streakCol !== -1 && dateCol !== -1) {
      const last = data[ri][dateCol] ? new Date(data[ri][dateCol]) : null;
      let streak = parseInt(data[ri][streakCol]) || 0;
      if (last) {
        const diff = Math.floor((today-last)/(864e5));
        if (diff===1) streak++;
        else if (diff>1) streak = 1;
      } else { streak = 1; }
      sheet.getRange(sheetRow, streakCol+1).setValue(streak);
    }

    if (dateCol !== -1) sheet.getRange(sheetRow, dateCol+1).setValue(today);
    return { success:true, userName: String(data[ri][0]) };
  } catch(e) { return { success:false, message:e.message }; }
}

// ============================================================
//  GET ALL ENTRIES (full shift, all editable)
// ============================================================
function getRecentEntries(n) { return getAllEntries(); } // kept for live.html compat

function getAllEntries() {
  const entries = _getDailyEntries();
  return entries.map((row, i) => ({
    rowIndex    : i,
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
    status      : row[COL.STATUS] || 'Pending'
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
    if (paymentType === 'Reno') {
      const row = sheet.getRange(sheetRow, 1, 1, 9).getValues()[0];
      _logRenoEntry({ plate   : row[COL.PLATE]    || '',
                      carType : row[COL.CAR_TYPE]  || '',
                      washType: row[COL.WASH_TYPE] || '',
                      cost    : parseFloat(row[COL.COST]) || 0 });
    }
    return { success:true };
  } catch(e) { return { success:false, message:e.message }; }
}

// ── Log each Reno wash to the Reno sheet + update monthly totals ──
function _logRenoEntry(d) {
  try {
    const ss  = _getSS();
    const tz  = Session.getScriptTimeZone();
    const now = new Date();
    const mon = Utilities.formatDate(now, tz, 'MMMM yyyy');
    const dt  = Utilities.formatDate(now, tz, 'dd/MM/yyyy');

    // Individual wash log
    let renoSheet = ss.getSheetByName(SH.RENO);
    if (!renoSheet) {
      renoSheet = ss.insertSheet(SH.RENO);
      renoSheet.appendRow(['თვე','თარიღი','ნომ.','მანქანა','რეცხვა','₾']);
      renoSheet.getRange('1:1').setFontWeight('bold')
        .setBackground('#1A2132').setFontColor('#FFFFFF');
    }
    renoSheet.appendRow([mon, dt, d.plate, d.carType, d.washType, d.cost]);

    // Monthly totals
    let monSheet = ss.getSheetByName(SH.RENO_MONTHLY);
    if (!monSheet) {
      monSheet = ss.insertSheet(SH.RENO_MONTHLY);
      monSheet.appendRow(['თვე','რეცხვების რაოდ.','სულ ₾']);
      monSheet.getRange('1:1').setFontWeight('bold')
        .setBackground('#1A2132').setFontColor('#FFFFFF');
    }
    const rows = monSheet.getDataRange().getValues();
    const ri   = rows.findIndex(function(r, i) { return i > 0 && String(r[0]) === mon; });
    if (ri === -1) {
      monSheet.appendRow([mon, 1, d.cost]);
    } else {
      const sr = ri + 1;
      monSheet.getRange(sr, 2).setValue((parseInt(rows[ri][1]) || 0) + 1);
      monSheet.getRange(sr, 3).setValue((parseFloat(rows[ri][2]) || 0) + d.cost);
    }
  } catch(e) { Logger.log('_logRenoEntry error: ' + e.message); }
}

// ============================================================
//  UPDATE (EDIT) ENTRY
// ============================================================
function updateEntry(rowIndex, data) {
  try {
    const sheet    = _getSheet(SH.DAILY);
    const sheetRow = rowIndex + 2;
    const isPending = (data.status || 'Pending') === 'Pending';

    const noteParts = [];
    if (data.loyaltyCode && data.loyaltyCode.trim()) noteParts.push('L:' + data.loyaltyCode.trim());
    if (data.phone       && data.phone.trim())        noteParts.push('T:' + data.phone.trim());
    const notes = noteParts.join(' | ');

    sheet.getRange(sheetRow, 1, 1, 9).setValues([[
      (data.plateNumber || '').toUpperCase(),
      data.carType, data.washType,
      parseFloat(data.cost) || 0,
      isPending ? 'Pending' : (data.paymentType || 'Cash'),
      data.box,
      sheet.getRange(sheetRow, 7).getValue(),
      notes,
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
    let renoCount=0,  renoValue=0;
    let pendingTotal=0, pendingCount=0, washerTotal=0, managerVIPBonus=0;

    entries.forEach(row => {
      const carType   = row[COL.CAR_TYPE]  || '';
      const washType  = row[COL.WASH_TYPE] || '';
      const cost      = parseFloat(row[COL.COST])   || 0;
      const payment   = row[COL.PAYMENT]   || '';
      const box       = row[COL.BOX]       || '';
      const isPending = !payment || payment === 'Pending';
      const isVIP     = washType === 'VIP';

      const earning   = cost * (isVIP ? WASHER_VIP_RATE : WASHER_STANDARD_RATE);
      washerTotal    += earning;
      if (boxSalaries[box]!==undefined){ boxSalaries[box]+=earning; boxWashes[box]++; }

      if (isVIP) managerVIPBonus += cost * VIP_BONUS_RATE;

      if (isPending) { pendingCount++; pendingTotal+=cost; }
      else {
        if (payment==='Cash')  cashTotal +=cost;
        if (payment==='Card')  cardTotal +=cost;
        if (payment==='Talon'){ talonValue+=cost; talonCount++; }
        if (payment==='Reno') { renoValue +=cost; renoCount++; }
      }

      const tk = byType[carType] ? carType : null;
      if (tk) {
        byType[tk].count++;
        if (isPending)              byType[tk].pending+=cost;
        else if (payment==='Cash')  byType[tk].cash+=cost;
        else if (payment==='Card')  byType[tk].card+=cost;
        else if (payment==='Talon'||payment==='Reno') byType[tk].talon+=cost;
      }
      if (isVIP) {
        byType['VIP'].count++;
        if (isPending)              byType['VIP'].pending+=cost;
        else if (payment==='Cash')  byType['VIP'].cash+=cost;
        else if (payment==='Card')  byType['VIP'].card+=cost;
        else if (payment==='Talon'||payment==='Reno') byType['VIP'].talon+=cost;
      }
    });

    const totalRevenue  = cashTotal + cardTotal + talonValue + renoValue;
    const dailyBonus    = (totalRevenue >= DAILY_BONUS_THRESHOLD  ? DAILY_BONUS  : 0) +
                          (totalRevenue >= DAILY_BONUS_THRESHOLD_2 ? DAILY_BONUS_2 : 0);
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
      ['სულ',entries.length,cashTotal,cardTotal,talonValue+renoValue,totalRevenue,pendingTotal],
      ['','','','','','',''],
      ['ხარჯები','','','','','',''],
      ['','ბაზა','VIP %','ბონუსი','სრული','',''],
      ['მრეცხავები – Box 1',boxSalaries['Box 1'],'','',boxWashes['Box 1']+' რეცხ.','',''],
      ['მრეცხავები – Box 2',boxSalaries['Box 2'],'','',boxWashes['Box 2']+' რეცხ.','',''],
      ['მრეცხავები – Box 3',boxSalaries['Box 3'],'','',boxWashes['Box 3']+' რეცხ.','',''],
      ['მრეცხავები – Box 4',boxSalaries['Box 4'],'','',boxWashes['Box 4']+' რეცხ.','',''],
      ['მენეჯერი ('+managerName+')',MANAGER_BASE,managerVIPBonus.toFixed(2),dailyBonus,managerTotal,'',''],
      ['ტალონი',talonCount+' ერთ. / '+talonValue.toFixed(2)+' ₾','','','','',''],
      ['Reno',renoCount+' ერთ. / '+renoValue.toFixed(2)+' ₾','','','','',''],
      ['მოლოდინი',pendingCount+' ერთ. / '+pendingTotal.toFixed(2)+' ₾','','','','',''],
      ['სულ ხარჯები',totalExpenses.toFixed(2),'','','','',''],
      ['','','','','','',''],
      ['დარჩენილი','','','','','',''],
      ['Cash + ბარათი (ხარჯების შემდეგ)',remainCashCard.toFixed(2),'','','','','']
    ];
    sumSheet.getRange(1,1,summaryRows.length,7).setValues(summaryRows);
    sumSheet.getRange('A1').setFontWeight('bold').setFontSize(13);

    // ── Create Archive Spreadsheet ────────────────────────────────
    const monthFolderName = Utilities.formatDate(today, tz, 'MMMM yyyy');
    const archiveName     = 'ESGDailyMall ' + Utilities.formatDate(today, tz, 'dd/MM/yy');
    const archiveSS       = SpreadsheetApp.create(archiveName);

    // ════════════════════════════════════════════════════════════
    //  SHEET 1 — Daily Sheet  (color-coded wash log)
    // ════════════════════════════════════════════════════════════
    const archDaily = archiveSS.getSheets()[0];
    archDaily.setName('Daily Sheet');

    // Row 1 — Title bar
    archDaily.getRange(1, 1, 1, 10).merge()
      .setValue('ESGDailyMall  ·  ' + managerName + '  ·  ' + dateStr)
      .setBackground('#1A2132').setFontColor('#E2EAF4')
      .setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center');
    archDaily.setRowHeight(1, 36);

    // Row 2 — Column headers
    const dHdrs = ['#','მანქ. ნომ.','მანქანა','რეცხვა','ბოქსი','₾','გადახდა','სტ.','დრო','📞 ტელ.'];
    archDaily.getRange(2, 1, 1, dHdrs.length).setValues([dHdrs])
      .setBackground('#2C3A50').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
    archDaily.setRowHeight(2, 26);

    // Build data rows (batch-write for performance)
    const D_PAY_BG   = {Cash:'#F0FDF4', Card:'#EFF6FF', Talon:'#FFFDF5', Pending:'#FFFBEB'};
    const D_PAY_DISP = {Cash:'💵 ქეში', Card:'💳 ბარათი', Talon:'🎫 ტალონი', Pending:'⏳ ტაბი'};
    const dVals = [];
    const dBGs  = [];

    entries.forEach(function(row, i) {
      const isPending = (row[COL.STATUS] || 'Paid') === 'Pending';
      const payment   = isPending ? 'Pending' : (row[COL.PAYMENT] || '');
      const notesRaw  = row[COL.NOTES] || '';
      const phone     = ((notesRaw.match(/T:([^|]+)/) || [])[1] || '').trim();
      const ts        = row[COL.TIMESTAMP]
        ? Utilities.formatDate(new Date(row[COL.TIMESTAMP]), tz, 'HH:mm') : '';
      dVals.push([
        i + 1,
        row[COL.PLATE]     || '',
        row[COL.CAR_TYPE]  || '',
        row[COL.WASH_TYPE] || '',
        row[COL.BOX]       || '',
        parseFloat(row[COL.COST]) || 0,
        D_PAY_DISP[payment] || payment,
        isPending ? 'Pending' : 'Paid',
        ts,
        phone
      ]);
      dBGs.push(new Array(dHdrs.length).fill(D_PAY_BG[payment] || '#FFFFFF'));
    });

    // Single batch write: values + row background colors
    if (dVals.length > 0) {
      const dDataRange = archDaily.getRange(3, 1, dVals.length, dHdrs.length);
      dDataRange.setValues(dVals).setBackgroundColors(dBGs);
      // Bold plate (col 2) and cost (col 6) for all data rows
      archDaily.getRange(3, 2, dVals.length, 1).setFontWeight('bold');
      archDaily.getRange(3, 6, dVals.length, 1)
        .setFontWeight('bold').setNumberFormat('0.00');
    }

    // Totals row
    const dTotRow = dVals.length + 3;
    archDaily.getRange(dTotRow, 1, 1, dHdrs.length).setValues([[
      'სულ', entries.length + ' მობ.', '', '', '',
      totalRevenue, '💵 ' + cashTotal.toFixed(2) + ' / 💳 ' + cardTotal.toFixed(2), '', '', ''
    ]]).setBackground('#E8ECF2').setFontWeight('bold');
    archDaily.getRange(dTotRow, 6).setNumberFormat('0.00');

    // Table borders, frozen header, column widths
    archDaily.getRange(2, 1, dVals.length + 2, dHdrs.length)
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    archDaily.setFrozenRows(2);
    [35, 110, 90, 110, 75, 70, 120, 70, 55, 110].forEach(function(w, i) {
      archDaily.setColumnWidth(i + 1, w);
    });

    // ════════════════════════════════════════════════════════════
    //  SHEET 2 — Summary  (revenue, salaries, expenses)
    // ════════════════════════════════════════════════════════════
    const archSum2 = archiveSS.insertSheet('Summary');

    // Write all values using existing summaryRows array, then format
    archSum2.getRange(1, 1, summaryRows.length, 7).setValues(summaryRows);

    // Override title with ESGDailyMall branding
    archSum2.getRange(1, 1)
      .setValue('ESGDailyMall  ·  ' + managerName + '  ·  ' + dateStr);

    // Title bar (row 1)
    archSum2.getRange(1, 1, 1, 7).merge()
      .setBackground('#1A2132').setFontColor('#E2EAF4')
      .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
    archSum2.setRowHeight(1, 38);

    // Section headers — rows 3 (შემოსავალი), 11 (ხარჯები), 23 (დარჩენილი — shifted by +1 for Reno row)
    [3, 11, 23].forEach(function(r) {
      archSum2.getRange(r, 1, 1, 7).merge()
        .setBackground('#2C3A50').setFontColor('#FFFFFF')
        .setFontWeight('bold').setFontSize(11);
      archSum2.setRowHeight(r, 28);
    });

    // Column header rows — rows 4 and 12
    [4, 12].forEach(function(r) {
      archSum2.getRange(r, 1, 1, 7)
        .setBackground('#E8ECF2').setFontWeight('bold').setFontSize(10);
      archSum2.setRowHeight(r, 22);
    });

    // Revenue total row (row 9)
    archSum2.getRange(9, 1, 1, 7)
      .setBackground('#EBF5FB').setFontWeight('bold');

    // Expenses total row (row 21 — shifted +1 by Reno row)
    archSum2.getRange(21, 1, 1, 7)
      .setBackground('#FEF3C7').setFontWeight('bold');

    // Remainder row (last row — row 23)
    archSum2.getRange(summaryRows.length, 1, 1, 7)
      .setBackground(remainCashCard >= 0 ? '#F0FDF4' : '#FEF2F2')
      .setFontWeight('bold').setFontSize(12);

    // Number format on the revenue data cells (rows 5-9, cols 2-7)
    archSum2.getRange(5, 2, 5, 6).setNumberFormat('0.00');

    // Borders on revenue and expenses table blocks
    archSum2.getRange(3, 1, 7, 7)   // revenue section
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    archSum2.getRange(11, 1, 10, 7) // expenses section
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // Column widths + freeze title row
    [220, 100, 100, 80, 80, 90, 90].forEach(function(w, i) {
      archSum2.setColumnWidth(i + 1, w);
    });
    archSum2.setFrozenRows(1);

    // ── Move archive into Drive folder ─────────────────────────
    let archivePath = archiveName + ' (Drive root)';
    try {
      const rootIter   = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
      const rootFolder = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
      const mthIter    = rootFolder.getFoldersByName(monthFolderName);
      const mthFolder  = mthIter.hasNext() ? mthIter.next() : rootFolder.createFolder(monthFolderName);
      DriveApp.getFileById(archiveSS.getId()).moveTo(mthFolder);
      archivePath = ROOT_FOLDER_NAME + ' / ' + monthFolderName + ' / ' + archiveName;
    } catch(driveErr) {
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
  [SH.DAILY,SH.SUMMARY,SH.DAILY_SALES,SH.DATA,SH.LISTS,SH.SCHEDULED,SH.RENO,SH.RENO_MONTHLY].forEach(n=>{
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
