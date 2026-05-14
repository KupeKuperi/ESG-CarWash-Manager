// ============================================================
//  ESG Car Wash Manager ERP – script.js  v11 (Native Excel Grid)
// ============================================================
'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const PRICES = {
  'სედანი'  :{'სტანდარტი':30,'VIP':80 ,'შიგნიდან':15,'გარედან':15,'ორივე':30,'სხვა':0},
  'ჯიპი'    :{'სტანდარტი':40,'VIP':120,'შიგნიდან':20,'გარედან':20,'ორივე':40,'სხვა':0},
  'ჯიპი XL' :{'სტანდარტი':50,'VIP':150,'შიგნიდან':25,'გარედან':25,'ორივე':50,'სხვა':0}
};
const GEO = {
  days  :['კვირა','ორშაბათი','სამშაბათი','ოთხშაბათი','ხუთშაბათი','პარასკევი','შაბათი'],
  months:['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი',
          'ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი']
};

// Editable columns in Tab order (payment now included)
const ECOLS = ['plate','car-type','wash-type','box','cost','loyalty','phone','payment'];
const EMPTY_ROWS_BUFFER = 100;

// ── INSTANT LOCAL STATS (reads current DOM grid, no GAS) ──────
function calcLocalStats() {
  const rows = document.querySelectorAll('#wash-tbody tr');
  let totalWashes=0, cashTotal=0, cardTotal=0, talonCount=0, talonValue=0;
  let pendingCount=0, pendingValue=0, vipCount=0, managerVIPBonus=0;
  const boxData={
    'Box 1':{salary:0,washes:0},'Box 2':{salary:0,washes:0},
    'Box 3':{salary:0,washes:0},'Box 4':{salary:0,washes:0}
  };

  rows.forEach(tr=>{
    const plate   = (tr.querySelector('[data-col="plate"]')?.value||'').trim();
    if(!plate) return;
    const cost    = parseFloat(tr.querySelector('[data-col="cost"]')?.value)||0;
    if(cost<=0) return;
    const washType= tr.querySelector('[data-col="wash-type"]')?.value||'';
    const box     = tr.querySelector('[data-col="box"]')?.value||'';
    const payment = tr.querySelector('[data-col="payment"]')?.value||'';
    const isVIP   = washType==='VIP';

    totalWashes++;
    if(isVIP){ vipCount++; managerVIPBonus+=10; }

    const earning = cost*(isVIP?0.40:0.35);
    if(boxData[box]){ boxData[box].salary+=earning; boxData[box].washes++; }

    if(!payment){ pendingCount++; pendingValue+=cost; }
    else if(payment==='Cash')  cashTotal +=cost;
    else if(payment==='Card')  cardTotal +=cost;
    else if(payment==='Talon'){ talonCount++; talonValue+=cost; }
  });

  const totalRevenue=cashTotal+cardTotal+talonValue;
  const bonusReached=totalRevenue>=1600;
  const dailyBonus=bonusReached?50:0;
  const managerTotal=100+managerVIPBonus+dailyBonus;

  return { totalWashes, cashTotal, cardTotal, talonCount, talonValue,
           pendingCount, pendingValue, vipCount, totalRevenue,
           managerVIPBonus, dailyBonus, managerTotal, bonusReached, boxData };
}

// ── RENDER SUMMARY FROM ANY STATS OBJECT (local or GAS) ───────
function renderSummaryFromStats(s){
  setEl('sv-revenue', fmt(s.totalRevenue));
  setEl('sv-washes',  s.totalWashes);
  setEl('sv-cash',    fmt(s.cashTotal));
  setEl('sv-card',    fmt(s.cardTotal));
  setEl('sv-talon',   s.talonCount+' / '+fmt(s.talonValue));
  setEl('sv-pending', s.pendingCount+' / '+fmt(s.pendingValue));
  ['Box 1','Box 2','Box 3','Box 4'].forEach((b,i)=>{
    const n=i+1, bd=(s.boxData||{})[b]||{salary:0,washes:0};
    setEl('sv-b'+n+'-sal',fmt(bd.salary));
    setEl('sv-b'+n+'-w',  bd.washes+' რეცხ.');
  });
  setEl('sv-mgr-base',  '100.00₾');
  setEl('sv-mgr-vip',   fmt(s.managerVIPBonus||0));
  setEl('sv-mgr-bonus', s.bonusReached?'+50.00₾ ✓':'0.00₾');
  setEl('sv-mgr-total', fmt(s.managerTotal||0));
  const pct=Math.min(((s.totalRevenue||0)/1600)*100,100);
  const bar=document.getElementById('sv-bonus-bar');
  if(bar) bar.style.width=pct.toFixed(1)+'%';
  setEl('sv-bonus-status',fmt(s.totalRevenue)+' / 1,600₾');
  setEl('sv-bonus-lbl', s.bonusReached
    ?'🎯 ბარიერი გადალახულია! +50₾ ბონუსი'
    :'ბონუსამდე: '+fmt(1600-(s.totalRevenue||0)));
}

// ── MASTER UPDATE — called on every cell change ────────────────
function updateAll(){
  const s=calcLocalStats();
  renderStats(s);
  // Update summary tab live if it's open
  const sumPanel=document.getElementById('tab-summary');
  if(sumPanel&&sumPanel.classList.contains('active')) renderSummaryFromStats(s);
}

