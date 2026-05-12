// ============================================================
//  ESG Car Wash Manager Terminal – script.js  v4
// ============================================================
'use strict';

const STATE = {
  managerName   : '',
  lists         : null,
  sessionSales  : [],
  editingRow    : null,
  collectingRow : null,
  collectPayment: null,
  statsTimer    : null,
  webAppUrl     : ''
};

const PRICES = {
  'სედანი'  : { 'სტანდარტი':30,'VIP':80,'შიგნიდან':15,'გარედან':15,'ორივე':30,'სხვა':0 },
  'ჯიპი'    : { 'სტანდარტი':40,'VIP':120,'შიგნიდან':20,'გარედან':20,'ორივე':40,'სხვა':0 },
  'ჯიპი XL' : { 'სტანდარტი':50,'VIP':150,'შიგნიდან':25,'გარედან':25,'ორივე':50,'სხვა':0 }
};

// ── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindLoginForm();
  bindEntryForm();
  bindInventoryForm();
  bindShiftButton();
  bindEditModal();
  bindSidebarToggle();
  bindLogout();
});

// ── LOGIN ─────────────────────────────────────────────────────
function bindLoginForm() {
  const form   = document.getElementById('login-form');
  const btn    = document.getElementById('login-btn');
  const pinInp = document.getElementById('pin');

  pinInp.addEventListener('input', () => {
    pinInp.value = pinInp.value.replace(/\D/g,'').slice(0,6);
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('manager-name').value.trim();
    const pin  = pinInp.value;
    if (!name) { showLoginError('გთხოვთ შეიყვანოთ სახელი'); return; }
    if (!pin)  { showLoginError('გთხოვთ შეიყვანოთ PIN');   return; }

    setLoading(btn, true);
    google.script.run
      .withSuccessHandler(res => {
        setLoading(btn, false);
        if (res.success) onLoginSuccess(res.managerName);
        else             showLoginError(res.message);
      })
      .withFailureHandler(err => {
        setLoading(btn, false);
        showLoginError('შეცდომა: ' + err.message);
      })
      .login(name, pin);
  });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

function onLoginSuccess(name) {
  STATE.managerName = name;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('manager-name-display').textContent = name;

  // Clear login form for security
  document.getElementById('pin').value = '';

  // Get Web App URL for live link
  google.script.run
    .withSuccessHandler(url => {
      STATE.webAppUrl = url;
      const liveBtn = document.getElementById('live-link-btn');
      if (liveBtn && url) liveBtn.href = url + '?page=live';
    })
    .withFailureHandler(() => {})
    .getWebAppUrl();

  google.script.run
    .withSuccessHandler(lists => {
      STATE.lists = lists;
      populateDropdowns();
      loadAllEntries();
      refreshStats();
      STATE.statsTimer = setInterval(refreshStats, 30000);
    })
    .withFailureHandler(err => toast('სიების შეცდომა: ' + err.message, 'error'))
    .getListsData();
}

// ── LOGOUT ───────────────────────────────────────────────────
function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click', () => {
    if (!confirm('გამოსვლა? ცვლის მონაცემები შენახულია — ხელახლა შესვლისას გამოჩნდება.')) return;
    logout();
  });
}

function logout() {
  // Stop the refresh timer
  if (STATE.statsTimer) { clearInterval(STATE.statsTimer); STATE.statsTimer = null; }

  // Reset state (but NOT the Sheets data — that stays safe)
  STATE.managerName    = '';
  STATE.lists          = null;
  STATE.sessionSales   = [];
  STATE.editingRow     = null;
  STATE.collectingRow  = null;
  STATE.collectPayment = null;

  // Show login, hide app
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('manager-name').value = '';
  document.getElementById('pin').value = '';

  // Close any open modals
  ['edit-modal','collect-modal','confirm-modal','summary-modal'].forEach(id => {
    document.getElementById(id).classList.remove('open');
  });
}

// ── DROPDOWNS ────────────────────────────────────────────────
function populateDropdowns() {
  const { carTypes, washTypes, boxes } = STATE.lists;
  fillSelect('car-type',      carTypes);
  fillSelect('wash-type',     washTypes);
  fillSelect('box',           boxes);
  fillSelect('edit-car-type', carTypes);
  fillSelect('edit-wash-type',washTypes);
  fillSelect('edit-box',      boxes);
  fillSelect('edit-payment',  ['Cash','Card','Talon']);
}

