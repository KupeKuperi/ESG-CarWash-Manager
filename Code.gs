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
const MANAGER_BASE            = 110;
const VIP_BONUS_RATE          = 0.10;  // 10% of each VIP wash cost
const DAILY_BONUS_THRESHOLD   = 1600;
const DAILY_BONUS             = 50;
const DAILY_BONUS_THRESHOLD_2 = 2000;
const DAILY_BONUS_2           = 25;
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

  // ?page=monthly&pin=<ADMIN_VIEW_PIN>[&month=June 2026]  →  (re)build monthly summary sheet(s)
  // ?page=master&pin=<ADMIN_VIEW_PIN>                     →  (re)build the all-months master sheet
  if (page === 'monthly' || page === 'master') {
    if ((e.parameter.pin || '') !== ADMIN_VIEW_PIN)
      return ContentService.createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
    if (page === 'master') return jsonOut_(rebuildAllMonthsMaster());
    return jsonOut_(e.parameter.month ? rebuildMonthlySummary(e.parameter.month)
                                      : rebuildAllMonthlySummaries());
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
  // Rows left over from an unclosed previous shift — kept (never auto-deleted),
  // but the manager is warned they will appear in this shift's archive.
  let leftover = 0;
  try { leftover = _getDailyEntries().length; } catch(e) {}
  PropertiesService.getScriptProperties().setProperties({
    currentManager : managerName,
    shiftStart     : now.toISOString()
  });
  return { success: true, startTime: now.toISOString(), leftover: leftover };
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
  // Shift state is written ONLY by setShiftStart (the "Start Shift" button).
  // Logging in must not create a ghost shift or reset an active shift's start time.
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
    if (!entries.length) {
      // Nothing to archive — still close the shift cleanly instead of dead-ending
      const p0 = PropertiesService.getScriptProperties();
      p0.deleteProperty('currentManager');
      p0.deleteProperty('shiftStart');
      return { success:true, empty:true };
    }

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
      ['ქეში (სულ)',cashTotal.toFixed(2),'','','','',''],
      ['ქეში + ბარათი (სულ)',(cashTotal+cardTotal).toFixed(2),'','','','',''],
      ['ნარჩენი (ხარჯების შემდეგ)',remainCashCard.toFixed(2),'','','','','']
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

    // Cash-only row (row 24) and Cash+Card row (row 25)
    archSum2.getRange(24, 1, 1, 7).setBackground('#F0FDF4').setFontWeight('bold');
    archSum2.getRange(25, 1, 1, 7).setBackground('#EFF6FF').setFontWeight('bold');
    // Net remainder row (last row — row 26): green if positive, red if negative
    archSum2.getRange(summaryRows.length, 1, 1, 7)
      .setBackground(remainCashCard >= 0 ? '#D1FAE5' : '#FEE2E2')
      .setFontWeight('bold').setFontSize(12);

    // Number format on the revenue data cells (rows 5-9, cols 2-7)
    archSum2.getRange(5, 2, 5, 6).setNumberFormat('0.00');
    // Number format on the remainder rows (rows 24-26, col 2)
    archSum2.getRange(24, 2, 3, 1).setNumberFormat('0.00');

    // Borders on revenue and expenses table blocks
    archSum2.getRange(3, 1, 7, 7)   // revenue section (rows 3-9)
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    archSum2.getRange(11, 1, 11, 7) // expenses section (rows 11-21)
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    archSum2.getRange(23, 1, 4, 7)  // remainder section (rows 23-26)
      .setBorder(true, true, true, true, true, true,
                 '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    // Column widths + freeze title row
    [220, 100, 100, 80, 80, 90, 90].forEach(function(w, i) {
      archSum2.setColumnWidth(i + 1, w);
    });
    archSum2.setFrozenRows(1);

    // ── Move archive into Drive folder ─────────────────────────
    let archivePath = archiveName + ' (Drive root)';
    let monthlyUrl  = '';
    try {
      const rootFolder = _getRootFolder();
      const mthIter    = rootFolder.getFoldersByName(monthFolderName);
      const mthFolder  = mthIter.hasNext() ? mthIter.next() : rootFolder.createFolder(monthFolderName);
      DriveApp.getFileById(archiveSS.getId()).moveTo(mthFolder);
      archivePath = ROOT_FOLDER_NAME + ' / ' + monthFolderName + ' / ' + archiveName;

      // Keep the month's running summary current — must never block the close
      let monthRows = null;
      try {
        const mres = _updateMonthlySummary(mthFolder, monthFolderName, {
          date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
          manager: managerName, washes: entries.length, vip: byType['VIP'].count,
          cash: cashTotal, card: cardTotal, talon: talonValue, reno: renoValue, pending: pendingTotal,
          revenue: totalRevenue, washers: washerTotal, managerPay: managerTotal,
          expenses: totalExpenses, net: remainCashCard,
          b1: boxSalaries['Box 1'], b2: boxSalaries['Box 2'], b3: boxSalaries['Box 3'], b4: boxSalaries['Box 4'],
          w1: boxWashes['Box 1'],   w2: boxWashes['Box 2'],   w3: boxWashes['Box 3'],   w4: boxWashes['Box 4'],
          fileId: archiveSS.getId(), url: archiveSS.getUrl(), name: archiveName, created: Date.now()
        });
        monthlyUrl = mres.url; monthRows = mres.records;
      } catch(mErr) { Logger.log('Monthly summary skipped: ' + mErr.message); }
      // …and this month's line in the all-months master sheet
      if (monthRows) {
        try { _upsertMasterMonth(_monthRecordFromRecords(today.getFullYear(), today.getMonth(), monthRows, monthlyUrl, monthFolderName)); }
        catch(xErr) { Logger.log('Master sheet skipped: ' + xErr.message); }
      }
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
        archiveUrl  : archiveSS.getUrl(),
        monthlyUrl  : monthlyUrl
      }
    };
  } catch(e) { return { success:false, message:e.message }; }
}