// ── STATE ─────────────────────────────────────────────────────
const S = {
  managerName      : '',
  lists            : null,
  savedRows        : [],
  statsTimer       : null,
  liveRefreshTimer : null,
  collectingRowIdx : null,
  collectPay       : null,
  editingRowIdx    : null
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
  prerenderGrid();
  checkShiftOnLoad(); // decide: show live screen or login
});

// ── CLOCK ─────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const n=new Date(), hh=p2(n.getHours()), mm=p2(n.getMinutes()), ss=p2(n.getSeconds());
    const ds=GEO.days[n.getDay()];
    const dt=n.getDate()+' '+GEO.months[n.getMonth()]+' '+n.getFullYear();
    setEl('hdr-hh',hh);setEl('hdr-mm',mm);setEl('hdr-ss',ss);
    setEl('hdr-date',ds+', '+dt);
    setEl('ss-hh',hh);setEl('ss-mm',mm);setEl('ss-ss',ss);
    setEl('ss-day-name',ds);setEl('ss-date-str',dt);
    // Live screen clock
    setEl('ls-hh',hh);setEl('ls-mm',mm);setEl('ls-ss',ss);
    setEl('ls-date',ds+', '+dt);
  }
  tick(); setInterval(tick,1000);
}

// ═══════════════════════════════════════════════════════════════
//  SHIFT STATE CHECK + LIVE SCREEN
// ═══════════════════════════════════════════════════════════════

// Called on page load — decides whether to show live screen or login
function checkShiftOnLoad() {
  google.script.run
    .withSuccessHandler(status => {
      if (status && status.active) {
        S.managerName = status.managerName;
        showLiveScreen(status);
      }
      // else login screen stays visible (default)
    })
    .withFailureHandler(() => { /* leave login screen as default */ })
    .isShiftActive();
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('start-shift-screen').classList.remove('visible');
  document.getElementById('app').classList.remove('visible');
  document.getElementById('live-screen').classList.remove('visible');
}

function showLiveScreen(status) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('start-shift-screen').classList.remove('visible');
  document.getElementById('app').classList.remove('visible');
  document.getElementById('live-screen').classList.add('visible');
  if (status) {
    setEl('ls-manager', status.managerName || '—');
    if (status.shiftStart) {
      const d = new Date(status.shiftStart);
      setEl('ls-shift-start', p2(d.getHours()) + ':' + p2(d.getMinutes()));
    }
  }
  loadLiveData();
  startLiveRefresh();
}

function hideLiveScreen() {
  document.getElementById('live-screen').classList.remove('visible');
  stopLiveRefresh();
}

function startLiveRefresh() {
  stopLiveRefresh();
  S.liveRefreshTimer = setInterval(loadLiveData, 15000);
}

function stopLiveRefresh() {
  if (S.liveRefreshTimer) { clearInterval(S.liveRefreshTimer); S.liveRefreshTimer = null; }
}

function loadLiveData() {
  google.script.run
    .withSuccessHandler(data => {
      if (!data || !data.active) {
        hideLiveScreen();
        showLoginScreen();
        return;
      }
      renderLiveData(data);
    })
    .withFailureHandler(() => {})
    .getLiveViewData();
}

function renderLiveData(data) {
  const s = data.stats || {};
  setEl('ls-revenue', fmt(s.totalRevenue));
  setEl('ls-washes',  s.totalWashes || 0);
  setEl('ls-cash',    fmt(s.cashTotal));
  setEl('ls-card',    fmt(s.cardTotal));
  setEl('ls-talon',   (s.talonCount || 0) + ' / ' + fmt(s.talonValue));
  setEl('ls-pending', (s.pendingCount || 0) + (s.pendingValue > 0 ? ' / ' + fmt(s.pendingValue) : ''));

  ['Box 1','Box 2','Box 3','Box 4'].forEach((b, i) => {
    const n = i + 1;
    const bd = (s.boxData || {})[b] || { salary:0, washes:0 };
    setEl('ls-b'+n+'-sal', fmt(bd.salary));
    setEl('ls-b'+n+'-w',   bd.washes + ' რეცხ.');
  });

  const pct = Math.min(((s.totalRevenue || 0) / 1600) * 100, 100);
  const bar = document.getElementById('ls-bonus-bar');
  if (bar) bar.style.width = pct.toFixed(1) + '%';
  setEl('ls-bonus-status', fmt(s.totalRevenue) + ' / 1,600₾');
  setEl('ls-bonus-lbl', s.bonusReached
    ? '🎯 ბარიერი გადალახულია! +50₾ ბონუსი'
    : 'ბონუსამდე: ' + fmt(1600 - (s.totalRevenue || 0)));

  if (data.allEntries) renderLiveLog(data.allEntries);
}

function renderLiveLog(entries) {
  const tbody = document.getElementById('ls-log-tbody');
  if (!tbody) return;
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#5A6A85;padding:24px">მობანებები ჯერ არ არის</td></tr>';
    return;
  }
  const BOX_COLORS = { 'Box 1':'#3B82F6','Box 2':'#059669','Box 3':'#D97706','Box 4':'#7C3AED' };
  tbody.innerHTML = entries.map((r, i) => {
    const isPending = r.status === 'Pending';
    const payDisplay = isPending ? '⏳ ტაბი' : (r.paymentType || '—');
    const bColor = BOX_COLORS[r.box] || '#8A9BBE';
    return `<tr class="${isPending ? 'ls-row-pending' : ''}">
      <td style="color:#5A6A85">${i + 1}</td>
      <td class="ls-plate">${esc(r.plateNumber)}</td>
      <td>${esc(r.carType)}</td>
      <td style="${r.washType==='VIP'?'color:#FFD700;font-weight:700':''}">${esc(r.washType)}</td>
      <td><span style="color:${bColor};font-weight:700">${esc(r.box)}</span></td>
      <td style="text-align:right;font-weight:700;color:#E2EAF4">${r.cost}₾</td>
      <td style="color:${isPending?'#F59E0B':'#A3B8CC'}">${payDisplay}</td>
      <td style="color:#5A6A85">${esc(r.timestamp)}</td>
    </tr>`;
  }).join('');
}

