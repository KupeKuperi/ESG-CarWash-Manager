// ============================================================
//  ESG Car Wash Manager ERP – script.js  v9 (Excel Grid)
// ============================================================
'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const PRICES = {
  'სედანი'  : { 'სტანდარტი':30,'VIP':80 ,'შიგნიდან':15,'გარედან':15,'ორივე':30,'სხვა':0 },
  'ჯიპი'    : { 'სტანდარტი':40,'VIP':120,'შიგნიდან':20,'გარედან':20,'ორივე':40,'სხვა':0 },
  'ჯიპი XL' : { 'სტანდარტი':50,'VIP':150,'შიგნიდან':25,'გარედან':25,'ორივე':50,'სხვა':0 }
};
const GEO = {
  days  : ['კვირა','ორშაბათი','სამშაბათი','ოთხშაბათი','ხუთშაბათი','პარასკევი','შაბათი'],
  months: ['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი',
           'ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი']
};
// Tab-order columns in the wash grid
const GCOLS = ['plate','car-type','wash-type','box','cost','loyalty','phone'];

// ── STATE ─────────────────────────────────────────────────────
const S = {
  managerName  : '',
  lists        : null,
  rows         : [],          // all current shift rows
  collectingRow: null,
  collectPay   : null,
  statsTimer   : null,
  webAppUrl    : '',
  invRows      : []           // inventory session rows
};

// ── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  bindLogin();
  bindStartShift();
  bindLogout();
  bindShiftClose();
  addInvRow();              // seed one empty inventory row
});

// ── CLOCK ─────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const n = new Date();
    const hh = p2(n.getHours()), mm = p2(n.getMinutes()), ss = p2(n.getSeconds());
    const dayStr  = GEO.days[n.getDay()];
    const dateStr = n.getDate() + ' ' + GEO.months[n.getMonth()] + ' ' + n.getFullYear();

    // Header clock
    setEl('hdr-hh',hh); setEl('hdr-mm',mm); setEl('hdr-ss',ss);
    setEl('hdr-date', dayStr + ', ' + dateStr);

    // Start-shift clock
    setEl('ss-hh',hh); setEl('ss-mm',mm); setEl('ss-ss',ss);
    setEl('ss-day-name', dayStr);
    setEl('ss-date-str', dateStr);
  }
  tick(); setInterval(tick, 1000);
}

// ── LOGIN ─────────────────────────────────────────────────────
function bindLogin() {
  const form = document.getElementById('login-form');
  const btn  = document.getElementById('login-btn');
  const pin  = document.getElementById('pin');
  pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g,'').slice(0,6); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('manager-name').value.trim();
    if (!name) { showErr('სახელი სავალდებულოა'); return; }
    if (!pin.value) { showErr('PIN სავალდებულოა'); return; }
    setLoad(btn, true);
    google.script.run
      .withSuccessHandler(r => {
        setLoad(btn, false);
        if (r.success) onLoginOK(r.managerName);
        else showErr(r.message);
      })
      .withFailureHandler(e => { setLoad(btn,false); showErr(e.message); })
      .login(name, pin.value);
  });
}
function showErr(m) {
  const e = document.getElementById('login-error');
  e.textContent=m; e.classList.add('show');
  setTimeout(()=>e.classList.remove('show'),4000);
}
function onLoginOK(name) {
  S.managerName = name;
  document.getElementById('pin').value='';
  document.getElementById('login-screen').style.display='none';
  const ss = document.getElementById('start-shift-screen');
  ss.classList.add('visible');
  setEl('ss-manager-name', name);
  const av = document.getElementById('ss-avatar');
  if (av) av.textContent = name.charAt(0).toUpperCase();
}

// ── START SHIFT ───────────────────────────────────────────────
function bindStartShift() {
  const btn = document.getElementById('start-shift-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    setLoad(btn, true);
    google.script.run
      .withSuccessHandler(() => {
        setLoad(btn,false);
        document.getElementById('start-shift-screen').classList.remove('visible');
        document.getElementById('app').classList.add('visible');
        setEl('manager-name-display', S.managerName);
        const now = new Date();
        setEl('hdr-shift-info', 'ცვლა: ' + p2(now.getHours())+':'+p2(now.getMinutes()));
        initApp();
        toast('✓ ცვლა დაიწყო · ' + p2(now.getHours())+':'+p2(now.getMinutes()), 'success');
      })
      .withFailureHandler(e => { setLoad(btn,false); toast(e.message,'error'); })
      .setShiftStart(S.managerName);
  });
}