function fillSelect(id, items) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = items.map(v => `<option value="${v}">${v}</option>`).join('');
}

// ── ENTRY FORM ────────────────────────────────────────────────
function bindEntryForm() {
  const carSel   = document.getElementById('car-type');
  const washSel  = document.getElementById('wash-type');
  const costInp  = document.getElementById('cost');
  const form     = document.getElementById('entry-form');
  const submitBtn= document.getElementById('submit-entry-btn');

  function autoPrice() {
    const p = (PRICES[carSel.value] || {})[washSel.value];
    if (p !== undefined) costInp.value = p;
    const el = document.getElementById('vip-indicator');
    if (washSel.value === 'VIP') el.classList.add('show');
    else                          el.classList.remove('show');
  }

  carSel.addEventListener('change', autoPrice);
  washSel.addEventListener('change', autoPrice);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      plateNumber : document.getElementById('plate').value.trim(),
      loyaltyCode : document.getElementById('loyalty').value.trim(),
      phone       : document.getElementById('phone').value.trim(),
      carType     : carSel.value,
      washType    : washSel.value,
      cost        : parseFloat(costInp.value) || 0,
      box         : document.getElementById('box').value
      // paymentType and status handled server-side (always Pending)
    };

    if (!data.plateNumber) { toast('მანქანის ნომერი სავალდებულოა', 'warning'); return; }
    if (data.cost <= 0)    { toast('თანხა სავალდებულოა', 'warning'); return; }

    setLoading(submitBtn, true);
    google.script.run
      .withSuccessHandler(res => {
        setLoading(submitBtn, false);
        if (res.success) {
          toast('⏳ ' + data.plateNumber + ' — ტაბზე დამატებულია', 'success');
          form.reset();
          if (STATE.lists) {
            carSel.value  = STATE.lists.carTypes[0];
            washSel.value = STATE.lists.washTypes[0];
            document.getElementById('box').value = STATE.lists.boxes[0];
            autoPrice();
          }
          document.getElementById('vip-indicator').classList.remove('show');
          loadAllEntries();
          refreshStats();
        } else { toast('შეცდომა: ' + res.message, 'error'); }
      })
      .withFailureHandler(err => {
        setLoading(submitBtn, false);
        toast('კავშირის შეცდომა: ' + err.message, 'error');
      })
      .addEntry(data);
  });
}

// ── NOTES PARSER ─────────────────────────────────────────────
// Notes stored as "L:loyalty | T:phone" — parse back for display
function parseNotes(raw) {
  if (!raw) return { loyalty:'', phone:'', display:'' };
  const loyalty = (raw.match(/L:([^|]+)/) || [])[1] || '';
  const phone   = (raw.match(/T:([^|]+)/) || [])[1] || '';
  const parts   = [];
  if (loyalty.trim()) parts.push('🎫 ' + loyalty.trim());
  if (phone.trim())   parts.push('📞 ' + phone.trim());
  return { loyalty: loyalty.trim(), phone: phone.trim(), display: parts.join(' ') };
}

// ── STATS ─────────────────────────────────────────────────────
function refreshStats() {
  google.script.run
    .withSuccessHandler(s => renderStats(s))
    .withFailureHandler(() => {})
    .getDashboardStats();
}

function renderStats(s) {
  setChip('stat-washes',  s.totalWashes);
  setChip('stat-cash',    fmt(s.cashTotal));
  setChip('stat-card',    fmt(s.cardTotal));
  setChip('stat-talon',   s.talonCount + ' / ' + fmt(s.talonValue));
  setChip('stat-vip',     s.vipCount);
  setChip('stat-pending', s.pendingCount + ' / ' + fmt(s.pendingValue));
  setChip('stat-revenue', fmt(s.totalRevenue));

  const boxes = ['Box 1','Box 2','Box 3','Box 4'];
  boxes.forEach((b, i) => {
    const n  = i + 1;
    const bd = (s.boxData || {})[b] || { salary:0, washes:0 };
    setChip('box-earn-' + n, fmt(bd.salary));
    setChip('box-wash-' + n, '(' + bd.washes + ')');
  });

  const bonusEl = document.getElementById('bonus-badge');
  if (s.bonusReached) bonusEl.classList.add('visible');
  else                bonusEl.classList.remove('visible');
}