// ── ADMIN PIN OVERLAY ──────────────────────────────────────────
function showAdminPinOverlay() {
  document.getElementById('admin-pin-input').value = '';
  const err = document.getElementById('admin-pin-error');
  err.textContent = ''; err.classList.remove('show');
  document.getElementById('admin-pin-overlay').classList.add('open');
  setTimeout(() => document.getElementById('admin-pin-input').focus(), 80);
}

function hideAdminPinOverlay() {
  document.getElementById('admin-pin-overlay').classList.remove('open');
}

function unlockAdminFromLive() {
  const pin = document.getElementById('admin-pin-input').value.trim();
  if (!pin) return;
  const btn = document.getElementById('admin-pin-btn');
  setLoad(btn, true);
  google.script.run
    .withSuccessHandler(res => {
      setLoad(btn, false);
      if (res.success) {
        hideAdminPinOverlay();
        hideLiveScreen();
        S.managerName = res.managerName;
        document.getElementById('app').classList.add('visible');
        setEl('manager-name-display', res.managerName);
        const d = new Date(res.shiftStart || Date.now());
        setEl('hdr-shift-info', 'ცვლა: ' + p2(d.getHours()) + ':' + p2(d.getMinutes()));
        initApp();
        toast('✓ Admin View – ' + res.managerName + 'ს ცვლა', 'info');
      } else {
        const err = document.getElementById('admin-pin-error');
        err.textContent = res.message; err.classList.add('show');
      }
    })
    .withFailureHandler(e => {
      setLoad(btn, false);
      const err = document.getElementById('admin-pin-error');
      err.textContent = e.message; err.classList.add('show');
    })
    .unlockAdminView(pin);
}

// ── LOGIN ─────────────────────────────────────────────────────
function bindLogin() {
  const form=document.getElementById('login-form');
  const btn =document.getElementById('login-btn');
  const pin =document.getElementById('pin');
  pin.addEventListener('input',()=>{pin.value=pin.value.replace(/\D/g,'').slice(0,6);});
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const name=document.getElementById('manager-name').value.trim();
    if(!name){showLoginErr('სახელი სავალდებულოა');return;}
    if(!pin.value){showLoginErr('PIN სავალდებულოა');return;}
    setLoad(btn,true);
    google.script.run
      .withSuccessHandler(r=>{setLoad(btn,false);if(r.success)onLoginOK(r.managerName);else showLoginErr(r.message);})
      .withFailureHandler(e=>{setLoad(btn,false);showLoginErr(e.message);})
      .login(name,pin.value);
  });
}
function showLoginErr(m){const e=document.getElementById('login-error');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),4000);}
function onLoginOK(name){
  S.managerName=name;
  document.getElementById('pin').value='';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('start-shift-screen').classList.add('visible');
  setEl('ss-manager-name',name);
  const av=document.getElementById('ss-avatar');
  if(av) av.textContent=name.charAt(0).toUpperCase();
}

// ── START SHIFT ───────────────────────────────────────────────
function bindStartShift(){
  const btn=document.getElementById('start-shift-btn');
  if(!btn) return;
  btn.addEventListener('click',()=>{
    setLoad(btn,true);
    google.script.run
      .withSuccessHandler(()=>{
        setLoad(btn,false);
        document.getElementById('start-shift-screen').classList.remove('visible');
        document.getElementById('app').classList.add('visible');
        setEl('manager-name-display',S.managerName);
        const n=new Date();setEl('hdr-shift-info','ცვლა: '+p2(n.getHours())+':'+p2(n.getMinutes()));
        initApp();
        toast('✓ ცვლა დაიწყო · '+p2(n.getHours())+':'+p2(n.getMinutes()),'success');
      })
      .withFailureHandler(e=>{setLoad(btn,false);toast(e.message,'error');})
      .setShiftStart(S.managerName);
  });
}

// ── APP INIT ──────────────────────────────────────────────────
function initApp(){
  google.script.run
    .withSuccessHandler(lists=>{
      S.lists=lists;
      loadAndRenderGrid(); // buildGrid() inside calls updateAll() when done
    })
    .withFailureHandler(e=>toast('შეცდომა: '+e.message,'error'))
    .getListsData();
}

// ── TAB ───────────────────────────────────────────────────────
function switchTab(name){
  document.querySelectorAll('.tab-panel').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelector('.tab-btn[data-tab="'+name+'"]').classList.add('active');
  if(name==='summary') renderSummaryFromStats(calcLocalStats()); // instant, no GAS
}

// ═══════════════════════════════════════════════════════════════
//  EXCEL GRID
// ═══════════════════════════════════════════════════════════════

const CAR_TYPES  = ['სედანი','ჯიპი','ჯიპი XL'];
const WASH_TYPES = ['სტანდარტი','VIP','შიგნიდან','გარედან','ორივე','სხვა'];
const BOXES      = ['Box 1','Box 2','Box 3','Box 4'];

// ── PRE-RENDER PLACEHOLDER (shown before GAS data arrives) ──
function prerenderGrid(){
  buildGrid([], EMPTY_ROWS_BUFFER);
  bindGridKeyboard();
}