function _typeRow(key, byType) {
  const t = byType[key];
  return [key, t.count, t.cash, t.card, t.talon, t.cash+t.card+t.talon, t.pending];
}

// ============================================================
//  MONTHLY SUMMARY  —  "ESGMonthlyMall <Month Year>" inside each month folder
//  One row per closed shift (a date repeats when a shift was closed twice —
//  each archive holds distinct washes, so both count). Kept current by
//  closeShift(); rebuilt from the daily archives via rebuildMonthlySummary().
// ============================================================
const MONTHLY_PREFIX = 'ESGMonthlyMall ';
const DAILY_PREFIX   = 'ESGDailyMall ';

// Column order is shared by the writer and the read-back parser — keep in sync
const MCOLS = ['date','manager','washes','vip','cash','card','talon','reno','pending',
               'revenue','washers','managerPay','expenses','net','link','fileId',
               'b1','b2','b3','b4','w1','w2','w3','w4'];
const MHDRS = ['თარიღი','მენეჯერი','მობანება','VIP','ქეში','ბარათი','ტალონი','Reno','ტაბი',
               'სულ შემოსავალი','მრეცხავები','მენეჯერი ₾','სულ ხარჯები','ნარჩენი','ფაილი','ID',
               'Box 1 ₾','Box 2 ₾','Box 3 ₾','Box 4 ₾','Box 1 რეცხ.','Box 2 რეცხ.','Box 3 რეცხ.','Box 4 რეცხ.'];
const M_HDR_ROW = 8;   // header row of the day table in the Summary tab (rows 3-6 = KPI block)

function _getRootFolder() {
  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}

// Serializes every monthly-sheet write. A browser can fetch the ?page=monthly URL
// twice in parallel (prefetch), and two unsynchronized rebuilds each create their
// own file.
function _withMonthlyLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(180000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// Exactly one "ESGMonthlyMall <month>" per folder: keep the oldest copy, trash extras
// (generated files — rebuildable from the archives, recoverable from Drive trash).
function _getOrCreateMonthlySS(folder, monthName) {
  const name = MONTHLY_PREFIX + monthName;
  const it   = folder.getFilesByName(name);
  const found = [];
  while (it.hasNext()) found.push(it.next());
  if (found.length) {
    found.sort((a, b) => a.getDateCreated() - b.getDateCreated());
    found.slice(1).forEach(f => { try { f.setTrashed(true); } catch(e) {} });
    return SpreadsheetApp.openById(found[0].getId());
  }
  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  return ss;
}

// Rebuild one month from its daily archives. monthName = folder name, e.g. "June 2026".
function rebuildMonthlySummary(monthName) {
  return _withMonthlyLock(() => _rebuildMonthlyUnlocked(monthName));
}

function rebuildAllMonthlySummaries() {
  return _withMonthlyLock(() => {
    const it = _getRootFolder().getFolders();
    const names = [];
    while (it.hasNext()) names.push(it.next().getName());
    names.sort((a, b) => new Date('1 ' + a) - new Date('1 ' + b));
    return { success:true, months: names.map(_rebuildMonthlyUnlocked) };
  });
}

function _rebuildMonthlyUnlocked(monthName) {
  try {
    const c = _rebuildMonthlyCore(monthName);
    return { success:true, month:monthName, shifts:c.records.length, revenue:c.T.revenue, cash:c.T.cash,
             card:c.T.card, expenses:c.T.expenses, net:c.T.net, errors:c.errors, url:c.mss.getUrl() };
  } catch(e) { return { success:false, month:monthName, message:e.message }; }
}

// Scans the month folder's daily archives and (re)writes the monthly workbook.
// `mss` may be passed when the caller already holds the monthly spreadsheet.
function _rebuildMonthlyCore(monthName, mss) {
  const it = _getRootFolder().getFoldersByName(monthName);
  if (!it.hasNext()) throw new Error('Folder not found: ' + monthName);
  const folder  = it.next();
  const files   = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  const records = [], errors = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf(DAILY_PREFIX) !== 0) continue;
    try { records.push(_extractDayRecord(f)); }
    catch(e) { errors.push(f.getName() + ': ' + e.message); }
  }
  if (!mss) mss = _getOrCreateMonthlySS(folder, monthName);
  const T = _writeMonthlyWorkbook(mss, monthName, records);
  return { mss, records, T, errors };
}