function setChip(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── ALL ENTRIES TABLE ─────────────────────────────────────────
function loadAllEntries() {
  google.script.run
    .withSuccessHandler(rows => renderEntriesTable(rows))
    .withFailureHandler(() => toast('ჩანაწერების ჩატვირთვა ვერ მოხერხდა', 'error'))
    .getAllEntries();
}

// keep old name for any stale references
function loadRecentEntries() { loadAllEntries(); }

function renderEntriesTable(rows) {
  const tbody = document.getElementById('entries-tbody');

  // Update counters in table header
  const totalEl   = document.getElementById('entry-count');
  const pendingEl = document.getElementById('entry-pending-count');
  if (totalEl)   totalEl.textContent   = rows ? rows.length : 0;
  if (pendingEl) pendingEl.textContent = rows ? rows.filter(r => r.status === 'Pending').length : 0;

  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">დღეს ჩანაწერები არ არის</td></tr>`;
    return;
  }

  // Newest first
  tbody.innerHTML = rows.slice().reverse().map(r => {
    const isPending = r.status === 'Pending';
    const washClass = r.washType === 'VIP' ? 'vip' : 'standard';
    const payClass  = isPending ? 'pending' : r.paymentType.toLowerCase();
    const rowClass  = isPending ? 'pending-row' : '';
    const note      = parseNotes(r.notes);
    const rowJson   = JSON.stringify(r).replace(/"/g, "'");

    const statusDot = `<span class="status-dot ${isPending ? 'pending' : 'paid'}"></span>`;
    const noteCell  = note.display
      ? `<span style="font-size:11px;color:var(--text-muted)">${esc(note.display)}</span>`
      : '<span style="color:var(--text-dim);font-size:11px">—</span>';

    const collectBtn = isPending
      ? `<button class="btn btn-collect" onclick="openCollectModal(${r.rowIndex},'${esc(r.plateNumber)}',${r.cost})">💰</button>`
      : '';
    const editBtn = `<button class="btn btn-ghost btn-icon" title="Edit"
                       onclick="openEditModal(${r.rowIndex},${rowJson})">✏</button>`;

    return `<tr class="${rowClass}">
      <td>${statusDot}</td>
      <td class="plate-cell">${esc(r.plateNumber)}</td>
      <td style="font-size:12px">${esc(r.carType)}</td>
      <td><span class="wash-badge ${washClass}">${esc(r.washType)}</span></td>
      <td style="font-weight:700">${r.cost} ₾</td>
      <td><span class="pay-chip ${payClass}">${esc(isPending ? 'ტაბი' : r.paymentType)}</span></td>
      <td style="font-size:12px">${esc(r.box)}</td>
      <td>${noteCell}</td>
      <td style="color:var(--text-muted);font-size:11px">${esc(r.timestamp)}</td>
      <td style="display:flex;gap:4px;align-items:center">${collectBtn}${editBtn}</td>
    </tr>`;
  }).join('');
}

// ── COLLECT PAYMENT ───────────────────────────────────────────
function openCollectModal(rowIndex, plate, cost) {
  STATE.collectingRow  = rowIndex;
  STATE.collectPayment = null;
  document.querySelectorAll('.payment-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('confirm-collect-btn').disabled = true;
  const titleEl = document.querySelector('#collect-modal .modal-title');
  if (titleEl) titleEl.textContent = `💰 ${plate} – ${cost} ₾`;
  document.getElementById('collect-modal').classList.add('open');
}

function closeCollectModal() {
  document.getElementById('collect-modal').classList.remove('open');
  STATE.collectingRow  = null;
  STATE.collectPayment = null;
}

function selectCollectPayment(type) {
  STATE.collectPayment = type;
  document.querySelectorAll('.payment-option').forEach(el => {
    const label = el.querySelector('.po-label').textContent;
    const match = (type==='Cash' && label==='Cash') ||
                  (type==='Card' && label==='ბარათი') ||
                  (type==='Talon'&& label==='ტალონი');
    el.classList.toggle('selected', match);
  });
  document.getElementById('confirm-collect-btn').disabled = false;
}

function confirmCollect() {
  if (STATE.collectingRow === null || !STATE.collectPayment) return;
  const btn = document.getElementById('confirm-collect-btn');
  setLoading(btn, true);
  google.script.run
    .withSuccessHandler(res => {
      setLoading(btn, false);
      if (res.success) {
        toast(`✓ ${STATE.collectPayment} — გადახდა მიღებულია`, 'success');
        closeCollectModal();
        loadAllEntries();
        refreshStats();
      } else { toast('შეცდომა: ' + res.message, 'error'); }
    })
    .withFailureHandler(err => {
      setLoading(btn, false);
      toast('შეცდომა: ' + err.message, 'error');
    })
    .markAsPaid(STATE.collectingRow, STATE.collectPayment);
}

// ── INVENTORY ─────────────────────────────────────────────────
function bindInventoryForm() {
  const form = document.getElementById('inventory-form');
  const btn  = document.getElementById('add-sale-btn');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      productName : document.getElementById('product-name').value.trim(),
      quantity    : parseFloat(document.getElementById('product-qty').value) || 1,
      productId   : document.getElementById('product-id').value.trim()
    };
    if (!data.productName) { toast('პროდუქტის სახელი სავალდებულოა', 'warning'); return; }
    setLoading(btn, true);
    google.script.run
      .withSuccessHandler(res => {
        setLoading(btn, false);
        if (res.success) {
          toast('✓ გაყიდვა დაფიქსირდა', 'success');
          STATE.sessionSales.push({ name: data.productName, qty: data.quantity });
          renderSalesLog();
          form.reset();
          document.getElementById('product-qty').value = 1;
        } else { toast('შეცდომა: ' + (res.message||''), 'error'); }
      })
      .withFailureHandler(err => {
        setLoading(btn, false);
        toast('შეცდომა: ' + err.message, 'error');
      })
      .addInventorySale(data);
  });
}