// ── LOAD ENTRIES AND RENDER ──────────────────────────────────
function loadAndRenderGrid(){
  google.script.run
    .withSuccessHandler(rows=>{
      S.savedRows=rows||[];
      buildGrid(S.savedRows, EMPTY_ROWS_BUFFER);
      bindGridKeyboard(); // re-bind after rebuild
      // Focus first empty plate cell
      const firstEmpty=document.querySelector('#wash-tbody tr.is-empty [data-col="plate"]');
      if(firstEmpty) firstEmpty.focus();
    })
    .withFailureHandler(()=>{})
    .getAllEntries();
}

// ── BUILD THE FULL GRID ──────────────────────────────────────
function buildGrid(savedEntries, emptyCount){
  const tbody=document.getElementById('wash-tbody');
  if(!tbody) return;
  const scrollTop=tbody.closest('.egrid-wrap').scrollTop;
  tbody.innerHTML='';

  // 1. Saved rows (chronological, oldest first = row 1)
  savedEntries.forEach((r,i)=>{
    tbody.appendChild(makeFilledRow(r, i+1));
  });

  // 2. Empty buffer rows
  const startNum=savedEntries.length+1;
  for(let i=0;i<emptyCount;i++){
    tbody.appendChild(makeEmptyRow(startNum+i));
  }

  tbody.closest('.egrid-wrap').scrollTop=scrollTop;
  // Recalculate from fresh DOM
  updateAll();
}

// ── MAKE A FILLED (SAVED) ROW ─────────────────────────────────
function makeFilledRow(r, rowNum){
  const tr=document.createElement('tr');
  const isPending=(r.status||'Pending')==='Pending';
  const isVIP=r.washType==='VIP';
  const boxCls=boxClass(r.box);
  const paidCls=isPending?'':payClass(r.paymentType);
  tr.className=[boxCls,paidCls,isVIP?'is-vip':''].filter(Boolean).join(' ');
  tr.dataset.rowIdx=r.rowIndex;
  tr.dataset.state=isPending?'pending':'paid';
  tr.dataset.dirty='false';

  const note=parseNotes(r.notes);
  const boxN=parseInt((r.box||'').replace(/\D/g,''));
  const boxTdCls=boxN>=1&&boxN<=4?'bc-'+boxN:'';
  const payTdCls=isPending?'':('pc-'+(r.paymentType||'').toLowerCase());
  const currentPay=isPending?'':r.paymentType;

  tr.innerHTML=`
    <td class="col-num">${rowNum}</td>
    <td><input data-col="plate"     value="${esc(r.plateNumber)}" style="text-transform:uppercase;font-weight:600" onchange="dirtyRow(this)" onkeydown="onRowKey(event,this)"></td>
    <td><select data-col="car-type"  onchange="onBoxOrTypeChange(this)" onkeydown="onRowKey(event,this)">${carOpts(r.carType)}</select></td>
    <td class="${isVIP?'vip-cell':''}"><select data-col="wash-type" onchange="onBoxOrTypeChange(this)" onkeydown="onRowKey(event,this)">${washOpts(r.washType)}</select></td>
    <td class="${boxTdCls}"><select data-col="box" onchange="onBoxSelectChange(this)" onkeydown="onRowKey(event,this)">${boxOpts(r.box)}</select></td>
    <td><input data-col="cost"       value="${r.cost}" type="number" min="0" step="1" onchange="dirtyRow(this)" oninput="updateAll()" onkeydown="onRowKey(event,this)"></td>
    <td><input data-col="loyalty"    value="${esc(note.loyalty)}" placeholder="კოდი" onchange="dirtyRow(this)" onkeydown="onRowKey(event,this)" onblur="triggerLoyalty(this)"></td>
    <td><input data-col="phone"      value="${esc(note.phone)}"   placeholder="+995..." onchange="dirtyRow(this)" onkeydown="onRowKey(event,this)"></td>
    <td class="${payTdCls}"><select data-col="payment" onchange="onPaymentChange(this)" onkeydown="onRowKey(event,this)">${payOpts(currentPay)}</select></td>
    <td class="col-ro" style="text-align:center;font-size:11px">${esc(r.timestamp)}</td>
    <td class="col-action"><button class="row-edit-btn" onclick="openEditFromLog(${r.rowIndex})">✏</button></td>`;
  return tr;
}

// ── MAKE AN EMPTY ROW ─────────────────────────────────────────
function makeEmptyRow(rowNum){
  const tr=document.createElement('tr');
  tr.className='is-empty';
  tr.dataset.state='new';
  tr.dataset.dirty='false';

  tr.innerHTML=`
    <td class="col-num" style="color:#C9CDD4">${rowNum}</td>
    <td><input data-col="plate"     placeholder="AA-000-BB" style="text-transform:uppercase" oninput="onEmptyPlateInput(this)" onkeydown="onRowKey(event,this)"></td>
    <td><select data-col="car-type"  onchange="onBoxOrTypeChange(this)" onkeydown="onRowKey(event,this)">${carOpts()}</select></td>
    <td><select data-col="wash-type" onchange="onBoxOrTypeChange(this)" onkeydown="onRowKey(event,this)">${washOpts()}</select></td>
    <td><select data-col="box"       onchange="onBoxSelectChange(this)" onkeydown="onRowKey(event,this)">${boxOpts()}</select></td>
    <td><input data-col="cost"       placeholder="0" type="number" min="0" step="1" oninput="updateAll()" onkeydown="onRowKey(event,this)"></td>
    <td><input data-col="loyalty"    placeholder="ლოიალ." onkeydown="onRowKey(event,this)"></td>
    <td><input data-col="phone"      placeholder="+995..." onkeydown="onRowKey(event,this)"></td>
    <td><select data-col="payment"   onchange="onPaymentChange(this)" onkeydown="onRowKey(event,this)">${payOpts()}</select></td>
    <td class="col-ro"></td>
    <td class="col-action"></td>`;
  return tr;
}