// Incremental path used by closeShift: read the month table back, replace/append
// today's row, rewrite. Falls back to a full rebuild if the sheet is new or its
// layout predates MHDRS. Returns { url, records }.
function _updateMonthlySummary(folder, monthName, rec) {
  return _withMonthlyLock(() => {
    const mss = _getOrCreateMonthlySS(folder, monthName);
    let records = _readMonthlyRecords(mss);
    if (!records) {
      const c = _rebuildMonthlyCore(monthName, mss);
      return { url: mss.getUrl(), records: c.records };
    }
    records = records.filter(r => r.fileId !== rec.fileId);
    records.push(rec);
    _writeMonthlyWorkbook(mss, monthName, records);
    return { url: mss.getUrl(), records };
  });
}

// Parse one daily archive's Summary tab into a day record. Label-based lookup,
// so it tolerates row shifts between archive versions.
function _extractDayRecord(file) {
  const sh = SpreadsheetApp.openById(file.getId()).getSheetByName('Summary');
  if (!sh) throw new Error('Summary tab missing');
  const v    = sh.getDataRange().getValues();
  const row  = lbl => v.find(r => String(r[0]).trim() === lbl) || [];
  const rowP = pre => v.find(r => String(r[0]).trim().indexOf(pre) === 0) || [];
  const num  = x => parseFloat(String(x === undefined ? '' : x).replace(/[^\d.\-]/g, '')) || 0;
  const pair = s => { const m = String(s || '').match(/([\d.]+)\s*ერთ\.?\s*\/\s*([\d.]+)/);
                      return m ? { n:+m[1] || 0, v:+m[2] || 0 } : { n:0, v:0 }; };

  // Title: "ESGDailyMall  ·  MANAGER  ·  dd/MM/yyyy"; fallback: file name "ESGDailyMall dd/MM/yy"
  const tm = String(v[0][0]).match(/·\s*(.+?)\s*·\s*(\d{2})\/(\d{2})\/(\d{4})/);
  let manager = tm ? tm[1].trim() : '';
  let date    = tm ? new Date(+tm[4], +tm[3] - 1, +tm[2]) : null;
  if (!date) {
    const fm = file.getName().match(/(\d{2})\/(\d{2})\/(\d{2})\s*$/);
    if (fm) date = new Date(2000 + +fm[3], +fm[2] - 1, +fm[1]);
  }
  if (!date || isNaN(date.getTime())) throw new Error('date not found');

  const tot = row('სულ'), vip = row('VIP'), mgr = rowP('მენეჯერი');
  const box = n => row('მრეცხავები – Box ' + n);
  const rec = {
    date, manager,
    washes : num(tot[1]), vip: num(vip[1]),
    cash   : num(tot[2]), card: num(tot[3]),
    talon  : pair(row('ტალონი')[1]).v,
    reno   : pair(row('Reno')[1]).v,
    pending: num(tot[6]),
    revenue: num(tot[5]),
    b1: num(box(1)[1]), b2: num(box(2)[1]), b3: num(box(3)[1]), b4: num(box(4)[1]),
    w1: num(box(1)[4]), w2: num(box(2)[4]), w3: num(box(3)[4]), w4: num(box(4)[4]),
    managerPay: num(mgr[4]),
    expenses  : num(row('სულ ხარჯები')[1]),
    fileId: file.getId(), url: file.getUrl(), name: file.getName(),
    created: file.getDateCreated().getTime()
  };
  rec.washers = rec.b1 + rec.b2 + rec.b3 + rec.b4;
  rec.net     = rec.cash + rec.card - rec.expenses;
  return rec;
}

// Read the day table back from an existing monthly sheet. null → needs full rebuild.
function _readMonthlyRecords(mss) {
  const sh = mss.getSheetByName('Summary');
  if (!sh) return null;
  const v  = sh.getDataRange().getValues();
  const hi = v.findIndex(r => r[0] === MHDRS[0] && r[1] === MHDRS[1]);
  if (hi < 0) return null;
  for (let c = 0; c < MHDRS.length; c++) if (v[hi][c] !== MHDRS[c]) return null;
  const recs = [];
  for (let i = hi + 1; i < v.length; i++) {
    const r = v[i];
    if (Object.prototype.toString.call(r[0]) !== '[object Date]') break;   // totals row / blank → end of table
    const o = {};
    MCOLS.forEach((k, c) => { o[k] = r[c]; });
    o.name = String(o.link || ''); delete o.link;
    o.url  = 'https://docs.google.com/spreadsheets/d/' + o.fileId;
    o.created = 0;
    recs.push(o);
  }
  return recs;
}

