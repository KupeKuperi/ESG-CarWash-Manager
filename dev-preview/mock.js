// Mock google.script.run for local preview.
// State lives in localStorage ('esg_mock') so it survives reloads,
// mimicking PropertiesService + the Daily sheet. PINs: manager 2329, admin 1234.
(function () {
  'use strict';
  const KEY = 'esg_mock';
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { manager: null, shiftStart: null, daily: [] }; }
    catch (e) { return { manager: null, shiftStart: null, daily: [] }; }
  };
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const hhmm = () => { const n = new Date(); const p = x => String(x).padStart(2, '0'); return p(n.getHours()) + ':' + p(n.getMinutes()); };

  const PRICES = {
    'სედანი'  : { 'სტანდარტი': 30, 'VIP': 80,  'შიგნიდან': 15, 'გარედან': 15, 'ორივე': 30, 'სხვა': 0 },
    'ჯიპი'    : { 'სტანდარტი': 40, 'VIP': 120, 'შიგნიდან': 20, 'გარედან': 20, 'ორივე': 40, 'სხვა': 0 },
    'ჯიპი XL' : { 'სტანდარტი': 50, 'VIP': 150, 'შიგნიდან': 25, 'გარედან': 25, 'ორივე': 50, 'სხვა': 0 }
  };

  function stats() {
    const s = load();
    const boxData = { 'Box 1': { salary: 0, washes: 0 }, 'Box 2': { salary: 0, washes: 0 }, 'Box 3': { salary: 0, washes: 0 }, 'Box 4': { salary: 0, washes: 0 } };
    let cash = 0, card = 0, talonC = 0, talonV = 0, renoC = 0, renoV = 0, pendC = 0, pendV = 0, vip = 0, vipBonus = 0;
    s.daily.forEach(r => {
      const cost = parseFloat(r.cost) || 0;
      const isPend = !r.paymentType || r.paymentType === 'Pending';
      const isVIP = r.washType === 'VIP';
      const earn = cost * (isVIP ? 0.40 : 0.35);
      if (boxData[r.box]) { boxData[r.box].salary += earn; boxData[r.box].washes++; }
      if (isVIP) { vip++; vipBonus += cost * 0.10; }
      if (isPend) { pendC++; pendV += cost; }
      else if (r.paymentType === 'Cash')  cash += cost;
      else if (r.paymentType === 'Card')  card += cost;
      else if (r.paymentType === 'Talon') { talonC++; talonV += cost; }
      else if (r.paymentType === 'Reno')  { renoC++;  renoV += cost; }
    });
    const rev = cash + card + talonV + renoV;
    return {
      totalWashes: s.daily.length, pendingCount: pendC, pendingValue: pendV,
      cashTotal: cash, cardTotal: card, talonCount: talonC, talonValue: talonV,
      renoCount: renoC, renoValue: renoV, vipCount: vip, totalRevenue: rev,
      managerVIPBonus: vipBonus,
      projectedManagerSalary: 110 + vipBonus + (rev >= 1600 ? 50 : 0) + (rev >= 2000 ? 25 : 0),
      bonusReached: rev >= 1600, bonusReached2: rev >= 2000, boxData
    };
  }

  const api = {
    isShiftActive() {
      const s = load();
      return s.manager ? { active: true, managerName: s.manager, shiftStart: s.shiftStart } : { active: false };
    },
    login(name, pin) {
      if (pin !== '2329') return { success: false, message: 'PIN კოდი არასწორია' };
      return { success: true, managerName: String(name).trim() };
    },
    setShiftStart(name) {
      const s = load();
      const leftover = s.daily.length;
      s.manager = name; s.shiftStart = new Date().toISOString(); save(s);
      return { success: true, startTime: s.shiftStart, leftover: leftover };
    },
    unlockManagerAccess(pin) {
      if (pin !== '2329') return { success: false, message: 'PIN კოდი არასწორია' };
      const s = load();
      if (!s.manager) return { success: false, message: 'ცვლა არ არის დაწყებული' };
      return { success: true, managerName: s.manager, shiftStart: s.shiftStart };
    },
    unlockAdminView(pin) {
      if (pin !== '1234') return { success: false, message: 'Admin PIN არასწორია' };
      const s = load();
      if (!s.manager) return { success: false, message: 'ცვლა არ არის დაწყებული' };
      return { success: true, managerName: s.manager, shiftStart: s.shiftStart };
    },
    clearShiftState() { const s = load(); s.manager = null; s.shiftStart = null; save(s); return 'cleared'; },
    getListsData() {
      return { carTypes: Object.keys(PRICES), washTypes: ['სტანდარტი', 'VIP', 'შიგნიდან', 'გარედან', 'ორივე', 'სხვა'],
               boxes: ['Box 1', 'Box 2', 'Box 3', 'Box 4'], payments: ['Cash', 'Card', 'Talon', 'Reno'], prices: PRICES };
    },
    getAllEntries() { return load().daily.map((r, i) => Object.assign({ rowIndex: i }, r)); },
    addEntry(d) {
      const s = load();
      const pay = (d.paymentType && d.paymentType !== 'Pending') ? d.paymentType : 'Pending';
      const notes = [];
      if (d.loyaltyCode) notes.push('L:' + d.loyaltyCode);
      if (d.phone)       notes.push('T:' + d.phone);
      s.daily.push({
        plateNumber: (d.plateNumber || '').toUpperCase(), carType: d.carType, washType: d.washType,
        cost: parseFloat(d.cost) || 0, paymentType: pay, box: d.box, timestamp: hhmm(),
        notes: notes.join(' | '), status: pay !== 'Pending' ? 'Paid' : 'Pending'
      });
      save(s);
      return { success: true, rowIndex: s.daily.length - 1 };
    },
    markAsPaid(i, p) {
      const s = load();
      if (!s.daily[i]) return { success: false, message: 'row not found' };
      s.daily[i].paymentType = p; s.daily[i].status = 'Paid'; save(s);
      return { success: true };
    },
    updateEntry(i, d) {
      const s = load();
      if (!s.daily[i]) return { success: false, message: 'row not found' };
      const isPend = (d.status || 'Pending') === 'Pending';
      const notes = [];
      if (d.loyaltyCode) notes.push('L:' + d.loyaltyCode);
      if (d.phone)       notes.push('T:' + d.phone);
      Object.assign(s.daily[i], {
        plateNumber: (d.plateNumber || '').toUpperCase(), carType: d.carType, washType: d.washType,
        cost: parseFloat(d.cost) || 0, paymentType: isPend ? 'Pending' : (d.paymentType || 'Cash'),
        box: d.box, notes: notes.join(' | '), status: isPend ? 'Pending' : 'Paid'
      });
      save(s);
      return { success: true };
    },
    updateLoyalty() { return { success: false }; },
    addInventorySale() { return { success: true }; },
    getDashboardStats() { return stats(); },
    getScheduledWashes() { return []; },
    confirmScheduledWash() { return { success: true }; },
    getLiveViewData() {
      const s = load();
      if (!s.manager) return { active: false };
      return { active: true, stats: stats(), managerName: s.manager, shiftStart: s.shiftStart,
               allEntries: api.getAllEntries(), scheduledWashes: [], serverTime: new Date().toISOString() };
    },
    closeShift(name) {
      const s = load();
      if (!s.daily.length) { s.manager = null; s.shiftStart = null; save(s); return { success: true, empty: true }; }
      const st = stats();
      let washer = 0;
      Object.keys(st.boxData).forEach(b => { washer += st.boxData[b].salary; });
      const bonus = (st.totalRevenue >= 1600 ? 50 : 0) + (st.totalRevenue >= 2000 ? 25 : 0);
      const mgr = 100 + st.managerVIPBonus + bonus;
      const exp = washer + mgr;
      const summary = {
        date: new Date().toLocaleDateString('en-GB'), totalWashes: s.daily.length,
        totalRevenue: st.totalRevenue, cashTotal: st.cashTotal, cardTotal: st.cardTotal,
        talonValue: st.talonValue, talonCount: st.talonCount,
        pendingCount: st.pendingCount, pendingTotal: st.pendingValue,
        vipCount: st.vipCount, washerTotal: washer, managerBase: 100,
        managerVIPBonus: st.managerVIPBonus, dailyBonus: bonus, managerTotal: mgr,
        totalExpenses: exp, remainCashCard: st.cashTotal + st.cardTotal - exp,
        bonusReached: bonus > 0, archivePath: '(mock) ESGTbilisiMall Daily Sheets / …', archiveUrl: '#', monthlyUrl: '#'
      };
      s.daily = []; s.manager = null; s.shiftStart = null; save(s);
      return { success: true, summary };
    },
    getWebAppUrl() { return '#'; }
  };

  function mkRun(ok, err) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return f => mkRun(f, err);
        if (name === 'withFailureHandler') return f => mkRun(ok, f);
        return (...args) => setTimeout(() => {
          try {
            if (!api[name]) throw new Error('mock: no method ' + String(name));
            const res = api[name](...args);
            if (ok) ok(res);
          } catch (e) { if (err) err(e); else console.error(e); }
        }, 60);
      }
    });
  }
  window.google = { script: { run: mkRun(null, null) } };
  console.log('[mock] google.script.run ready — manager PIN 2329, admin PIN 1234');
})();