// ── KEYBOARD NAVIGATION ───────────────────────────────────────
function bindGridKeyboard(){
  const tbody=document.getElementById('wash-tbody');
  if(!tbody) return;
  // Unbind old listener then rebind
  tbody.removeEventListener('keydown', _gridKeyHandler);
  tbody.addEventListener('keydown', _gridKeyHandler);
}

// Defined as named fn so we can removeEventListener
function _gridKeyHandler(e){
  const target=e.target;
  if(!target.matches('input,select')) return;
  if(e.key==='Tab'||e.key==='Enter'||e.key==='ArrowDown'||e.key==='ArrowUp') {
    onRowKey(e, target);
  }
}

function onRowKey(e, el){
  if(!['Tab','Enter','ArrowDown','ArrowUp'].includes(e.key)) return;
  const td  = el.closest('td');
  const tr  = el.closest('tr');
  const col = el.dataset.col;

  if(e.key==='ArrowDown'){
    e.preventDefault();
    moveToRow(tr,'next',col); return;
  }
  if(e.key==='ArrowUp'){
    e.preventDefault();
    moveToRow(tr,'prev',col); return;
  }
  // Tab / Enter
  if(e.key==='Enter'){
    e.preventDefault();
    maybeSaveRow(tr);
    moveToRow(tr,'next','plate');
    return;
  }
  if(e.key==='Tab'){
    const idx=ECOLS.indexOf(col);
    if(!e.shiftKey){
      if(idx<ECOLS.length-1){
        e.preventDefault();
        focusCol(tr,ECOLS[idx+1]);
      } else {
        // Tab past last column → save + next row
        e.preventDefault();
        maybeSaveRow(tr);
        moveToRow(tr,'next','plate');
      }
    } else {
      // Shift+Tab backward
      if(idx>0){
        e.preventDefault();
        focusCol(tr,ECOLS[idx-1]);
      } else {
        e.preventDefault();
        moveToRow(tr,'prev','phone');
      }
    }
  }
}

function focusCol(tr, col){
  const el=tr.querySelector(`[data-col="${col}"]`);
  if(el){el.focus();if(el.tagName==='INPUT')el.select();}
}

function moveToRow(tr, dir, col){
  const next=dir==='next'?tr.nextElementSibling:tr.previousElementSibling;
  if(next) focusCol(next, col);
}

// ── EMPTY ROW: plate typed → mark as "filling" ──────────────
function onEmptyPlateInput(input){
  const tr=input.closest('tr');
  const val=input.value.trim();
  if(val){
    tr.classList.remove('is-empty');
    autoPrice(tr);
  } else {
    tr.classList.add('is-empty');
    tr.classList.remove('bx-1','bx-2','bx-3','bx-4');
  }
  updateAll(); // instant tracker update as plate is typed
}

// ── CAR TYPE / WASH TYPE change → auto-price + VIP tint ──────
function onBoxOrTypeChange(sel){
  const tr=sel.closest('tr');
  autoPrice(tr);
  if(sel.dataset.col==='wash-type'){
    const td=sel.closest('td');
    sel.value==='VIP'?td.classList.add('vip-cell'):td.classList.remove('vip-cell');
    tr.classList.toggle('is-vip',sel.value==='VIP');
  }
  dirtyRow(sel);
}

// ── BOX SELECT change → colour the box TD + update row tint ──
function onBoxSelectChange(sel){
  const tr=sel.closest('tr');
  const td=sel.closest('td');
  // Colour the box TD itself
  td.classList.remove('bc-1','bc-2','bc-3','bc-4');
  const n=parseInt((sel.value||'').replace(/\D/g,''));
  if(n>=1&&n<=4) td.classList.add('bc-'+n);
  // Row background tint
  tr.classList.remove('bx-1','bx-2','bx-3','bx-4');
  if(n>=1&&n<=4) tr.classList.add('bx-'+n);
  autoPrice(tr);
  dirtyRow(sel); // dirtyRow already calls updateAll()
}

// ── PAYMENT SELECT change → colour pay TD, auto-mark paid ─────
function onPaymentChange(sel){
  const tr=sel.closest('tr');
  const td=sel.closest('td');
  const val=sel.value;

  // Colour the payment TD
  td.classList.remove('pc-cash','pc-card','pc-talon');
  if(val==='Cash')  td.classList.add('pc-cash');
  if(val==='Card')  td.classList.add('pc-card');
  if(val==='Talon') td.classList.add('pc-talon');

  // Instant tracker + summary update
  updateAll();

  // If this is a saved PENDING row and payment is selected → mark as Paid now
  const rowIdx=parseInt(tr.dataset.rowIdx);
  if(tr.dataset.state==='pending' && val && !isNaN(rowIdx)){
    google.script.run
      .withSuccessHandler(res=>{
        if(res.success){
          tr.dataset.state='paid';
          // Row paid colour
          tr.classList.remove('bx-1','bx-2','bx-3','bx-4');
          const box=tr.querySelector('[data-col="box"]')?.value;
          const bc=boxClass(box); if(bc) tr.classList.add(bc);
          tr.classList.remove('paid-cash','paid-card','paid-talon');
          tr.classList.add('paid-'+val.toLowerCase());
          updateAll(); // recount from DOM — instant, no GAS round-trip
          toast('✓ '+val+' — გადახდა მიღებულია','success');
        }
      })
      .withFailureHandler(()=>{})
      .markAsPaid(rowIdx, val);
  }

  dirtyRow(sel);
}

