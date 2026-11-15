// Saledock B2B Product Data Skimmer & Importer - Background Service Worker
// Version: v1.0.0 (Build 2026.11.15.1)
// License: MIT | Co-authored by Benjamin Goddard & Gemini

const DB_NAME = "SaledockSkimmerDB";
const DB_VERSION = 1;
const STORE_SKIMMED = "skimmedProducts";
const STORE_EXISTING = "existingCatalog";

// Open IndexedDB for high-capacity CSV deduplication & skimmed storage
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SKIMMED)) {
        db.createObjectStore(STORE_SKIMMED, { keyPath: "sku" });
      }
      if (!db.objectStoreNames.contains(STORE_EXISTING)) {
        db.createObjectStore(STORE_EXISTING, { keyPath: "sku" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Repair scientific-notation barcodes (e.g., 2.1E+11 -> 210000000000) & strip invalid characters
function cleanBarcode(raw) {
  if (!raw) return "";
  let str = String(raw).trim();
  if (/^[0-9.]+e\+[0-9]+$/i.test(str)) {
    const num = Number(str);
    if (!Number.isNaN(num)) {
      str = num.toLocaleString("fullwide", { useGrouping: false });
    }
  }
  return str.replace(/[^0-9A-Za-z-]/g, "");
}

// Split wholesale multi-packs into single retail units when pack size > 1
function normalizePackItem(item) {
  const packQty = Math.max(1, parseInt(item.packQty || "1", 10));
  const unitCost = packQty > 1 ? +(Number(item.cost || 0) / packQty).toFixed(2) : Number(item.cost || 0);
  const unitRrp = packQty > 1 ? +(Number(item.rrp || 0) / packQty).toFixed(2) : Number(item.rrp || 0);
  return {
    ...item,
    barcode: cleanBarcode(item.barcode),
    cost: unitCost,
    rrp: unitRrp,
    packSplitApplied: packQty > 1
  };
}

// Map normalized items to Saledock's 33-column ProductImportTemplate CSV format
function buildSaledockCSV(items) {
  const headers = [
    "ProductCode", "Barcode", "Title", "Brand", "Category", "SubCategory",
    "Supplier", "CostPrice", "RetailPrice", "SalePrice", "TaxCode", "StockLevel",
    "ReorderLevel", "ReorderQty", "Weight", "Length", "Width", "Height",
    "Option1Name", "Option1Value", "Option2Name", "Option2Value",
    "Option3Name", "Option3Value", "ShortDescription", "WebDescription",
    "MetaTitle", "MetaDescription", "URL", "Images", "Visible", "NonStock", "Featured"
  ];

  const escapeCsv = (val) => {
    const s = val === null || val === undefined ? "" : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = items.map((p) => {
    const visible = Boolean(p.visible);
    return [
      p.sku, p.barcode, p.title, p.brand, p.category, p.subCategory,
      p.supplier, p.cost, p.rrp, p.salePrice || "", p.taxCode || "T1", p.stock || 0,
      p.reorderLevel || 0, p.reorderQty || 0, p.weight || "", "", "", "",
      p.option1Name || "", p.option1Value || "", p.option2Name || "", p.option2Value || "",
      "", "", p.shortDescription || "", p.webDescription || "",
      p.metaTitle || p.title, p.metaDescription || "", p.urlSlug || "",
      Array.isArray(p.images) ? p.images.join("|") : (p.images || ""),
      visible ? "TRUE" : "FALSE", "FALSE", "FALSE"
    ].map(escapeCsv).join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const db = await openDB();

    if (msg.type === "SAVE_SKIMMED_ITEMS") {
      const tx = db.transaction(STORE_SKIMMED, "readwrite");
      const store = tx.objectStore(STORE_SKIMMED);
      for (const rawItem of msg.items || []) {
        const cleanItem = normalizePackItem(rawItem);
        if (cleanItem.sku) store.put(cleanItem);
      }
      tx.oncomplete = () => sendResponse({ ok: true });
      return;
    }

    if (msg.type === "GET_SKIMMED_ITEMS") {
      const tx = db.transaction(STORE_SKIMMED, "readonly");
      const req = tx.objectStore(STORE_SKIMMED).getAll();
      req.onsuccess = () => sendResponse({ ok: true, items: req.result || [] });
      return;
    }

    if (msg.type === "CLEAR_SKIMMED_ITEMS") {
      const tx = db.transaction(STORE_SKIMMED, "readwrite");
      tx.objectStore(STORE_SKIMMED).clear();
      tx.oncomplete = () => sendResponse({ ok: true });
      return;
    }

    if (msg.type === "EXPORT_SALEDOCK_CSV") {
      const tx = db.transaction(STORE_SKIMMED, "readonly");
      const req = tx.objectStore(STORE_SKIMMED).getAll();
      req.onsuccess = () => {
        const csv = buildSaledockCSV(req.result || []);
        sendResponse({ ok: true, csv, count: (req.result || []).length });
      };
      return;
    }
  })();
  return true;
});