function _freshSheet(mss, name, idx) {
  let sh = mss.getSheetByName(name);
  if (!sh) {
    const all = mss.getSheets();
    if (idx === 0 && all.length === 1 && all[0].getLastRow() === 0) { sh = all[0]; sh.setName(name); }
    else sh = mss.insertSheet(name, idx);
  }
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)).breakApart();
  sh.clear();
  return sh;
}

// Writes both tabs from scratch. Returns the month totals.
function _writeMonthlyWorkbook(mss, monthName, records) {
  const tz = Session.getScriptTimeZone();
  try { mss.setSpreadsheetTimeZone(tz); } catch(e) {}
  records.sort((a, b) => (a.date - b.date) || ((a.created || 0) - (b.created || 0)));
  const days = records.length;
  const T = {};
  ['washes','vip','cash','card','talon','reno','pending','revenue','washers','managerPay',
   'expenses','net','b1','b2','b3','b4','w1','w2','w3','w4']
    .forEach(k => { T[k] = records.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0); });
  const best = records.reduce((b, r) => (!b || r.revenue > b.revenue) ? r : b, null);
  const BORDER = r => r.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // ════ Tab 1: Summary ════════════════════════════════════════
  const sh = _freshSheet(mss, 'Summary', 0);
  const NC = MHDRS.length;
  const pad = a => a.concat(new Array(NC - a.length).fill(''));
  const kpi1L = ['სულ შემოსავალი','ქეში','ბარათი','ქეში + ბარათი','ტალონი','Reno','ტაბი','სულ ხარჯები','ნარჩენი','მობანება'];
  const kpi1V = [T.revenue, T.cash, T.card, T.cash + T.card, T.talon, T.reno, T.pending, T.expenses, T.net, T.washes];
  const kpi2L = ['ცვლები','საშ. შემოსავალი / ცვლა','VIP','მრეცხავები სულ','მენეჯერები სულ','საუკეთესო დღე'];
  const kpi2V = [days, days ? T.revenue / days : 0, T.vip, T.washers, T.managerPay,
                 best ? Utilities.formatDate(best.date, tz, 'dd/MM') + '  ·  ' + best.revenue.toFixed(2) + ' ₾' : '—'];
  const rows = [
    pad(['ESGMonthlyMall  ·  ' + monthName]),
    pad([]), pad(kpi1L), pad(kpi1V), pad(kpi2L), pad(kpi2V), pad([]),
    MHDRS.slice()
  ];
  records.forEach(r => rows.push(MCOLS.map(k =>
    k === 'link' ? (r.name || '') : (r[k] === undefined || r[k] === null ? '' : r[k]))));
  rows.push(['სულ', days + ' ცვლა', T.washes, T.vip, T.cash, T.card, T.talon, T.reno, T.pending,
             T.revenue, T.washers, T.managerPay, T.expenses, T.net, '', '',
             T.b1, T.b2, T.b3, T.b4, T.w1, T.w2, T.w3, T.w4]);
  sh.getRange(1, 1, rows.length, NC).setValues(rows);

  const first = M_HDR_ROW + 1, totRow = first + days;
  const col   = k => MCOLS.indexOf(k) + 1;
  const MONEY = ['cash','card','talon','reno','pending','revenue','washers','managerPay','expenses','net','b1','b2','b3','b4'];
  const COUNT = ['washes','vip','w1','w2','w3','w4'];
  if (days) {
    sh.getRange(first, col('link'), days, 1).setRichTextValues(records.map(r =>
      [SpreadsheetApp.newRichTextValue().setText(r.name || 'ფაილი').setLinkUrl(r.url || null).build()]));
    sh.getRange(first, 1, days, NC).setBackgrounds(records.map((r, i) => new Array(NC).fill(i % 2 ? '#FAFAFA' : '#FFFFFF')));
    sh.getRange(first, col('revenue'), days, 1).setFontWeight('bold');
    sh.getRange(first, col('fileId'), days, 1).setFontColor('#9CA3AF').setFontSize(8);
  }
  const fmtRow = MCOLS.map(k => k === 'date' ? 'dd/MM/yyyy' : MONEY.indexOf(k) >= 0 ? '#,##0.00' : COUNT.indexOf(k) >= 0 ? '0' : '@');
  const fmts = []; for (let i = 0; i <= days; i++) fmts.push(fmtRow.slice());
  fmts[days][0] = '@';
  sh.getRange(first, 1, days + 1, NC).setNumberFormats(fmts);

  sh.getRange(1, 1, 1, NC).merge().setBackground('#1A2132').setFontColor('#E2EAF4')
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  sh.setRowHeight(1, 36);
  sh.getRange(3, 1, 1, kpi1L.length).setBackground('#E8ECF2').setFontWeight('bold').setFontSize(9).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(5, 1, 1, kpi2L.length).setBackground('#E8ECF2').setFontWeight('bold').setFontSize(9).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(3, 34); sh.setRowHeight(5, 34);
  sh.getRange(4, 1, 1, kpi1V.length).setFontWeight('bold').setFontSize(12).setNumberFormat('#,##0.00');
  sh.getRange(4, 10).setNumberFormat('0');
  sh.getRange(4, 1).setBackground('#EBF5FB');
  sh.getRange(4, 9).setBackground(T.net >= 0 ? '#D1FAE5' : '#FEE2E2');
  sh.getRange(6, 1, 1, kpi2V.length).setFontWeight('bold').setFontSize(12).setNumberFormat('#,##0.00');
  sh.getRange(6, 1).setNumberFormat('0'); sh.getRange(6, 3).setNumberFormat('0');
  BORDER(sh.getRange(3, 1, 4, kpi1L.length));
  sh.getRange(M_HDR_ROW, 1, 1, NC).setBackground('#2C3A50').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(M_HDR_ROW, 26);
  sh.getRange(totRow, 1, 1, NC).setBackground('#FEF3C7').setFontWeight('bold');
  sh.getRange(totRow, col('net')).setBackground(T.net >= 0 ? '#D1FAE5' : '#FEE2E2');
  BORDER(sh.getRange(M_HDR_ROW, 1, days + 2, NC));
  sh.setFrozenRows(M_HDR_ROW);
  [92,100,80,60,90,90,85,85,85,110,95,95,100,95,150,60,75,75,75,75,85,85,85,85]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // ════ Tab 2: Salaries (washers per box + managers) ══════════
  const s2 = _freshSheet(mss, 'Salaries', 1);
  const wTot = T.w1 + T.w2 + T.w3 + T.w4;
  // Managers type their name at login ("DATO" / "dato" / "Dato") — group case-insensitively
  const byMgr = {};
  records.forEach(r => {
    const k = String(r.manager || '—').trim().toUpperCase() || '—';
    byMgr[k] = byMgr[k] || { d:0, pay:0, rev:0 };
    byMgr[k].d++; byMgr[k].pay += parseFloat(r.managerPay) || 0; byMgr[k].rev += parseFloat(r.revenue) || 0;
  });
  const mgrNames = Object.keys(byMgr).sort((a, b) => byMgr[b].pay - byMgr[a].pay);
  const r2 = [
    ['ESGMonthlyMall  ·  ' + monthName + '  ·  ხელფასები', '', '', '', ''],
    ['', '', '', '', ''],
    ['მრეცხავები — ბოქსების ხელფასი', '', '', '', ''],
    ['ბოქსი', 'ხელფასი ₾', 'რეცხვები', 'საშ. ₾ / რეცხვა', '']
  ];
  [1, 2, 3, 4].forEach(n => { const s = T['b' + n], w = T['w' + n]; r2.push(['Box ' + n, s, w, w ? s / w : 0, '']); });
  r2.push(['სულ', T.washers, wTot, wTot ? T.washers / wTot : 0, '']);
  r2.push(['', '', '', '', '']);
  r2.push(['მენეჯერები', '', '', '', '']);
  r2.push(['მენეჯერი', 'ცვლები', 'ხელფასი ₾', 'შემოსავალი ₾', 'საშ. შემოსავალი / ცვლა']);
  const mgrFirst = r2.length + 1;
  mgrNames.forEach(k => { const m = byMgr[k]; r2.push([k, m.d, m.pay, m.rev, m.d ? m.rev / m.d : 0]); });
  r2.push(['სულ', days, T.managerPay, T.revenue, days ? T.revenue / days : 0]);
  s2.getRange(1, 1, r2.length, 5).setValues(r2);

  s2.getRange(1, 1, 1, 5).merge().setBackground('#1A2132').setFontColor('#E2EAF4')
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  s2.setRowHeight(1, 36);
  [3, 11].forEach(r => { s2.getRange(r, 1, 1, 5).merge().setBackground('#2C3A50').setFontColor('#FFFFFF').setFontWeight('bold'); s2.setRowHeight(r, 26); });
  [4, 12].forEach(r => s2.getRange(r, 1, 1, 5).setBackground('#E8ECF2').setFontWeight('bold').setFontSize(10));
  s2.getRange(5, 2, 5, 3).setNumberFormat('#,##0.00');
  s2.getRange(5, 3, 5, 1).setNumberFormat('0');
  s2.getRange(9, 1, 1, 5).setBackground('#FEF3C7').setFontWeight('bold');
  const mgrRows = mgrNames.length + 1;
  s2.getRange(mgrFirst, 2, mgrRows, 4).setNumberFormat('#,##0.00');
  s2.getRange(mgrFirst, 2, mgrRows, 1).setNumberFormat('0');
  s2.getRange(mgrFirst + mgrRows - 1, 1, 1, 5).setBackground('#FEF3C7').setFontWeight('bold');
  BORDER(s2.getRange(3, 1, 7, 5));
  BORDER(s2.getRange(11, 1, mgrRows + 2, 5));
  [200, 110, 100, 130, 170].forEach((w, i) => s2.setColumnWidth(i + 1, w));
  s2.setFrozenRows(1);

  return T;
}