function autoPrice(tr){
  const ct=tr.querySelector('[data-col="car-type"]')?.value;
  const wt=tr.querySelector('[data-col="wash-type"]')?.value;
  const costEl=tr.querySelector('[data-col="cost"]');
  if(!costEl) return;
  const p=(PRICES[ct]||{})[wt];
  if(p!==undefined && (!costEl.value||costEl.value==='0')) costEl.value=p;
}

function dirtyRow(el){ const tr=el.closest('tr'); if(tr) tr.dataset.dirty='true'; updateAll(); }

// ── SAVE ROW (called on Enter / Tab-past-last) ────────────────
function maybeSaveRow(tr){
  const plate=tr.querySelector('[data-col="plate"]')?.value.trim().toUpperCase();
  if(!plate) return;

  const state=tr.dataset.state||'new';

  if(state==='new'){
    submitNewRow(tr, plate);
  } else if(tr.dataset.dirty==='true'){
    updateExistingRow(tr);
  }
}

function submitNewRow(tr, plate){
  const payVal=tr.querySelector('[data-col="payment"]')?.value||'';
  const data={
    plateNumber: plate,
    carType    : tr.querySelector('[data-col="car-type"]').value,
    washType   : tr.querySelector('[data-col="wash-type"]').value,
    box        : tr.querySelector('[data-col="box"]').value,
    cost       : parseFloat(tr.querySelector('[data-col="cost"]').value)||0,
    loyaltyCode: tr.querySelector('[data-col="loyalty"]').value.trim(),
    phone      : tr.querySelector('[data-col="phone"]').value.trim(),
    paymentType: payVal||'Pending',
    status     : payVal?'Paid':'Pending'
  };
  if(data.cost<=0){ toast('თანხა ჩაწერეთ','warning'); tr.querySelector('[data-col="cost"]').focus(); return; }

  // Temporarily mark to avoid double-save
  tr.dataset.state='saving';

  google.script.run
    .withSuccessHandler(res=>{
      if(res.success){
        toast('⏳ '+plate+' — ტაბზე','success');
        // Loyalty sync
        if(data.loyaltyCode){
          google.script.run
            .withSuccessHandler(lr=>{if(lr&&lr.success)toast('🎫 ლოიალობა განახლდა','info');})
            .withFailureHandler(()=>{})
            .updateLoyalty(data.loyaltyCode);
        }
        // Refresh grid (reloads from GAS) — keeps focus via next-row navigation
        loadAndRenderGrid(); // rebuilds grid → updateAll() recalculates stats
      } else {
        tr.dataset.state='new';
        toast('შეცდომა: '+res.message,'error');
      }
    })
    .withFailureHandler(e=>{ tr.dataset.state='new'; toast(e.message,'error'); })
    .addEntry(data);
}

function updateExistingRow(tr){
  const rowIdx=parseInt(tr.dataset.rowIdx);
  if(isNaN(rowIdx)) return;
  const note=parseNotes(''); // existing loyalty / phone from inputs
  const data={
    plateNumber: tr.querySelector('[data-col="plate"]').value.trim(),
    carType    : tr.querySelector('[data-col="car-type"]').value,
    washType   : tr.querySelector('[data-col="wash-type"]').value,
    box        : tr.querySelector('[data-col="box"]').value,
    cost       : parseFloat(tr.querySelector('[data-col="cost"]').value)||0,
    loyaltyCode: tr.querySelector('[data-col="loyalty"]').value.trim(),
    phone      : tr.querySelector('[data-col="phone"]').value.trim(),
    paymentType: S.savedRows[rowIdx]?.paymentType||'Pending',
    status     : tr.dataset.state||'pending'
  };
  tr.dataset.dirty='false';
  google.script.run
    .withSuccessHandler(()=>{})
    .withFailureHandler(()=>{})
    .updateEntry(rowIdx, data);
}

// ── LOYALTY TRIGGER ───────────────────────────────────────────
function triggerLoyalty(input){
  const code=input.value.trim();
  if(!code) return;
  google.script.run
    .withSuccessHandler(r=>{if(r&&r.success)toast('🎫 '+r.userName+' – ლოიალობა განახლდა','info');})
    .withFailureHandler(()=>{})
    .updateLoyalty(code);
}

// ── SELECT OPTION BUILDERS  (all start with blank "—") ───────
function carOpts(sel){
  return `<option value="">—</option>`+CAR_TYPES.map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}
function washOpts(sel){
  return `<option value="">—</option>`+WASH_TYPES.map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}
function boxOpts(sel){
  return `<option value="">—</option>`+BOXES.map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}
function payOpts(sel){
  const pays=['Cash','Card','Talon'];
  return `<option value="">—</option>`+pays.map(v=>`<option${v===sel?' selected':''}>${v}</option>`).join('');
}

// ── BOX / PAY CLASS HELPERS ───────────────────────────────────
function boxClass(box){
  const n=parseInt((box||'').replace(/\D/g,''));
  return n>=1&&n<=4?'bx-'+n:'';
}
function payClass(payment){
  const map={Cash:'paid-cash',Card:'paid-card',Talon:'paid-talon'};
  return map[payment]||'';
}