function renderSalesLog() {
  const ul = document.getElementById('sales-log');
  if (!STATE.sessionSales.length) {
    ul.innerHTML = '<li style="color:var(--text-dim);font-size:12px">გაყიდვები არ არის</li>'; return;
  }
  ul.innerHTML = STATE.sessionSales.map(s =>
    `<li><span class="item-name">${esc(s.name)}</span><span class="item-qty">x${s.qty}</span></li>`
  ).join('');
}

function bindSidebarToggle() {
  const btn     = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('sidebar');
  if (btn) btn.addEventListener('click', () => sidebar.classList.toggle('open'));
}

// ── EDIT MODAL ────────────────────────────────────────────────
function openEditModal(rowIndex, row) {
  STATE.editingRow = rowIndex;
  const note = parseNotes(row.notes);
  document.getElementById('edit-plate').value    = row.plateNumber;
  document.getElementById('edit-car-type').value = row.carType;
  document.getElementById('edit-wash-type').value= row.washType;
  document.getElementById('edit-cost').value     = row.cost;
  document.getElementById('edit-box').value      = row.box;
  document.getElementById('edit-loyalty').value  = note.loyalty;
  document.getElementById('edit-phone').value    = note.phone;
  // Show payment selector only for already-paid entries
  const payEl = document.getElementById('edit-payment');
  if (payEl) payEl.value = row.paymentType === 'Pending' ? 'Cash' : row.paymentType;
  document.getElementById('edit-modal').classList.add('open');
}

function bindEditModal() {
  document.getElementById('close-edit-modal').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
  });
  document.getElementById('edit-form').addEventListener('submit', e => {
    e.preventDefault();
    const btn = document.getElementById('save-edit-btn');
    const data = {
      plateNumber : document.getElementById('edit-plate').value.trim(),
      loyaltyCode : document.getElementById('edit-loyalty').value.trim(),
      phone       : document.getElementById('edit-phone').value.trim(),
      carType     : document.getElementById('edit-car-type').value,
      washType    : document.getElementById('edit-wash-type').value,
      cost        : parseFloat(document.getElementById('edit-cost').value) || 0,
      paymentType : (document.getElementById('edit-payment') || {}).value || 'Cash',
      box         : document.getElementById('edit-box').value,
      status      : 'Pending'  // editing keeps it pending; collect via 💰 button
    };
    setLoading(btn, true);
    google.script.run
      .withSuccessHandler(res => {
        setLoading(btn, false);
        if (res.success) {
          toast('✓ ჩანაწერი განახლდა', 'success');
          closeEditModal();
          loadAllEntries();
          refreshStats();
        } else { toast('შეცდომა: ' + res.message, 'error'); }
      })
      .withFailureHandler(err => { setLoading(btn, false); toast('შეცდომა: ' + err.message, 'error'); })
      .updateEntry(STATE.editingRow, data);
  });
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  STATE.editingRow = null;
}