// ── APP INIT ──────────────────────────────────────────────────
function initApp() {
  google.script.run
    .withSuccessHandler(url => {
      S.webAppUrl = url;
      const el = document.getElementById('live-link-btn');
      if (el && url) el.href = url + '?page=live';
    })
    .withFailureHandler(()=>{})
    .getWebAppUrl();

  google.script.run
    .withSuccessHandler(lists => {
      S.lists = lists;
      loadGrid();
      refreshStats();
      S.statsTimer = setInterval(refreshStats, 30000);
    })
    .withFailureHandler(e => toast('სიების შეცდომა: '+e.message,'error'))
    .getListsData();
}

// ── TAB SWITCHING ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelector('.tab-btn[data-tab="'+name+'"]').classList.add('active');
  if (name==='summary') refreshSummary();
}

// ═══════════════════════════════════════════════════════════════
//  EXCEL-STYLE WASH GRID
// ═══════════════════════════════════════════════════════════════

function loadGrid() {
  google.script.run
    .withSuccessHandler(rows => {
      S.rows = rows || [];
      renderGrid();
    })
    .withFailureHandler(()=>{})
    .getAllEntries();
}

function renderGrid() {
  const tbody = document.getElementById('grid-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Render saved rows
  S.rows.forEach((r,i) => tbody.appendChild(buildSavedRow(r, i)));

  // Always add a fresh new-entry row at bottom
  tbody.appendChild(buildNewRow());

  // Focus plate of new row
  const newPlate = tbody.querySelector('[data-row="new"][data-col="plate"]');
  if (newPlate) setTimeout(()=>newPlate.focus(), 80);
}

// ── BUILD SAVED ROW ───────────────────────────────────────────
function buildSavedRow(r, i) {
  const tr = document.createElement('tr');
  const isPending = (r.status || 'Pending') === 'Pending';
  const rowClass = isPending ? 'row-pending'
    : r.paymentType === 'Cash' ? 'row-cash'
    : r.paymentType === 'Card' ? 'row-card'
    : r.paymentType === 'Talon'? 'row-talon' : '';
  const vipClass = r.washType === 'VIP' ? ' row-vip' : '';
  tr.className = rowClass + vipClass;
  tr.dataset.row = r.rowIndex;

  const note = parseNotes(r.notes);

  tr.innerHTML = `
    <td class="col-num">${i+1}</td>
    <td><input data-row="${r.rowIndex}" data-col="plate"     value="${esc(r.plateNumber)}"    placeholder="ნომ." style="text-transform:uppercase" onchange="saveCell(${r.rowIndex},'plate',this.value)" onkeydown="navKey(event,${r.rowIndex},'plate')"></td>
    <td><select data-row="${r.rowIndex}" data-col="car-type"  onchange="saveCell(${r.rowIndex},'car-type',this.value);autoPrice(${r.rowIndex})" onkeydown="navKey(event,${r.rowIndex},'car-type')">${carOpts(r.carType)}</select></td>
    <td><select data-row="${r.rowIndex}" data-col="wash-type" onchange="saveCell(${r.rowIndex},'wash-type',this.value);autoPrice(${r.rowIndex})" onkeydown="navKey(event,${r.rowIndex},'wash-type')">${washOpts(r.washType)}</select></td>
    <td><select data-row="${r.rowIndex}" data-col="box"       onchange="saveCell(${r.rowIndex},'box',this.value)"       onkeydown="navKey(event,${r.rowIndex},'box')">${boxOpts(r.box)}</select></td>
    <td><input  data-row="${r.rowIndex}" data-col="cost"      value="${r.cost}"                type="number" min="0" step="1" style="text-align:right" onchange="saveCell(${r.rowIndex},'cost',this.value)" onkeydown="navKey(event,${r.rowIndex},'cost')"></td>
    <td><input  data-row="${r.rowIndex}" data-col="loyalty"   value="${esc(note.loyalty)}"    placeholder="კოდი" onchange="saveCell(${r.rowIndex},'loyalty',this.value)" onkeydown="navKey(event,${r.rowIndex},'loyalty')" onblur="triggerLoyalty(${r.rowIndex})"></td>
    <td><input  data-row="${r.rowIndex}" data-col="phone"     value="${esc(note.phone)}"      placeholder="+995..." onchange="saveCell(${r.rowIndex},'phone',this.value)" onkeydown="navKey(event,${r.rowIndex},'phone')"></td>
    <td class="col-ro">${esc(r.timestamp)}</td>
    <td class="col-ro col-action">
      ${isPending ? `<span class="grid-badge gb-pending">⏳ ტაბი</span>` : `<span class="grid-badge gb-${r.paymentType.toLowerCase()}">${esc(r.paymentType)}</span>`}
    </td>
    <td class="col-action">
      ${isPending ? `<button class="btn-collect" onclick="openCollect(${r.rowIndex},'${esc(r.plateNumber)}',${r.cost})">💰</button>` : '✓'}
    </td>`;
  return tr;
}

// ── BUILD NEW-ENTRY ROW ───────────────────────────────────────
function buildNewRow() {
  const tr = document.createElement('tr');
  tr.className = 'row-new';
  tr.dataset.row = 'new';
  const lists = S.lists || {};
  const cTypes  = (lists.carTypes  || ['სედანი','ჯიპი','ჯიპი XL']);
  const wTypes  = (lists.washTypes || ['სტანდარტი','VIP','შიგნიდან','გარედან','ორივე','სხვა']);
  const boxes   = (lists.boxes     || ['Box 1','Box 2','Box 3','Box 4']);

  tr.innerHTML = `
    <td class="col-num"></td>
    <td><input data-row="new" data-col="plate"    placeholder="AA-000-BB"  style="text-transform:uppercase"  onkeydown="navKey(event,'new','plate')"></td>
    <td><select data-row="new" data-col="car-type"  onchange="newAutoPrice()" onkeydown="navKey(event,'new','car-type')">${cTypes.map(v=>`<option>${v}</option>`).join('')}</select></td>
    <td><select data-row="new" data-col="wash-type" onchange="newAutoPrice()" onkeydown="navKey(event,'new','wash-type')">${wTypes.map(v=>`<option>${v}</option>`).join('')}</select></td>
    <td><select data-row="new" data-col="box"       onkeydown="navKey(event,'new','box')">${boxes.map(v=>`<option>${v}</option>`).join('')}</select></td>
    <td><input  data-row="new" data-col="cost"      placeholder="0" type="number" min="0" step="1" style="text-align:right" onkeydown="navKey(event,'new','cost')"></td>
    <td><input  data-row="new" data-col="loyalty"   placeholder="ლოიალობა" onkeydown="navKey(event,'new','loyalty')"></td>
    <td><input  data-row="new" data-col="phone"     placeholder="+995..." onkeydown="navKey(event,'new','phone')"></td>
    <td class="col-ro" style="color:var(--text-4);font-size:11px;padding:0 6px">ახალი</td>
    <td class="col-ro"><span class="grid-badge gb-pending" style="font-size:10px">⏳</span></td>
    <td class="col-action"></td>`;

  // Auto-price on initial render
  setTimeout(newAutoPrice, 50);
  return tr;
}

// ── AUTO PRICE ────────────────────────────────────────────────
function newAutoPrice() {
  const ct = getNewVal('car-type'), wt = getNewVal('wash-type');
  const p  = (PRICES[ct]||{})[wt];
  if (p !== undefined) {
    const inp = document.querySelector('[data-row="new"][data-col="cost"]');
    if (inp && (!inp.value || inp.value==='0')) inp.value = p;
  }
}

function autoPrice(rowIdx) {
  const ct = getVal(rowIdx,'car-type'), wt = getVal(rowIdx,'wash-type');
  const p  = (PRICES[ct]||{})[wt];
  if (p !== undefined) {
    const inp = document.querySelector(`[data-row="${rowIdx}"][data-col="cost"]`);
    if (inp) inp.value = p;
  }
}

// ── KEYBOARD NAVIGATION ───────────────────────────────────────
function navKey(e, rowKey, colName) {
  if (e.key !== 'Tab' && e.key !== 'Enter') return;
  const colIdx = GCOLS.indexOf(colName);
  e.preventDefault();

  if (colIdx < GCOLS.length - 1) {
    // Move to next column in same row
    focusCell(rowKey, GCOLS[colIdx+1]);
  } else {
    // Last column
    if (rowKey === 'new') {
      submitNewRow();
    } else {
      // Move to next saved row or new row
      const nextIdx = parseInt(rowKey) + 1;
      const nextEl  = document.querySelector(`[data-row="${nextIdx}"][data-col="plate"]`);
      if (nextEl) nextEl.focus();
      else        focusCell('new','plate');
    }
  }
}

function focusCell(rowKey, col) {
  const el = document.querySelector(`[data-row="${rowKey}"][data-col="${col}"]`);
  if (el) { el.focus(); if (el.tagName==='INPUT') el.select(); }
}

// ── SUBMIT NEW ROW ────────────────────────────────────────────
function submitNewRow() {
  const plate   = getNewVal('plate').trim().toUpperCase();
  const carType = getNewVal('car-type');
  const washType= getNewVal('wash-type');
  const box     = getNewVal('box');
  const cost    = parseFloat(getNewVal('cost')) || 0;
  const loyalty = getNewVal('loyalty').trim();
  const phone   = getNewVal('phone').trim();

  if (!plate)  { focusCell('new','plate');  toast('მანქანის ნომერი სავალდებულოა','warning'); return; }
  if (cost<=0) { focusCell('new','cost');   toast('თანხა სავალდებულოა','warning'); return; }

  const data = { plateNumber:plate, carType, washType, box, cost, loyaltyCode:loyalty, phone };

  // Disable new row inputs temporarily
  document.querySelectorAll('[data-row="new"]').forEach(el => el.disabled=true);

  google.script.run
    .withSuccessHandler(res => {
      document.querySelectorAll('[data-row="new"]').forEach(el => el.disabled=false);
      if (res.success) {
        toast('⏳ '+plate+' — ტაბზე დამატებულია','success');
        // Loyalty sync
        if (loyalty) {
          google.script.run
            .withSuccessHandler(lr => { if (lr && lr.success) toast('🎫 '+lr.userName+' — ლოიალობა განახლდა','info'); })
            .withFailureHandler(()=>{})
            .updateLoyalty(loyalty);
        }
        loadGrid();
        refreshStats();
      } else {
        document.querySelectorAll('[data-row="new"]').forEach(el => el.disabled=false);
        toast('შეცდომა: '+res.message,'error');
        focusCell('new','plate');
      }
    })
    .withFailureHandler(e => {
      document.querySelectorAll('[data-row="new"]').forEach(el => el.disabled=false);
      toast('კავშირის შეცდომა: '+e.message,'error');
    })
    .addEntry(data);
}

// ── SAVE CELL (existing row) ──────────────────────────────────
// Called on 'change' — gathers whole row and calls updateEntry
const _saveDirty = {};
function saveCell(rowIdx, col, value) {
  // Debounce per row
  clearTimeout(_saveDirty[rowIdx]);
  _saveDirty[rowIdx] = setTimeout(() => doSaveRow(rowIdx), 800);
}

function doSaveRow(rowIdx) {
  const row = S.rows[rowIdx];
  if (!row) return;
  const note = parseNotes(row.notes);
  const data = {
    plateNumber : getVal(rowIdx,'plate') || row.plateNumber,
    carType     : getVal(rowIdx,'car-type')  || row.carType,
    washType    : getVal(rowIdx,'wash-type') || row.washType,
    box         : getVal(rowIdx,'box')       || row.box,
    cost        : parseFloat(getVal(rowIdx,'cost')) || row.cost,
    loyaltyCode : getVal(rowIdx,'loyalty')  || note.loyalty,
    phone       : getVal(rowIdx,'phone')    || note.phone,
    paymentType : row.paymentType,
    status      : row.status || 'Pending'
  };
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) refreshStats();
    })
    .withFailureHandler(()=>{})
    .updateEntry(rowIdx, data);
}