// ═══════════════════════════════════════════════════════════════
//  COLLECT PAYMENT  (from shift log pending entry)
// ═══════════════════════════════════════════════════════════════
function openCollectFromLog(rowIdx, plate, cost){
  S.collectingRowIdx=rowIdx; S.collectPay=null;
  setEl('collect-modal-title','💰 '+plate+' – '+cost+'₾');
  document.querySelectorAll('.pay-option').forEach(el=>el.classList.remove('sel'));
  document.getElementById('confirm-pay-btn').disabled=true;
  document.getElementById('collect-modal').classList.add('open');
}
function closeCollectModal(){
  document.getElementById('collect-modal').classList.remove('open');
  S.collectingRowIdx=null; S.collectPay=null;
}
function selectPay(type){
  S.collectPay=type;
  document.querySelectorAll('.pay-option').forEach(el=>{
    const lbl=el.querySelector('.po-lbl').textContent;
    el.classList.toggle('sel',(type==='Cash'&&lbl==='Cash')||(type==='Card'&&lbl==='ბარათი')||(type==='Talon'&&lbl==='ტალონი'));
  });
  document.getElementById('confirm-pay-btn').disabled=false;
}
function onConfirmPay(){
  if(S.collectingRowIdx===null||!S.collectPay) return;
  const btn=document.getElementById('confirm-pay-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if(res.success){
        toast('✓ '+S.collectPay+' – გადახდა მიღებულია','success');
        closeCollectModal();
        loadAndRenderGrid();
        refreshStats();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{setLoad(btn,false);toast(e.message,'error');})
    .markAsPaid(S.collectingRowIdx, S.collectPay);
}

// ═══════════════════════════════════════════════════════════════
//  EDIT MODAL
// ═══════════════════════════════════════════════════════════════
function openEditFromLog(rowIdx){
  const r=S.savedRows[rowIdx];
  if(!r) return;
  S.editingRowIdx=rowIdx;
  const note=parseNotes(r.notes);
  document.getElementById('edit-plate').value    =r.plateNumber;
  document.getElementById('edit-car-type').value =r.carType;
  document.getElementById('edit-wash-type').value=r.washType;
  document.getElementById('edit-box').value      =r.box;
  document.getElementById('edit-cost').value     =r.cost;
  document.getElementById('edit-payment').value  =r.paymentType==='Pending'?'Cash':r.paymentType;
  document.getElementById('edit-loyalty').value  =note.loyalty;
  document.getElementById('edit-phone').value    =note.phone;
  document.getElementById('edit-modal').classList.add('open');
}
function bindEditModal(){
  const modal=document.getElementById('edit-modal');
  if(!modal) return;
  document.getElementById('close-edit-modal').addEventListener('click',closeEditModal);
  modal.addEventListener('click',e=>{if(e.target===modal)closeEditModal();});
  document.getElementById('edit-form').addEventListener('submit',e=>{
    e.preventDefault();
    const btn=document.getElementById('save-edit-btn');
    const data={
      plateNumber:document.getElementById('edit-plate').value.trim(),
      loyaltyCode:document.getElementById('edit-loyalty').value.trim(),
      phone      :document.getElementById('edit-phone').value.trim(),
      carType    :document.getElementById('edit-car-type').value,
      washType   :document.getElementById('edit-wash-type').value,
      cost       :parseFloat(document.getElementById('edit-cost').value)||0,
      paymentType:document.getElementById('edit-payment').value,
      box        :document.getElementById('edit-box').value,
      status     :'Pending'
    };
    setLoad(btn,true);
    google.script.run
      .withSuccessHandler(res=>{
        setLoad(btn,false);
        if(res.success){toast('✓ ჩანაწერი განახლდა','success');closeEditModal();loadAndRenderGrid();refreshStats();}
        else toast('შეცდომა: '+res.message,'error');
      })
      .withFailureHandler(e=>{setLoad(btn,false);toast(e.message,'error');})
      .updateEntry(S.editingRowIdx,data);
  });
}
function closeEditModal(){document.getElementById('edit-modal').classList.remove('open');S.editingRowIdx=null;}