// ── CLOSE SHIFT ───────────────────────────────────────────────
function bindShiftButton() {
  document.getElementById('close-shift-btn').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('open');
  });
  document.getElementById('confirm-yes').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('open');
    executeCloseShift();
  });
  document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('open');
  });
  ['close-summary-modal','close-summary-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', closeSummaryModal);
  });
}

function executeCloseShift() {
  const btn = document.getElementById('close-shift-btn');
  setLoading(btn, true);
  google.script.run
    .withSuccessHandler(res => {
      setLoading(btn, false);
      if (res.success) {
        renderShiftSummary(res.summary);
        document.getElementById('summary-modal').classList.add('open');
      } else { toast('შეცდომა: ' + res.message, 'error'); }
    })
    .withFailureHandler(err => {
      setLoading(btn, false);
      toast('შეცდომა: ' + err.message, 'error');
    })
    .closeShift(STATE.managerName);
}

function renderShiftSummary(s) {
  document.getElementById('sum-date').textContent     = s.date;
  document.getElementById('sum-revenue').textContent  = fmt(s.totalRevenue);
  document.getElementById('sum-washes').textContent   = s.totalWashes;
  document.getElementById('sum-cash').textContent     = fmt(s.cashTotal);
  document.getElementById('sum-card').textContent     = fmt(s.cardTotal);
  document.getElementById('sum-vip').textContent      = s.vipCount + ' რეცხ.';
  document.getElementById('sum-pending').textContent  = s.pendingCount + ' / ' + fmt(s.pendingTotal);
  document.getElementById('sum-washer').textContent   = fmt(s.washerTotal);
  document.getElementById('sum-mgr-base').textContent = fmt(s.managerBase);
  document.getElementById('sum-mgr-vip').textContent  = fmt(s.managerVIPBonus);
  document.getElementById('sum-mgr-daily').textContent= fmt(s.dailyBonus);
  document.getElementById('sum-mgr-total').textContent= fmt(s.managerTotal);
  document.getElementById('sum-expenses').textContent = fmt(s.totalExpenses);
  document.getElementById('sum-remain-cc').textContent= fmt(s.remainCashCard);
  document.getElementById('sum-archive-path').textContent = s.archivePath || '';
  const archiveLink = document.getElementById('sum-archive-url');
  if (archiveLink) archiveLink.href = s.archiveUrl || '#';
  if (s.bonusReached) document.getElementById('sum-bonus-alert').classList.add('show');
  else                document.getElementById('sum-bonus-alert').classList.remove('show');
  const boxDiv = document.getElementById('sum-box-breakdown');
  if (boxDiv && s.boxSalaries) {
    boxDiv.innerHTML = ['Box 1','Box 2','Box 3','Box 4'].map(b => `
      <div class="box-item">
        <div class="bi-label">${b}</div>
        <div class="bi-value">${fmt(s.boxSalaries[b]||0)}</div>
        <div class="bi-sub">${s.boxWashes[b]||0} რეცხ.</div>
      </div>`).join('');
  }
}

function closeSummaryModal() {
  document.getElementById('summary-modal').classList.remove('open');
  renderStats({ totalWashes:0, pendingCount:0, pendingValue:0, cashTotal:0,
                cardTotal:0, talonCount:0, talonValue:0, vipCount:0,
                totalRevenue:0, bonusReached:false, boxData:{} });
  renderEntriesTable([]);
  STATE.sessionSales = [];
  renderSalesLog();
}

// ── UTILITIES ─────────────────────────────────────────────────
function fmt(n) { return (parseFloat(n)||0).toFixed(2) + ' ₾'; }

function esc(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) { btn._text = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
  else         { btn.innerHTML = btn._text||''; btn.disabled = false; }
}

function toast(msg, type) {
  type = type || 'info';
  const icons = { success:'✓', error:'✕', info:'ℹ', warning:'⚠' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||''}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