// ── LOYALTY TRIGGER (on blur of loyalty cell in existing row) ─
function triggerLoyalty(rowIdx) {
  const code = getVal(rowIdx,'loyalty').trim();
  if (!code) return;
  google.script.run
    .withSuccessHandler(r => { if (r && r.success) toast('🎫 '+r.userName+' – ლოიალობა განახლდა','info'); })
    .withFailureHandler(()=>{})
    .updateLoyalty(code);
}

// ── SELECT OPTION BUILDERS ────────────────────────────────────
function carOpts(sel) {
  return ['სედანი','ჯიპი','ჯიპი XL'].map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}
function washOpts(sel) {
  return ['სტანდარტი','VIP','შიგნიდან','გარედან','ორივე','სხვა'].map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}
function boxOpts(sel) {
  return ['Box 1','Box 2','Box 3','Box 4'].map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}

// ── HELPERS ───────────────────────────────────────────────────
function getVal(rowIdx, col) {
  const el = document.querySelector(`[data-row="${rowIdx}"][data-col="${col}"]`);
  return el ? el.value : '';
}
function getNewVal(col) {
  const el = document.querySelector(`[data-row="new"][data-col="${col}"]`);
  return el ? el.value : '';
}

function parseNotes(raw) {
  if (!raw) return { loyalty:'', phone:'' };
  const loyalty = ((raw.match(/L:([^|]+)/)||[])[1]||'').trim();
  const phone   = ((raw.match(/T:([^|]+)/)||[])[1]||'').trim();
  return { loyalty, phone };
}