// ═══════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════
function refreshStats(){
  google.script.run.withSuccessHandler(renderStats).withFailureHandler(()=>{}).getDashboardStats();
}
function renderStats(s){
  setEl('st-washes', s.totalWashes);
  setEl('st-cash',   fmt(s.cashTotal));
  setEl('st-card',   fmt(s.cardTotal));
  setEl('st-pending',s.pendingCount+(s.pendingValue>0?' / '+fmt(s.pendingValue):''));
  setEl('st-vip',    s.vipCount);
  setEl('st-revenue',fmt(s.totalRevenue));
  const pill=document.getElementById('bonus-pill');
  if(pill){if(s.bonusReached)pill.classList.add('show');else pill.classList.remove('show');}
  ['Box 1','Box 2','Box 3','Box 4'].forEach((b,i)=>{
    const n=i+1,bd=(s.boxData||{})[b]||{salary:0,washes:0};
    setEl('box'+n+'-sal',fmt(bd.salary));setEl('box'+n+'-w',bd.washes+' რეცხ.');
  });
  const pct=Math.min((s.totalRevenue/1600)*100,100);
  const bar=document.getElementById('bonus-bar-fill');if(bar)bar.style.width=pct.toFixed(1)+'%';
  setEl('bonus-pct-lbl',pct.toFixed(0)+'%');
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY TAB
// ═══════════════════════════════════════════════════════════════
function refreshSummary(){
  renderSummaryFromStats(calcLocalStats());
}

// ═══════════════════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════════════════
function addInvRow(){
  const tbody=document.getElementById('inv-grid-body');if(!tbody) return;
  const tr=document.createElement('tr');
  const i=tbody.rows.length+1;
  tr.innerHTML=`<td class="td-num">${i}</td>
    <td><input type="text"   placeholder="პროდუქტის სახელი..."></td>
    <td><input type="text"   placeholder="SKU / კოდი"></td>
    <td><input type="number" placeholder="1" min="1" value="1" style="text-align:right"></td>
    <td class="td-btn"><button class="btn btn-primary btn-icon" onclick="saveInvRow(this)">✓</button></td>`;
  tbody.appendChild(tr);tr.querySelector('input').focus();
}
function saveInvRow(btn){
  const tr=btn.closest('tr');
  const inp=tr.querySelectorAll('input');
  const name=inp[0].value.trim(),id=inp[1].value.trim(),qty=parseFloat(inp[2].value)||1;
  if(!name){inp[0].focus();toast('სახელი სავალდებულოა','warning');return;}
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if(res.success){
        toast('✓ '+name+' x'+qty,'success');
        tr.style.background='#F9FAFB';inp.forEach(i=>i.disabled=true);
        btn.textContent='✓';btn.style.background='var(--cash)';
        addInvRow();
      } else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{setLoad(btn,false);toast(e.message,'error');})
    .addInventorySale({productName:name,productId:id,quantity:qty});
}

// ═══════════════════════════════════════════════════════════════
//  CLOSE SHIFT
// ═══════════════════════════════════════════════════════════════
function bindShiftClose(){
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
    if(el)el.addEventListener('click',onAfterClose);
  });
}
function executeClose(){
  const btn=document.getElementById('close-shift-btn');
  setLoad(btn,true);
  google.script.run
    .withSuccessHandler(res=>{
      setLoad(btn,false);
      if(res.success){renderShiftModal(res.summary);document.getElementById('summary-modal').classList.add('open');}
      else toast('შეცდომა: '+res.message,'error');
    })
    .withFailureHandler(e=>{setLoad(btn,false);toast(e.message,'error');})
    .closeShift(S.managerName);
}
function renderShiftModal(s){
  setEl('sm-date',s.date);setEl('sm-revenue',fmt(s.totalRevenue));
  setEl('sm-washes',s.totalWashes);setEl('sm-cash',fmt(s.cashTotal));
  setEl('sm-card',fmt(s.cardTotal));setEl('sm-washer',fmt(s.washerTotal));
  setEl('sm-mgr',fmt(s.managerTotal));setEl('sm-expenses',fmt(s.totalExpenses));
  setEl('sm-remain',fmt(s.remainCashCard));setEl('sm-path',s.archivePath||'');
  const al=document.getElementById('sm-archive-url');if(al)al.href=s.archiveUrl||'#';
  const ba=document.getElementById('sm-bonus-alert');
  if(ba){if(s.bonusReached)ba.classList.add('show');else ba.classList.remove('show');}
}
function onAfterClose(){
  document.getElementById('summary-modal').classList.remove('open');
  S.managerName=''; S.savedRows=[]; S.lists=null;
  document.getElementById('app').classList.remove('visible');
  buildGrid([], 100);
  bindGridKeyboard();
  renderStats({totalWashes:0,cashTotal:0,cardTotal:0,talonCount:0,talonValue:0,
    pendingCount:0,pendingValue:0,vipCount:0,totalRevenue:0,bonusReached:false,boxData:{}});
  // Shift is over — return to login
  showLoginScreen();
  document.getElementById('manager-name').value='';
  document.getElementById('pin').value='';
}

// ── LOGOUT ───────────────────────────────────────────────────
function bindLogout(){
  document.getElementById('logout-btn').addEventListener('click',()=>{
    if(!confirm('გამოსვლა?')) return;
    S.managerName='';S.savedRows=[];S.lists=null;
    document.getElementById('app').classList.remove('visible');
    document.getElementById('start-shift-screen').classList.remove('visible');
    document.getElementById('manager-name').value='';
    document.getElementById('pin').value='';
    ['collect-modal','confirm-modal','summary-modal','edit-modal'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.classList.remove('open');
    });
    // If shift still active → live screen; else → login
    google.script.run
      .withSuccessHandler(status=>{
        if(status&&status.active){
          S.managerName=status.managerName;
          showLiveScreen(status);
        } else {
          showLoginScreen();
        }
      })
      .withFailureHandler(()=>showLoginScreen())
      .isShiftActive();
  });
}

// ─── UTILS ────────────────────────────────────────────────────
function parseNotes(raw){
  if(!raw)return{loyalty:'',phone:''};
  return{loyalty:((raw.match(/L:([^|]+)/)||[])[1]||'').trim(),
         phone  :((raw.match(/T:([^|]+)/)||[])[1]||'').trim()};
}
function fmt(n){return(parseFloat(n)||0).toFixed(2)+'₾';}
function p2(n){return String(n).padStart(2,'0');}
function setEl(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function setLoad(btn,on){if(!btn)return;if(on){btn._t=btn.innerHTML;btn.innerHTML='<span class="spinner"></span>';btn.disabled=true;}else{btn.innerHTML=btn._t||'';btn.disabled=false;}}
function toast(msg,type){
  type=type||'info';const icons={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  const el=document.createElement('div');el.className='toast '+type;
  el.innerHTML=`<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);setTimeout(()=>el.remove(),3800);
}
