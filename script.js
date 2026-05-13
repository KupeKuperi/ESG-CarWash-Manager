// ============================================================
//  ESG Car Wash Manager ERP – script.js  v10 (Box Panel)
// ============================================================
'use strict';

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

const BOX_CFG = [
  { num:1, label:'Box 1', rowCls:'bx-row-1', badgeCls:'badge-bx1', btnCls:'bx1-btn', logCls:'lbb-1' },
  { num:2, label:'Box 2', rowCls:'bx-row-2', badgeCls:'badge-bx2', btnCls:'bx2-btn', logCls:'lbb-2' },
  { num:3, label:'Box 3', rowCls:'bx-row-3', badgeCls:'badge-bx3', btnCls:'bx3-btn', logCls:'lbb-3' },
  { num:4, label:'Box 4', rowCls:'bx-row-4', badgeCls:'badge-bx4', btnCls:'bx4-btn', logCls:'lbb-4' }
];

const S = {
  managerName    : '',
  lists          : null,
  logRows        : [],
  boxCollecting  : null,   // box number (1-4) being collected
  collectingRow  : null,   // log row index for pending collect
  collectPay     : null,
  statsTimer     : null,
  webAppUrl      : '',
  editingRow     : null
};

// ── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  bindLogin();
  bindStartShift();
  bindLogout();
  bindShiftClose();
  bindEditModal();
  addInvRow();
});

// ── CLOCK ─────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const n  = new Date();
    const hh = p2(n.getHours()), mm = p2(n.getMinutes()), ss = p2(n.getSeconds());
    const ds = GEO.days[n.getDay()];
    const dt = n.getDate()+' '+GEO.months[n.getMonth()]+' '+n.getFullYear();
    setEl('hdr-hh',hh); setEl('hdr-mm',mm); setEl('hdr-ss',ss);
    setEl('hdr-date', ds+', '+dt);
    setEl('ss-hh',hh); setEl('ss-mm',mm); setEl('ss-ss',ss);
    setEl('ss-day-name', ds); setEl('ss-date-str', dt);
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
    if (!name) { showLoginErr('სახელი სავალდებულოა'); return; }
    if (!pin.value) { showLoginErr('PIN სავალდებულოა'); return; }
    setLoad(btn, true);
    google.script.run
      .withSuccessHandler(r => {
        setLoad(btn, false);
        if (r.success) onLoginOK(r.managerName);
        else showLoginErr(r.message);
      })
      .withFailureHandler(e => { setLoad(btn,false); showLoginErr(e.message); })
      .login(name, pin.value);
  });
}
function showLoginErr(m) {
  const e = document.getElementById('login-error');
  e.textContent=m; e.classList.add('show');
  setTimeout(()=>e.classList.remove('show'), 4000);
}
function onLoginOK(name) {
  S.managerName = name;
  document.getElementById('pin').value='';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('start-shift-screen').classList.add('visible');
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
        setLoad(btn, false);
        document.getElementById('start-shift-screen').classList.remove('visible');
        document.getElementById('app').classList.add('visible');
        setEl('manager-name-display', S.managerName);
        const n=new Date();
        setEl('hdr-shift-info','ცვლა: '+p2(n.getHours())+':'+p2(n.getMinutes()));
        initApp();
        toast('✓ ცვლა დაიწყო · '+p2(n.getHours())+':'+p2(n.getMinutes()),'success');
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
      if (el && url) el.href = url+'?page=live';
    })
    .withFailureHandler(()=>{})
    .getWebAppUrl();

  google.script.run
    .withSuccessHandler(lists => {
      S.lists = lists;
      renderBoxPanel();      // draw the 4 box input rows
      loadLog();             // load today's shift log
      refreshStats();
      S.statsTimer = setInterval(refreshStats, 30000);
    })
    .withFailureHandler(e => toast('შეცდომა: '+e.message,'error'))
    .getListsData();
}

// ── TAB ───────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelector('.tab-btn[data-tab="'+name+'"]').classList.add('active');
  if (name==='summary') refreshSummary();
}

// ═══════════════════════════════════════════════════════════════
//  BOX PANEL  (4 permanent input rows, one per wash bay)
// ═══════════════════════════════════════════════════════════════