// ============================================================
//  ALL-MONTHS MASTER  —  one sheet with every month: the hand-kept
//  "<თვე> აღრიცხვა" sheets (MASTER_FOLDER_ID/<year>/) plus the ERP's
//  ESGMonthlyMall sheets. Kept current by closeShift(); full rebuild via
//  rebuildAllMonthsMaster() (?page=master).
// ============================================================
const MASTER_FOLDER_ID = '1V47Cbx68yzg7AiR1rH9EgOItoMY2Svv-';
const MASTER_NAME      = 'ESG Car Wash — ყველა თვე';
const GEO_MONTHS = ['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი',
                    'ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი'];
// Column order shared by the writer and the read-back parser — keep in sync
const XCOLS = ['year','label','cars','vip','revenue','cash','card','talon','reno','washers','manager',
               'cashLeft','net','days','avg','source','url'];
const XHDRS = ['წელი','თვე','მობანება','VIP','შემოსავალი','ქეში','ბარათი','ტალონი','Reno','მრეცხავები','მენეჯერი',
               'ნარჩენი ქეში','ქეში + ბარათი','სამუშაო დღეები','საშ. შემოსავალი / დღე','წყარო','URL'];
const X_HDR_ROW = 3;

function _getMasterSS(create) {
  const folder = DriveApp.getFolderById(MASTER_FOLDER_ID);
  const it = folder.getFilesByName(MASTER_NAME);
  const found = [];
  while (it.hasNext()) found.push(it.next());
  if (found.length) {
    found.sort((a, b) => a.getDateCreated() - b.getDateCreated());
    found.slice(1).forEach(f => { try { f.setTrashed(true); } catch(e) {} });
    return SpreadsheetApp.openById(found[0].getId());
  }
  if (!create) return null;
  const ss = SpreadsheetApp.create(MASTER_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  return ss;
}

// Old manual sheet → month record. Sums the day rows as recorded (the totals
// row is incomplete in some months and "Cash Left" carries hand adjustments).
function _readOldMonthSheet(file, year, mi) {
  const v  = SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getValues();
  const hi = v.findIndex(r => String(r[0]).trim() === 'Date');
  if (hi < 0) throw new Error('"Date" header not found');
  const H  = v[hi].map(x => String(x).trim());
  const ci = {};
  [['cars','Cars Washed'],['vip','VIP Washes'],['revenue','Money Made'],['washers','Washers Pay'],['manager','Manager Pay'],
   ['talon','Talons'],['card','Card Pay'],['cashLeft','Cash Left'],['net','Cash+Card']]
    .forEach(p => { ci[p[0]] = H.indexOf(p[1]); if (ci[p[0]] < 0) throw new Error('column missing: ' + p[1]); });
  const num = x => parseFloat(x) || 0;
  const rec = { year, month: mi, cars:0, vip:0, revenue:0, card:0, talon:0, reno:0, washers:0, manager:0,
                cashLeft:0, net:0, days:0, source: file.getName(), url: file.getUrl(), erp: false };
  for (let i = hi + 1; i < v.length; i++) {
    const r = v[i];
    if (String(r[0]).trim() === '') continue;              // totals / blank rows carry no Date
    Object.keys(ci).forEach(k => { rec[k] += num(r[ci[k]]); });
    if (num(r[ci.cars]) > 0) rec.days++;
  }
  rec.cash = rec.revenue - rec.card - rec.talon;           // not recorded in the old sheets
  return rec;
}

// ERP month (rows of an ESGMonthlyMall Summary table) → month record
function _monthRecordFromRecords(year, mi, rows, url, monthName) {
  const S = k => rows.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0);
  const tz = Session.getScriptTimeZone();
  const days = new Set(rows.map(r => Utilities.formatDate(new Date(r.date), tz, 'yyyy-MM-dd'))).size;
  const rec = { year, month: mi, cars:S('washes'), vip:S('vip'), revenue:S('revenue'), cash:S('cash'), card:S('card'),
                talon:S('talon'), reno:S('reno'), washers:S('washers'), manager:S('managerPay'), net:S('net'),
                days, source: MONTHLY_PREFIX + monthName, url, erp: true };
  rec.cashLeft = rec.cash - rec.washers - rec.manager;
  return rec;
}

