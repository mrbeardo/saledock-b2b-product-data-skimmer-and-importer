# Saledock B2B Product Data Skimmer & Importer

**Version:** `v1.0.2` (Build 2026.11.15.4)  
**License:** MIT  
**Co-authored by:** Benjamin Goddard & Gemini

An open-source Chromium/Edge Manifest V3 browser extension built for independent cycle workshops and retailers using **Saledock EPOS / eCommerce**. It extracts product data directly from B2B trade distributor portals, automatically splits bulk workshop packs, lengths, and fluids into single retail/workshop units, calculates missing retail prices using VAT-inclusive cost plus tiered or custom markups, maintains a full pricing audit log, and exports clean 34-column Saledock CSV files.

---

## Features in `v1.0.2`

* **Automatic Supplier Portal Detection:** Identifies the active domain (`window.location.hostname`) and auto-selects dedicated DOM scrapers (such as **The Cycle Division** WooCommerce B2B layout) with automatic fallback to Schema.org JSON-LD and generic product cards.
* **Smart Bulk Pack, Length & Volume Splitting:** Automatically detects wholesale packaging and converts net trade prices into single retail/workshop units:
  * **Boxes & Multi-Packs:** `(50/BOX)`, `144/Box`, `Box of 10`, `Pack of 25`, `10 pack`, `2pcs`, `x 20`, `Gross` (144 units).
  * **Bulk Lengths:** `10m`, `30m`, `50m`, `100m` coils/reels (safely ignores `mm` component specs such as `40mm` valves or `180mm` rotors) and tags items `[Per Metre]`.
  * **Workshop Fluids & Pastes:** `1L`, `2L`, `5L`, `1000ml`, `2000ml` tubs/bottles split into `100ml` workshop/retail units and tagged `[Per 100ml]`.
  * **Manual Override:** Optional pack quantity override in the popup when a supplier omits pack counts from the title.
* **Missing-RRP Retail Pricing Engine:**
  * Preserves official distributor RRPs whenever displayed on the page.
  * When RRP is missing or zero, calculates retail pricing using:  
    `Sell Price = (Unit Net Cost * 1.20 VAT) * (1 + Markup %)`
  * **Recommended Markup Tiers (33%–56%):** Automatically selects a markup based on single-unit net trade cost (`<£3`: 56%, `£3–£9.99`: 50%, `£10–£29.99`: 42%, `£30–£74.99`: 36%, `£75+`: 33%), or lets you specify a custom percentage.
* **Persistent Pricing & Pack Audit Log:** Logs every skimmed SKU in IndexedDB with timestamps, original pack cost, detected pack quantity, matched rule, VAT-inclusive unit cost, markup percentage, and RRP source (`Official RRP` vs `Auto-Calc` / `Manual-Calc`), exportable as a separate CSV.
* **Barcode & CSV Formatting:** Repairs scientific-notation barcodes (e.g. `2.1E+11` -> `210000000000`) and formats output directly to Saledock's `ProductImportTemplate` CSV specification.
* **Saledock Back-Office Automation:** One-click macro on `backoffice.saledock.com` to toggle Publish and Out-of-Stock Purchase (OOSP) switches.

---

## Installation (Microsoft Edge / Google Chrome)

1. Download or clone this repository to a local folder on your computer.
2. Open `edge://extensions` (or `chrome://extensions`) in your browser.
3. Enable **Developer mode** using the toggle switch.
4. Click **Load unpacked** and select the folder containing `manifest.json`, `background.js`, `popup.html`, and `popup.js`.

---

## Usage

1. Log in to your B2B trade distributor portal (e.g. `thecycledivision.com`) and open a category or search results page.
2. Click the **Saledock B2B Skimmer & Importer** extension icon in your toolbar.
3. Confirm the detected supplier adapter, leave **Pack Override** at `1` for automatic bulk detection, and choose **Auto Tier (33%–56%)** or a **Custom %** markup.
4. Click **Skim Active B2B Catalogue Tab** to extract, split, price, and log all visible products.
5. Click **Export Saledock CSV** for your catalogue import, and **Export Pricing & Pack Audit Log** to keep a record of all calculations.

---

## Release Notes

* **`v1.0.2`:** Added The Cycle Division WooCommerce adapter, automatic bulk pack/length/volume splitter (`50/BOX`, `10m`, `1000ml`, etc.), NET + 20% VAT + 33%–56% tiered/custom pricing when RRP is absent, and CSV-exportable Audit Log.
* **`v1.0.1`:** Added IndexedDB storage, scientific-notation barcode repair, and manual pack splitting.
* **`v1.0.0`:** Initial release with generic JSON-LD extraction, Saledock CSV export, and Saledock back-office OOSP/Publish macro.