function renderBoxPanel() {
  const tbody = document.getElementById('box-panel-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  BOX_CFG.forEach(b => tbody.appendChild(buildBoxRow(b)));
}

function buildBoxRow(b) {
  const lists  = S.lists || {};
  const cTypes = (lists.carTypes  || ['სედანი','ჯიპი','ჯიპი XL']);
  const wTypes = (lists.washTypes || ['სტანდარტი','VIP','შიგნიდან','გარედან','ორივე','სხვა']);
  const n = b.num;
  const tr = document.createElement('tr');
  tr.className = b.rowCls;
  tr.dataset.boxRow = n;

  tr.innerHTML = `
    <td class="bx-label-cell">
      <span class="bx-badge ${b.badgeCls}">${b.label}</span>
    </td>
    <td>
      <input data-box="${n}" data-f="plate" placeholder="AA-000-BB"
             style="text-transform:uppercase;font-weight:600"
             oninput="onBoxPlateInput(${n})">
    </td>
    <td>
      <select data-box="${n}" data-f="car-type" onchange="boxAutoPrice(${n})">
        ${cTypes.map(v=>`<option>${v}</option>`).join('')}
      </select>
    </td>
    <td>
      <select data-box="${n}" data-f="wash-type" onchange="boxAutoPrice(${n})">
        ${wTypes.map(v=>`<option>${v}</option>`).join('')}
      </select>
    </td>
    <td>
      <input data-box="${n}" data-f="cost" type="number" min="0" step="1"
             placeholder="0" style="text-align:right;font-weight:700">
    </td>
    <td>
      <input data-box="${n}" data-f="loyalty" placeholder="კოდი (სურვ.)">
    </td>
    <td>
      <input data-box="${n}" data-f="phone" placeholder="+995...">
    </td>
    <td class="bx-action-cell">
      <button class="btn-bx-collect ${b.btnCls}" id="bx-btn-${n}"
              onclick="collectFromBox(${n})" disabled>
        💰 გადახდა
      </button>
    </td>`;
  return tr;
}

// Enable/disable collect button based on plate presence
function onBoxPlateInput(n) {
  const plate = getBoxF(n,'plate').trim();
  const btn   = document.getElementById('bx-btn-'+n);
  if (btn) btn.disabled = !plate;
  // Also auto-fill price if needed
  boxAutoPrice(n);
}

function boxAutoPrice(n) {
  const ct = getBoxF(n,'car-type'), wt = getBoxF(n,'wash-type');
  const p  = (PRICES[ct]||{})[wt];
  if (p !== undefined) {
    const inp = document.querySelector(`[data-box="${n}"][data-f="cost"]`);
    if (inp && (!inp.value || inp.value==='0')) inp.value = p;
  }
}

function clearBox(n) {
  ['plate','loyalty','phone'].forEach(f => {
    const el = document.querySelector(`[data-box="${n}"][data-f="${f}"]`);
    if (el) el.value='';
  });
  const costEl = document.querySelector(`[data-box="${n}"][data-f="cost"]`);
  if (costEl) costEl.value='';
  const btn = document.getElementById('bx-btn-'+n);
  if (btn) btn.disabled=true;
  // Reset selects to first option
  ['car-type','wash-type'].forEach(f=>{
    const sel = document.querySelector(`[data-box="${n}"][data-f="${f}"]`);
    if (sel) sel.selectedIndex=0;
  });
}

function getBoxF(n, f) {
  const el = document.querySelector(`[data-box="${n}"][data-f="${f}"]`);
  return el ? el.value : '';
}

// ═══════════════════════════════════════════════════════════════
//  COLLECT PAYMENT  (from box OR from shift log pending entry)
// ═══════════════════════════════════════════════════════════════

// Called when manager clicks 💰 on a box row
function collectFromBox(boxNum) {
  const plate = getBoxF(boxNum,'plate').trim().toUpperCase();
  const cost  = parseFloat(getBoxF(boxNum,'cost')) || 0;
  if (!plate) { toast('ნომ. ჩაწერეთ','warning'); return; }
  if (cost<=0){ toast('თანხა ჩაწერეთ','warning'); return; }

  S.boxCollecting = boxNum;
  S.collectingRow = null;
  S.collectPay    = null;

  setEl('collect-modal-title', `💰 ${BOX_CFG[boxNum-1].label} · ${plate} – ${cost}₾`);
  resetCollectModal();
  document.getElementById('collect-modal').classList.add('open');
}

// Called when manager clicks 💰 on a pending entry in the shift log
function collectFromLog(rowIdx, plate, cost) {
  S.boxCollecting = null;
  S.collectingRow = rowIdx;
  S.collectPay    = null;
  setEl('collect-modal-title', `💰 ${plate} – ${cost}₾`);
  resetCollectModal();
  document.getElementById('collect-modal').classList.add('open');
}

function resetCollectModal() {
  document.querySelectorAll('.pay-option').forEach(el=>el.classList.remove('sel'));
  document.getElementById('confirm-pay-btn').disabled=true;
}

function closeCollectModal() {
  document.getElementById('collect-modal').classList.remove('open');
  S.boxCollecting=null; S.collectingRow=null; S.collectPay=null;
}

function selectPay(type) {
  S.collectPay = type;
  document.querySelectorAll('.pay-option').forEach(el=>{
    const lbl=el.querySelector('.po-lbl').textContent;
    el.classList.toggle('sel',
      (type==='Cash'&&lbl==='Cash') ||
      (type==='Card'&&lbl==='ბარათი') ||
      (type==='Talon'&&lbl==='ტალონი'));
  });
  document.getElementById('confirm-pay-btn').disabled=false;
}

// Dispatcher — decides whether this is a box collect or log collect
function onConfirmPay() {
  if (S.boxCollecting !== null) confirmBoxCollect();
  else                          confirmLogCollect();
}

// Confirm: box panel → save new Paid entry → clear box
function confirmBoxCollect() {
  const n  = S.boxCollecting;
  const cfg= BOX_CFG[n-1];
  const data = {
    plateNumber : getBoxF(n,'plate').trim().toUpperCase(),
    carType     : getBoxF(n,'car-type'),
    washType    : getBoxF(n,'wash-type'),
    box         : cfg.label,
    cost        : parseFloat(getBoxF(n,'cost')) || 0,
    loyaltyCode : getBoxF(n,'loyalty').trim(),
    phone       : getBoxF(n,'phone').trim(),
    paymentType : S.collectPay,
    status      : 'Paid'          // saved directly as Paid
  };
  const btn = document.getElementById('confirm-pay-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if (res.success) {
        toast(`✓ ${S.collectPay} · ${data.plateNumber}`,'success');
        if (data.loyaltyCode) {
          google.script.run
            .withSuccessHandler(lr=>{ if(lr&&lr.success) toast('🎫 ლოიალობა განახლდა','info'); })
            .withFailureHandler(()=>{})
            .updateLoyalty(data.loyaltyCode);
        }
        clearBox(n);
        closeCollectModal();
        loadLog();
        refreshStats();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .addEntry(data);
}

// Confirm: pending log entry → mark as Paid
function confirmLogCollect() {
  const btn = document.getElementById('confirm-pay-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if (res.success) {
        toast(`✓ ${S.collectPay} – გადახდა მიღებულია`,'success');
        closeCollectModal();
        loadLog();
        refreshStats();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .markAsPaid(S.collectingRow, S.collectPay);
}

// ═══════════════════════════════════════════════════════════════
//  SHIFT LOG  (read-only table, newest first)
// ═══════════════════════════════════════════════════════════════

function loadLog() {
  google.script.run
    .withSuccessHandler(rows=>{
      S.logRows = rows || [];
      renderLog();
    })
    .withFailureHandler(()=>{})
    .getAllEntries();
}

function renderLog() {
  const tbody = document.getElementById('shift-log-body');
  if (!tbody) return;

  if (!S.logRows.length) {
    tbody.innerHTML='<tr><td colspan="10" class="empty-log">ჩანაწერები არ არის — ბოქსით დაამატეთ</td></tr>';
    return;
  }

  tbody.innerHTML = S.logRows.slice().reverse().map((r,i)=>{
    const isPending = (r.status||'Pending')==='Pending';
    const isVIP     = r.washType==='VIP';
    const note      = parseNotes(r.notes);
    const rowCls    = (isPending ? 'log-pending' : '') + (isVIP ? ' log-vip' : '');
    const boxNum    = (r.box||'').replace(/\D/g,'');
    const logBadge  = boxNum ? `<span class="log-box-badge lbb-${boxNum}">${esc(r.box)}</span>`
                             : `<span class="log-box-badge lbb-x">${esc(r.box)}</span>`;

    const payBadge = isPending
      ? '<span class="grid-badge gb-pending" style="font-size:11px">⏳ ტაბი</span>'
      : `<span class="grid-badge gb-${(r.paymentType||'').toLowerCase()}" style="font-size:11px">${esc(r.paymentType)}</span>`;

    const noteText = [note.loyalty?'🎫 '+note.loyalty:'', note.phone?'📞 '+note.phone:'']
      .filter(Boolean).join(' ');

    const collectBtn = isPending
      ? `<button class="btn-collect" style="font-size:11px;padding:3px 8px"
           onclick="collectFromLog(${r.rowIndex},'${esc(r.plateNumber)}',${r.cost})">💰</button> `
      : '';
    const editBtn = `<button class="btn btn-ghost btn-icon" title="Edit"
                       onclick="openEditModal(${r.rowIndex},${JSON.stringify(r).replace(/"/g,"'")})">✏</button>`;

    return `<tr class="${rowCls}">
      <td style="text-align:center;color:var(--text-4);font-size:11px">${S.logRows.length-i}</td>
      <td style="text-align:center;color:var(--text-3);font-size:11px">${esc(r.timestamp)}</td>
      <td style="text-align:center">${logBadge}</td>
      <td style="font-family:'Courier New',monospace;font-weight:700;letter-spacing:.5px">${esc(r.plateNumber)}</td>
      <td style="font-size:12px">${esc(r.carType)}</td>
      <td><span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;
                       background:${isVIP?'#FEF3C7':'var(--surface-3)'};
                       color:${isVIP?'#92400E':'var(--text-2)'}">${esc(r.washType)}</span></td>
      <td style="text-align:right;font-weight:700">${r.cost}₾</td>
      <td style="text-align:center">${payBadge}</td>
      <td style="font-size:11px;color:var(--text-3)">${esc(noteText)||'—'}</td>
      <td style="text-align:center">${collectBtn}${editBtn}</td>
    </tr>`;
  }).join('');
}

// ─── EDIT MODAL (shift log entries) ──────────────────────────
function openEditModal(rowIdx, row) {
  S.editingRow = rowIdx;
  const note   = parseNotes(row.notes);
  const lists  = S.lists || {};
  const cTypes = lists.carTypes  || ['სედანი','ჯიპი','ჯიპი XL'];
  const wTypes = lists.washTypes || ['სტანდარტი','VIP','შიგნიდან','გარედან','ორივე','სხვა'];
  const boxes  = lists.boxes     || ['Box 1','Box 2','Box 3','Box 4'];
  const pays   = ['Cash','Card','Talon'];

  // Build modal if it doesn't exist (or just populate)
  let modal = document.getElementById('edit-modal');
  if (!modal) return;

  document.getElementById('edit-plate').value    = row.plateNumber;
  document.getElementById('edit-car-type').value = row.carType;
  document.getElementById('edit-wash-type').value= row.washType;
  document.getElementById('edit-box').value      = row.box;
  document.getElementById('edit-cost').value     = row.cost;
  document.getElementById('edit-payment').value  = row.paymentType==='Pending'?'Cash':row.paymentType;
  document.getElementById('edit-loyalty').value  = note.loyalty;
  document.getElementById('edit-phone').value    = note.phone;
  modal.classList.add('open');
}

function bindEditModal() {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;
  document.getElementById('close-edit-modal').addEventListener('click',closeEditModal);
  modal.addEventListener('click', e=>{ if(e.target===modal) closeEditModal(); });
  document.getElementById('edit-form').addEventListener('submit', e=>{
    e.preventDefault();
    const btn  = document.getElementById('save-edit-btn');
    const data = {
      plateNumber : document.getElementById('edit-plate').value.trim(),
      loyaltyCode : document.getElementById('edit-loyalty').value.trim(),
      phone       : document.getElementById('edit-phone').value.trim(),
      carType     : document.getElementById('edit-car-type').value,
      washType    : document.getElementById('edit-wash-type').value,
      cost        : parseFloat(document.getElementById('edit-cost').value)||0,
      paymentType : document.getElementById('edit-payment').value,
      box         : document.getElementById('edit-box').value,
      status      : 'Pending'
    };
    setLoad(btn,true);
    google.script.run
      .withSuccessHandler(res=>{
        setLoad(btn,false);
        if (res.success){ toast('✓ ჩანაწერი განახლდა','success'); closeEditModal(); loadLog(); refreshStats(); }
        else toast('შეცდომა: '+res.message,'error');
      })
      .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
      .updateEntry(S.editingRow, data);
  });
}
function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  S.editingRow=null;
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
  const pill=document.getElementById('bonus-pill');
  if (pill){ if(s.bonusReached) pill.classList.add('show'); else pill.classList.remove('show'); }
  const boxes=['Box 1','Box 2','Box 3','Box 4'];
  boxes.forEach((b,i)=>{
    const n=i+1, bd=(s.boxData||{})[b]||{salary:0,washes:0};
    setEl('box'+n+'-sal', fmt(bd.salary));
    setEl('box'+n+'-w',   bd.washes+' რეცხ.');
  });
  const pct=Math.min((s.totalRevenue/1600)*100,100);
  const bar=document.getElementById('bonus-bar-fill');
  if(bar) bar.style.width=pct.toFixed(1)+'%';
  setEl('bonus-pct-lbl', pct.toFixed(0)+'%');
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY TAB
// ═══════════════════════════════════════════════════════════════
function refreshSummary() {
  google.script.run
    .withSuccessHandler(s=>{
      setEl('sv-revenue', fmt(s.totalRevenue));
      setEl('sv-washes',  s.totalWashes);
      setEl('sv-cash',    fmt(s.cashTotal));
      setEl('sv-card',    fmt(s.cardTotal));
      setEl('sv-talon',   s.talonCount+' / '+fmt(s.talonValue));
      setEl('sv-pending', s.pendingCount+' / '+fmt(s.pendingValue));
      const boxes=['Box 1','Box 2','Box 3','Box 4'];
      boxes.forEach((b,i)=>{
        const n=i+1, bd=(s.boxData||{})[b]||{salary:0,washes:0};
        setEl('sv-b'+n+'-sal',fmt(bd.salary)); setEl('sv-b'+n+'-w',bd.washes+' რეცხ.');
      });
      const vipB=s.managerVIPBonus||0, dayB=s.bonusReached?50:0, mgrT=175+vipB+dayB;
      setEl('sv-mgr-base','175.00₾'); setEl('sv-mgr-vip',fmt(vipB));
      setEl('sv-mgr-bonus',s.bonusReached?'+50.00₾ ✓':'0.00₾');
      setEl('sv-mgr-total',fmt(mgrT));
      const pct=Math.min((s.totalRevenue/1600)*100,100);
      const bar=document.getElementById('sv-bonus-bar');
      if(bar) bar.style.width=pct.toFixed(1)+'%';
      setEl('sv-bonus-status',fmt(s.totalRevenue)+' / 1,600₾');
      setEl('sv-bonus-lbl',s.bonusReached?'🎯 ბარიერი გადალახულია! +50₾':'ბონუსამდე: '+fmt(1600-s.totalRevenue));
    })
    .withFailureHandler(()=>{})
    .getDashboardStats();
}

// ═══════════════════════════════════════════════════════════════
//  INVENTORY GRID
// ═══════════════════════════════════════════════════════════════
function addInvRow() {
  const tbody=document.getElementById('inv-grid-body');
  if(!tbody) return;
  const tr=document.createElement('tr');
  const i=tbody.rows.length+1;
  tr.innerHTML=`
    <td class="td-num">${i}</td>
    <td><input type="text"   placeholder="პროდუქტის სახელი..."></td>
    <td><input type="text"   placeholder="SKU / კოდი"></td>
    <td><input type="number" placeholder="1" min="1" value="1" style="text-align:right"></td>
    <td class="td-btn"><button class="btn btn-primary btn-icon" onclick="saveInvRow(this)">✓</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('input').focus();
}
function saveInvRow(btn) {
  const tr=btn.closest('tr');
  const inp=tr.querySelectorAll('input');
  const name=inp[0].value.trim(), id=inp[1].value.trim(), qty=parseFloat(inp[2].value)||1;
  if(!name){ inp[0].focus(); toast('სახელი სავალდებულოა','warning'); return; }
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if(res.success){
        toast('✓ გაყიდვა: '+name+' x'+qty,'success');
        tr.style.background='#F9FAFB'; inp.forEach(i=>i.disabled=true);
        btn.textContent='✓'; btn.style.background='var(--cash)';
        addInvRow();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .addInventorySale({productName:name,productId:id,quantity:qty});
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
    if(el) el.addEventListener('click',onAfterClose);
  });
}
function executeClose() {
  const btn=document.getElementById('close-shift-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if(res.success){ renderShiftModal(res.summary); document.getElementById('summary-modal').classList.add('open'); }
      else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{ setLoad(btn,false); toast(e.message,'error'); })
    .closeShift(S.managerName);
}
function renderShiftModal(s) {
  setEl('sm-date',s.date); setEl('sm-revenue',fmt(s.totalRevenue));
  setEl('sm-washes',s.totalWashes); setEl('sm-cash',fmt(s.cashTotal));
  setEl('sm-card',fmt(s.cardTotal)); setEl('sm-washer',fmt(s.washerTotal));
  setEl('sm-mgr',fmt(s.managerTotal)); setEl('sm-expenses',fmt(s.totalExpenses));
  setEl('sm-remain',fmt(s.remainCashCard)); setEl('sm-path',s.archivePath||'');
  const al=document.getElementById('sm-archive-url'); if(al) al.href=s.archiveUrl||'#';
  const ba=document.getElementById('sm-bonus-alert');
  if(ba){ if(s.bonusReached) ba.classList.add('show'); else ba.classList.remove('show'); }
}
function onAfterClose() {
  document.getElementById('summary-modal').classList.remove('open');
  S.logRows=[];
  renderLog();
  BOX_CFG.forEach(b=>clearBox(b.num));
  renderStats({totalWashes:0,cashTotal:0,cardTotal:0,talonCount:0,talonValue:0,
    pendingCount:0,pendingValue:0,vipCount:0,totalRevenue:0,bonusReached:false,boxData:{}});
}

// ── LOGOUT ───────────────────────────────────────────────────
function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click',()=>{
    if(!confirm('გამოსვლა?')) return;
    if(S.statsTimer){ clearInterval(S.statsTimer); S.statsTimer=null; }
    S.managerName=''; S.logRows=[]; S.lists=null;
    document.getElementById('app').classList.remove('visible');
    document.getElementById('start-shift-screen').classList.remove('visible');
    document.getElementById('login-screen').style.display='flex';
    document.getElementById('manager-name').value='';
    document.getElementById('pin').value='';
    ['collect-modal','confirm-modal','summary-modal','edit-modal'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.classList.remove('open');
    });
  });
}

// ── UTILS ────────────────────────────────────────────────────
function parseNotes(raw) {
  if(!raw) return{loyalty:'',phone:''};
  return{
    loyalty:((raw.match(/L:([^|]+)/)||[])[1]||'').trim(),
    phone  :((raw.match(/T:([^|]+)/)||[])[1]||'').trim()
  };
}
function fmt(n){ return (parseFloat(n)||0).toFixed(2)+'₾'; }
function p2(n) { return String(n).padStart(2,'0'); }
function setEl(id,v){ const e=document.getElementById(id); if(e) e.textContent=v; }
function esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setLoad(btn,on){
  if(!btn) return;
  if(on){ btn._t=btn.innerHTML; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true; }
  else  { btn.innerHTML=btn._t||''; btn.disabled=false; }
}
function toast(msg,type){
  type=type||'info';
  const icons={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  const el=document.createElement('div');
  el.className='toast '+type;
  el.innerHTML=`<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}