function rebuildAllMonthsMaster() {
  return _withMonthlyLock(_rebuildMasterUnlocked);
}

function _rebuildMasterUnlocked() {
  try {
    const recs = [], errors = [];
    const yrs = DriveApp.getFolderById(MASTER_FOLDER_ID).getFolders();
    while (yrs.hasNext()) {
      const yf = yrs.next(), year = parseInt(yf.getName(), 10);
      if (!(year > 2000)) continue;
      const files = yf.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (files.hasNext()) {
        const f  = files.next();
        const mi = GEO_MONTHS.indexOf(f.getName().trim().split(/\s+/)[0]);
        if (mi < 0) continue;
        try { recs.push(_readOldMonthSheet(f, year, mi)); }
        catch(e) { errors.push(f.getName() + ': ' + e.message); }
      }
    }
    const mf = _getRootFolder().getFolders();
    while (mf.hasNext()) {
      const folder = mf.next(), d = new Date('1 ' + folder.getName());
      if (isNaN(d.getTime())) continue;
      const it = folder.getFilesByName(MONTHLY_PREFIX + folder.getName());
      let rows = null, url = '';
      if (it.hasNext()) {
        const mss = SpreadsheetApp.openById(it.next().getId());
        rows = _readMonthlyRecords(mss); url = mss.getUrl();
      }
      if (!rows) {   // monthly sheet missing or unreadable → rebuild it from the daily archives
        try { const c = _rebuildMonthlyCore(folder.getName()); rows = c.records; url = c.mss.getUrl(); }
        catch(e) { errors.push(folder.getName() + ': ' + e.message); continue; }
      }
      if (rows.length) recs.push(_monthRecordFromRecords(d.getFullYear(), d.getMonth(), rows, url, folder.getName()));
    }
    const master = _getMasterSS(true);
    const n = _writeMasterSheet(master, recs);
    return { success:true, months:n, errors, url: master.getUrl() };
  } catch(e) { return { success:false, message:e.message }; }
}

