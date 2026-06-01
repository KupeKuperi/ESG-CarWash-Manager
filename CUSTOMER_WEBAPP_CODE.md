# Code to add to Customer QR Webapp

## Step 1 — Add this function to your Code.gs

Paste this anywhere in your customer webapp's **Code.gs**:

```javascript
// ── ESG Car Wash ERP — Send booking ──────────────────────────
var ERP_URL = 'https://script.google.com/macros/s/AKfycbxcip7t-8g5XkAH-SnzFCwCcmD6-zS4tWin21k2eXzFrs0QfwIMrS2818kBYAq80MQl/exec';

function sendWashBooking(phone, plate, carType, washType, scheduledTime) {
  var payload = JSON.stringify({
    action       : 'scheduleWash',
    phone        : phone,
    plate        : plate,
    carType      : carType,
    washType     : washType,
    scheduledTime: scheduledTime
  });
  var options = {
    method          : 'post',
    contentType     : 'application/json',
    payload         : payload,
    muteHttpExceptions: true
  };
  try {
    var response = UrlFetchApp.fetch(ERP_URL, options);
    return JSON.parse(response.getContentText());
  } catch(e) {
    return { success: false, message: e.message };
  }
}
```

---

## Step 2 — Add this HTML form to your webapp

Paste this inside your customer webapp's HTML where you want the scheduling form to appear:

```html
<!-- ── Schedule a Wash ── -->
<div id="schedule-section" style="padding:20px;max-width:420px;margin:0 auto">
  <h3 style="margin-bottom:16px;font-size:17px">📅 რეცხვის დაჯავშნა</h3>

  <div style="margin-bottom:12px">
    <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#666;display:block;margin-bottom:4px">მანქანის ნომერი</label>
    <input type="text" id="sch-plate" placeholder="AA-000-BB"
           style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;text-transform:uppercase"
           oninput="this.value=this.value.toUpperCase()">
  </div>

  <div style="margin-bottom:12px">
    <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#666;display:block;margin-bottom:4px">მანქანის ტიპი</label>
    <select id="sch-car-type" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px">
      <option value="სედანი">სედანი</option>
      <option value="ჯიპი">ჯიპი</option>
      <option value="ჯიპი XL">ჯიპი XL</option>
    </select>
  </div>

  <div style="margin-bottom:12px">
    <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#666;display:block;margin-bottom:4px">რეცხვის სახე</label>
    <select id="sch-wash-type" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px">
      <option value="სტანდარტი">სტანდარტი</option>
      <option value="VIP">VIP</option>
      <option value="შიგნიდან">შიგნიდან</option>
      <option value="გარედან">გარედან</option>
      <option value="ორივე">ორივე</option>
    </select>
  </div>

  <div style="margin-bottom:20px">
    <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#666;display:block;margin-bottom:4px">ჩამოსვლის დრო</label>
    <input type="datetime-local" id="sch-time"
           style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px">
  </div>

  <button onclick="submitBooking()"
          style="width:100%;padding:12px;background:#008CCF;color:#fff;border:none;
                 border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">
    📅 დაჯავშნვა
  </button>

  <div id="sch-result" style="margin-top:12px;font-size:13px;text-align:center;display:none"></div>
</div>

<script>
function submitBooking() {
  var plate    = document.getElementById('sch-plate').value.trim();
  var carType  = document.getElementById('sch-car-type').value;
  var washType = document.getElementById('sch-wash-type').value;
  var timeVal  = document.getElementById('sch-time').value;
  var result   = document.getElementById('sch-result');

  if (!plate) { result.style.display='block'; result.style.color='#DC2626'; result.textContent='ნომრის შეყვანა სავალდებულოა'; return; }
  if (!timeVal) { result.style.display='block'; result.style.color='#DC2626'; result.textContent='დრო სავალდებულოა'; return; }

  // Format the date/time nicely for the manager
  var dt = new Date(timeVal);
  var formatted = dt.toLocaleDateString('ka-GE') + ' ' +
    String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');

  // Get phone from your existing logged-in user session (replace with your actual variable)
  var phone = window.currentUserPhone || '';

  result.style.display='block'; result.style.color='#6B7280'; result.textContent='იგზავნება...';

  google.script.run
    .withSuccessHandler(function(res) {
      if (res.success) {
        result.style.color = '#059669';
        result.textContent = '✓ ჯავშანი მიღებულია! მენეჯერი მოგელოდება.';
        document.getElementById('sch-plate').value = '';
        document.getElementById('sch-time').value  = '';
      } else {
        result.style.color = '#DC2626';
        result.textContent = 'შეცდომა: ' + (res.message || '?');
      }
    })
    .withFailureHandler(function(e) {
      result.style.color = '#DC2626';
      result.textContent = 'შეცდომა: ' + e.message;
    })
    .sendWashBooking(phone, plate, carType, washType, formatted);
}
</script>
```

---

## How it works end-to-end

```
Customer fills form → clicks "დაჯავშნვა"
  → your Code.gs calls ERP doPost (scheduleWash)
    → ERP writes row to "Scheduled" sheet
      → Manager's live screen refreshes (every 15s)
        → 📅 section appears with booking card + 🔔 notification popup
          → Manager taps ✓ OK → row marked Confirmed → disappears from list
```

## Note about the phone number

In the JS above, replace `window.currentUserPhone || ''` with however
your customer webapp stores the logged-in user's phone number.
For example, if you store it in a variable called `loggedInUser.phone`,
change that line to: `var phone = loggedInUser.phone || '';`