// ═══════════════════════════════════════════════════════════════
//  COLLECT PAYMENT
// ═══════════════════════════════════════════════════════════════
function openCollect(rowIdx, plate, cost) {
  S.collectingRow = rowIdx;
  S.collectPay    = null;
  document.querySelectorAll('.pay-option').forEach(el=>el.classList.remove('sel'));
  document.getElementById('confirm-pay-btn').disabled=true;
  setEl('collect-modal-title','💰 '+plate+' – '+cost+'₾');
  document.getElementById('collect-modal').classList.add('open');
}
function closeCollectModal() {
  document.getElementById('collect-modal').classList.remove('open');
}
function selectPay(type) {
  S.collectPay = type;
  document.querySelectorAll('.pay-option').forEach(el => {
    const lbl = el.querySelector('.po-lbl').textContent;
    el.classList.toggle('sel', (type==='Cash'&&lbl==='Cash')||(type==='Card'&&lbl==='ბარათი')||(type==='Talon'&&lbl==='ტალონი'));
  });
  document.getElementById('confirm-pay-btn').disabled=false;
}
function confirmCollect() {
  if (S.collectingRow===null || !S.collectPay) return;
  const btn = document.getElementById('confirm-pay-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res => {
      setLoad(btn,false);
      if (res.success) {
        toast('✓ '+S.collectPay+' – გადახდა მიღებულია','success');
        closeCollectModal();
        loadGrid();
        refreshStats();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .markAsPaid(S.collectingRow, S.collectPay);
}

// ═══════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════
function refreshStats() {
  google.script.run
    .withSuccessHandler(renderStats)
    .withFailureHandler(()=>{})
    .getDashboardStats();
}
function renderStats(s) {
  setEl('st-washes',  s.totalWashes);
  setEl('st-cash',    fmt(s.cashTotal));
  setEl('st-card',    fmt(s.cardTotal));
  setEl('st-pending', s.pendingCount + (s.pendingValue>0?' / '+fmt(s.pendingValue):''));
  setEl('st-vip',     s.vipCount);
  setEl('st-revenue', fmt(s.totalRevenue));

  const pill = document.getElementById('bonus-pill');
  if (pill) { if (s.bonusReached) pill.classList.add('show'); else pill.classList.remove('show'); }

  // Box bar
  ['Box 1','Box 2','Box 3','Box 4'].forEach((b,i) => {
    const n  = i+1, bd = (s.boxData||{})[b]||{salary:0,washes:0};
    setEl('box'+n+'-sal', fmt(bd.salary));
    setEl('box'+n+'-w',   bd.washes+' რეცხ.');
  });

  // Bonus bar
  const pct = Math.min((s.totalRevenue/1600)*100,100);
  const bar = document.getElementById('bonus-bar-fill');
  if (bar) bar.style.width = pct.toFixed(1)+'%';
  setEl('bonus-pct-lbl', pct.toFixed(0)+'%');
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY TAB
// ═══════════════════════════════════════════════════════════════
function refreshSummary() {
  google.script.run
    .withSuccessHandler(s => {
      setEl('sv-revenue', fmt(s.totalRevenue));
      setEl('sv-washes',  s.totalWashes);
      setEl('sv-cash',    fmt(s.cashTotal));
      setEl('sv-card',    fmt(s.cardTotal));
      setEl('sv-talon',   s.talonCount+' / '+fmt(s.talonValue));
      setEl('sv-pending', s.pendingCount+' / '+fmt(s.pendingValue));

      const boxes = ['Box 1','Box 2','Box 3','Box 4'];
      boxes.forEach((b,i) => {
        const n=i+1, bd=(s.boxData||{})[b]||{salary:0,washes:0};
        setEl('sv-b'+n+'-sal', fmt(bd.salary));
        setEl('sv-b'+n+'-w',   bd.washes+' რეცხ.');
      });

      const vipB  = s.managerVIPBonus || 0;
      const dayB  = s.bonusReached ? 50 : 0;
      const mgrT  = 175 + vipB + dayB;
      setEl('sv-mgr-base',  '175.00₾');
      setEl('sv-mgr-vip',   fmt(vipB));
      setEl('sv-mgr-bonus', s.bonusReached ? '+50.00₾ ✓' : '0.00₾');
      setEl('sv-mgr-total', fmt(mgrT));

      const pct = Math.min((s.totalRevenue/1600)*100,100);
      const bar = document.getElementById('sv-bonus-bar');
      if (bar) bar.style.width = pct.toFixed(1)+'%';
      setEl('sv-bonus-status', fmt(s.totalRevenue)+' / 1,600₾');
      setEl('sv-bonus-lbl', s.bonusReached
        ? '🎯 ბარიერი გადალახულია! +50₾ ბონუსი'
        : 'ბონუსამდე დარჩა: '+fmt(1600-s.totalRevenue));
    })
    .withFailureHandler(()=>{})
    .getDashboardStats();
}

// ═══════════════════════════════════════════════════════════════
//  INVENTORY GRID
// ═══════════════════════════════════════════════════════════════
function addInvRow() {
  const tbody = document.getElementById('inv-grid-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  const i  = tbody.rows.length + 1;
  tr.innerHTML = `
    <td class="td-num">${i}</td>
    <td><input type="text"   placeholder="პროდუქტის სახელი..." onkeydown="invKey(event,this)"></td>
    <td><input type="text"   placeholder="SKU / კოდი"></td>
    <td><input type="number" placeholder="1" min="1" value="1" style="text-align:right" onkeydown="invKey(event,this)"></td>
    <td class="td-btn"><button class="btn btn-primary btn-icon" onclick="saveInvRow(this)" title="შენახვა">✓</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('input').focus();
}
function invKey(e, el) {
  if (e.key==='Enter' || (e.key==='Tab' && el===el.closest('tr').querySelector('input:last-of-type'))) {
    e.preventDefault();
    saveInvRow(el.closest('tr').querySelector('button'));
  }
}
function saveInvRow(btn) {
  const tr  = btn.closest('tr');
  const inp = tr.querySelectorAll('input');
  const name= inp[0].value.trim(), id=inp[1].value.trim(), qty=parseFloat(inp[2].value)||1;
  if (!name) { inp[0].focus(); toast('პროდუქტის სახელი სავალდებულოა','warning'); return; }
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res => {
      setLoad(btn,false);
      if (res.success) {
        toast('✓ გაყიდვა: '+name+' x'+qty,'success');
        // Mark row as saved (grey it out)
        tr.style.background='#F9FAFB';
        inp.forEach(i=>i.disabled=true);
        btn.textContent='✓'; btn.style.background='var(--cash)';
        S.invRows.push({name,id,qty});
        // Add new row
        addInvRow();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .addInventorySale({ productName:name, productId:id, quantity:qty });
}

// ═══════════════════════════════════════════════════════════════
//  CLOSE SHIFT
// ═══════════════════════════════════════════════════════════════
function bindShiftClose() {
  document.getElementById('close-shift-btn').addEventListener('click',()=>{
    document.getElementById('confirm-modal').classList.add('open');
  });
  document.getElementById('confirm-yes').addEventListener('click',()=>{
    document.getElementById('confirm-modal').classList.remove('open');
    executeClose();
  });
  document.getElementById('confirm-no').addEventListener('click',()=>{
    document.getElementById('confirm-modal').classList.remove('open');
  });
  ['close-summary-modal','close-summary-btn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('click', onAfterClose);
  });
}
function executeClose() {
  const btn = document.getElementById('close-shift-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if (res.success) {
        renderShiftModal(res.summary);
        document.getElementById('summary-modal').classList.add('open');
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .closeShift(S.managerName);
}
function renderShiftModal(s) {
  setEl('sm-date',     s.date);
  setEl('sm-revenue',  fmt(s.totalRevenue));
  setEl('sm-washes',   s.totalWashes);
  setEl('sm-cash',     fmt(s.cashTotal));
  setEl('sm-card',     fmt(s.cardTotal));
  setEl('sm-washer',   fmt(s.washerTotal));
  setEl('sm-mgr',      fmt(s.managerTotal));
  setEl('sm-expenses', fmt(s.totalExpenses));
  setEl('sm-remain',   fmt(s.remainCashCard));
  setEl('sm-path',     s.archivePath||'');
  const al = document.getElementById('sm-archive-url');
  if (al) al.href = s.archiveUrl||'#';
  const ba = document.getElementById('sm-bonus-alert');
  if (ba) { if (s.bonusReached) ba.classList.add('show'); else ba.classList.remove('show'); }
}
function onAfterClose() {
  document.getElementById('summary-modal').classList.remove('open');
  S.rows=[];
  renderGrid();
  renderStats({totalWashes:0,cashTotal:0,cardTotal:0,talonCount:0,talonValue:0,
    pendingCount:0,pendingValue:0,vipCount:0,totalRevenue:0,bonusReached:false,boxData:{}});
}

// ── LOGOUT ───────────────────────────────────────────────────
function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click',()=>{
    if(!confirm('გამოსვლა? ცვლის მონაცემები შენახულია.')) return;
    if(S.statsTimer) { clearInterval(S.statsTimer); S.statsTimer=null; }
    S.managerName=''; S.rows=[]; S.lists=null;
    document.getElementById('app').classList.remove('visible');
    document.getElementById('start-shift-screen').classList.remove('visible');
    document.getElementById('login-screen').style.display='flex';
    document.getElementById('manager-name').value='';
    document.getElementById('pin').value='';
    ['collect-modal','confirm-modal','summary-modal'].forEach(id=>{
      document.getElementById(id).classList.remove('open');
    });
  });
}

// ─── UTILITIES ────────────────────────────────────────────────
function fmt(n) { return (parseFloat(n)||0).toFixed(2)+'₾'; }
function p2(n)  { return String(n).padStart(2,'0'); }
function setEl(id,v){ const e=document.getElementById(id); if(e) e.textContent=v; }
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setLoad(btn,on) {
  if (!btn) return;
  if (on) { btn._t=btn.innerHTML; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true; }
  else    { btn.innerHTML=btn._t||''; btn.disabled=false; }
}
function toast(msg,type) {
  type=type||'info';
  const icons={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  const el=document.createElement('div');
  el.className='toast '+type;
  el.innerHTML=`<span>${icons[type]||''}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}