function _upsertMasterMonth(rec) {
  return _withMonthlyLock(() => {
    const master = _getMasterSS(false);
    if (!master) { _rebuildMasterUnlocked(); return; }
    let recs = _readMasterRecords(master);
    if (!recs) { _rebuildMasterUnlocked(); return; }
    recs = recs.filter(r => !(r.year === rec.year && r.month === rec.month));
    recs.push(rec);
    _writeMasterSheet(master, recs);
  });
}

function _readMasterRecords(ss) {
  const sh = ss.getSheetByName('Months');
  if (!sh) return null;
  const v  = sh.getDataRange().getValues();
  const hi = v.findIndex(r => r[0] === XHDRS[0] && r[1] === XHDRS[1]);
  if (hi < 0) return null;
  for (let c = 0; c < XHDRS.length; c++) if (v[hi][c] !== XHDRS[c]) return null;
  const recs = [];
  for (let i = hi + 1; i < v.length; i++) {
    const r = v[i];
    if (typeof r[0] !== 'number') { if (String(r[0]).trim() === '') break; continue; }
    const mi = GEO_MONTHS.indexOf(String(r[1]).replace(/\s*\d{4}\s*$/, '').trim());
    if (mi < 0) continue;
    const o = {};
    XCOLS.forEach((k, c) => { o[k] = r[c]; });
    o.year = r[0]; o.month = mi; o.source = String(o.source || ''); o.url = String(o.url || '');
    o.erp = o.source.indexOf(MONTHLY_PREFIX) === 0;
    delete o.label;
    recs.push(o);
  }
  return recs;
}

