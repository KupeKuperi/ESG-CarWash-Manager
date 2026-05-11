# ESG Car Wash Manager Terminal

Industrial dark-mode ERP system for managing a car wash shift — built as a **Google Apps Script Web App** backed by Google Sheets.

---

## Repository Structure

```
ESG_CarWash_ERP/
├── Code.gs       ← Google Apps Script backend (server-side)
├── index.html    ← Main UI template (uses GAS include() tags)
├── style.css     ← CSS  → rename to style.html  when deploying to GAS
├── script.js     ← JS   → rename to script.html when deploying to GAS
└── README.md
```

---

## One-Time Google Apps Script Deployment

### Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/**SPREADSHEET_ID**/edit`

### Step 2 — Set up the Apps Script project

1. In your Sheet, go to **Extensions → Apps Script**.
2. Delete the default `Code.gs` content.
3. Create / paste the following files:

| GAS filename   | GitHub file  | Note                                      |
|---------------|-------------|-------------------------------------------|
| `Code.gs`     | `Code.gs`   | Paste as-is                               |
| `index.html`  | `index.html`| Paste as-is                               |
| `style.html`  | `style.css` | Paste CSS content, wrap in `<style>` tags |
| `script.html` | `script.js` | Paste JS content, wrap in `<script>` tags |

> **style.html** must look like:
> ```html
> <style>
>   /* …paste full contents of style.css here… */
> </style>
> ```
>
> **script.html** must look like:
> ```html
> <script>
>   /* …paste full contents of script.js here… */
> </script>
> ```

### Step 3 — Configure the Spreadsheet ID

In `Code.gs`, line 6:
```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
```
Replace `YOUR_SPREADSHEET_ID_HERE` with your actual ID from Step 1.

### Step 4 — Run setup once

In Apps Script editor, run **`setupSpreadsheet`** once (select it from the function dropdown and click ▶ Run). This creates all required sheets with correct headers.

### Step 5 — Deploy as Web App

1. Click **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone** (or restrict as needed).
5. Click **Deploy** and copy the Web App URL.

---

## Features

| Feature | Detail |
|---------|--------|
| **Auth** | Manager name + PIN `2329` |
| **Entry form** | Plate, Loyalty code, Car type, Wash type, Box (1–4), Payment, Auto-priced cost |
| **Live stats bar** | Washes, Cash, Card, Talon, VIP count, Total revenue — refreshes every 30 s |
| **1,600 ₾ bonus alert** | Glows in header when daily threshold is reached |
| **Inventory sidebar** | Log product sales to `Daily_Sales` sheet |
| **Edit mode** | Last 10 entries shown with ✏ Edit button |
| **Close Shift** | Calculates salaries, writes Summary sheet, archives to `May_2026`-style sheet, clears Daily |

---

## Salary Logic

### Washers
- Standard washes → **35%** of wash cost (per box)
- VIP washes → **40%** of wash cost

### Manager (daily)
| Component | Amount |
|-----------|--------|
| Base salary | 175 ₾ |
| VIP bonus | +10 ₾ per VIP wash (incl. Talon VIPs) |
| Daily bonus | +50 ₾ if total revenue ≥ 1,600 ₾ |

### Talon logic
- Talon payment = **0 ₾ collected** from customer.
- Washer **and** manager still receive full commissions as if it were a paid wash.
- Talon cost value **counts toward** the 1,600 ₾ daily bonus threshold.

---

## Car Types & Default Prices (GEL)

| Car Type | სტანდარტი | VIP | შიგნიდან | გარედან | ორივე |
|----------|----------|-----|---------|--------|------|
| სედანი   | 30       | 80  | 15      | 15     | 30   |
| ჯიპი     | 40       | 120 | 20      | 20     | 40   |
| ჯიპი XL  | 50       | 150 | 25      | 25     | 50   |

Prices are auto-filled on car/wash type selection and can be overridden manually.

---

## Sheet Structure

| Sheet | Purpose |
|-------|---------|
| `Daily` | Active shift entries — cleared after Close Shift |
| `Summary` | Auto-generated daily financial report |
| `Daily_Sales` | Inventory / product sales log |
| `Lists` | Reference lists (car types, wash types, etc.) |
| `Data` | Reserved for future reference data |
| `May_2026` etc. | Monthly archive created automatically by Close Shift |

---

## Design Specs

- **Background:** `rgb(53, 60, 76)` — Deep Slate `#353C4C`
- **Primary:** `rgb(0, 140, 207)` — Electric Blue `#008CCF`
- **Mode:** Industrial Dark
- **Logo:** Glassmorphic blur badge
