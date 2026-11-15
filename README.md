# Saledock B2B Product Data Skimmer & Importer
**v1.0.0 (Build 2026.11.15.1)**

An open-source Chrome and Edge (Manifest V3) extension built for **Saledock / Celerant ONE** retailers to automate B2B supplier catalogue extraction, CSV cleanup, variant consolidation, and back-office publishing.

## Key Features
* **Universal B2B Catalogue Crawler:** Extracts product titles, SKUs, barcodes, trade/RRP pricing, stock levels, rich HTML descriptions, and high-resolution image galleries across multi-page supplier portals.
* **IndexedDB Deduplication & Barcode Repair:** Matches skimmed items against your existing Saledock `ProductExport` and `StockExport` CSVs to prevent duplicate entries and automatically repairs scientific-notation barcodes (e.g. `2.1E+11`).
* **Smart Variant & Bulk Pack Consolidation:** Groups size/colour variants cleanly and splits wholesale multi-packs into individual retail units with accurate unit cost and margin calculations.
* **33-Column Saledock CSV Mapper:** Exports ready-to-import CSV files formatted strictly to Saledock's official `ProductImportTemplate`.
* **Saledock Back-Office OOSP & Publish Macro:** Automates toggling **Out-of-Stock Purchase (OOSP)** and **Publish to Website** switches directly on `backoffice.saledock.com/Ecommerce/Product`.

## Installation (Developer Mode)
1. Download or clone this repository to your computer.
2. Open Chrome or Microsoft Edge and navigate to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `extension/` folder from this repository.

## Configuration
Open the extension popup to configure your supplier base URLs, target retail margin rules, and custom category/filter mappings before running a skim.

## License
Released under the **MIT License**. Co-authored by **Benjamin Goddard** & **Gemini**.