// Writes the master: contiguous month table (for the chart), yearly block, chart. Returns month count.
function _writeMasterSheet(ss, recs) {
  try { ss.setSpreadsheetTimeZone(Session.getScriptTimeZone()); } catch(e) {}
  const key = r => r.year * 100 + r.month;
  const byKey = {};
  recs.forEach(r => { const k = key(r); if (!byKey[k] || r.erp) byKey[k] = r; });   // ERP data wins for the same month
  recs = Object.keys(byKey).map(k => byKey[k]).sort((a, b) => key(a) - key(b));
  const NC = XHDRS.length, n = recs.length;
  const BORDER = r => r.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
  const sumOf = (list, k) => list.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0);
  const totRow = (label, list) => {
    const t = {}; ['cars','vip','revenue','cash','card','talon','reno','washers','manager','cashLeft','net','days'].forEach(k => { t[k] = sumOf(list, k); });
    return [label, '', t.cars, t.vip, t.revenue, t.cash, t.card, t.talon, t.reno, t.washers, t.manager,
            t.cashLeft, t.net, t.days, t.days ? t.revenue / t.days : 0, '', ''];
  };

  const sh = _freshSheet(ss, 'Months', 0);
  sh.getCharts().forEach(c => sh.removeChart(c));
  const pad = a => a.concat(new Array(NC - a.length).fill(''));
  const rows = [pad(['ESG Car Wash  ·  ყველა თვე']), pad([]), XHDRS.slice()];
  recs.forEach(r => rows.push([r.year, GEO_MONTHS[r.month] + ' ' + r.year, r.cars, r.vip, r.revenue, r.cash, r.card,
                               r.talon, r.reno, r.washers, r.manager, r.cashLeft, r.net, r.days,
                               r.days ? r.revenue / r.days : 0, r.source || '', r.url || '']));
  const first = X_HDR_ROW + 1, yearsRow = first + n + 1;
  rows.push(pad([]));
  rows.push(pad(['წლიური ჯამი']));
  const years = []; recs.forEach(r => { if (years.indexOf(r.year) < 0) years.push(r.year); });
  years.forEach(y => rows.push(totRow(y + ' სულ', recs.filter(r => r.year === y))));
  rows.push(totRow('სულ', recs));
  sh.getRange(1, 1, rows.length, NC).setValues(rows);

  if (n) sh.getRange(first, XCOLS.indexOf('source') + 1, n, 1).setRichTextValues(recs.map(r =>
    [SpreadsheetApp.newRichTextValue().setText(r.source || 'ფაილი').setLinkUrl(r.url || null).build()]));

  const MONEY = ['revenue','cash','card','talon','reno','washers','manager','cashLeft','net','avg'];
  const COUNT = ['year','cars','vip','days'];
  const fmtRow = XCOLS.map(k => MONEY.indexOf(k) >= 0 ? '#,##0.00' : COUNT.indexOf(k) >= 0 ? '0' : '@');
  const fmts = []; for (let i = 0; i < rows.length - X_HDR_ROW; i++) fmts.push(fmtRow.slice());
  sh.getRange(first, 1, rows.length - X_HDR_ROW, NC).setNumberFormats(fmts);
  sh.getRange(yearsRow, 1, rows.length - yearsRow + 1, 1).setNumberFormat('@');

  sh.getRange(1, 1, 1, NC).merge().setBackground('#1A2132').setFontColor('#E2EAF4')
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  sh.setRowHeight(1, 36);
  sh.getRange(X_HDR_ROW, 1, 1, NC).setBackground('#2C3A50').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(X_HDR_ROW, 34);
  if (n) {
    sh.getRange(first, 1, n, NC).setBackgrounds(recs.map((r, i) => new Array(NC).fill(r.erp ? '#F0F9FF' : (i % 2 ? '#FAFAFA' : '#FFFFFF'))));
    sh.getRange(first, 2, n, 1).setFontWeight('bold');
    sh.getRange(first, XCOLS.indexOf('revenue') + 1, n, 1).setFontWeight('bold');
    sh.getRange(first, XCOLS.indexOf('url') + 1, n, 1).setFontColor('#9CA3AF').setFontSize(8);
    BORDER(sh.getRange(X_HDR_ROW, 1, n + 1, NC));
  }
  sh.getRange(yearsRow, 1, 1, NC).merge().setBackground('#2C3A50').setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setRowHeight(yearsRow, 26);
  sh.getRange(yearsRow + 1, 1, years.length, NC).setBackground('#FEF3C7').setFontWeight('bold');
  sh.getRange(yearsRow + 1 + years.length, 1, 1, NC).setBackground('#D1FAE5').setFontWeight('bold').setFontSize(11);
  BORDER(sh.getRange(yearsRow, 1, years.length + 2, NC));
  sh.setFrozenRows(X_HDR_ROW);
  [60, 150, 80, 50, 100, 95, 90, 80, 70, 100, 95, 105, 110, 80, 110, 190, 60].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  if (n > 1) {
    const chart = sh.newChart().setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange(X_HDR_ROW, 2, n + 1, 1))
      .addRange(sh.getRange(X_HDR_ROW, XCOLS.indexOf('revenue') + 1, n + 1, 1))
      .addRange(sh.getRange(X_HDR_ROW, XCOLS.indexOf('net') + 1, n + 1, 1))
      .setNumHeaders(1)
      .setOption('title', 'შემოსავალი და ნარჩენი თვეების მიხედვით')
      .setOption('legend', { position: 'top' })
      .setOption('colors', ['#008CCF', '#059669'])
      .setOption('width', 900).setOption('height', 340)
      .setPosition(yearsRow + years.length + 4, 1, 0, 0)
      .build();
    sh.insertChart(chart);
  }
  return n;
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
