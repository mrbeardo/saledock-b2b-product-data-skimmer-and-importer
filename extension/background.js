// Saledock B2B Product Data Skimmer & Importer - Background Service Worker
// Version: v1.0.2-step1 (Build 2026.11.15.3)
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

// Step 1: Smart Wholesale Pack, Length & Volume Detector
function detectWholesaleUnit(title = "", description = "", sku = "", manualOverride = 1) {
  const manualQty = Math.max(1, parseInt(manualOverride || "1", 10));
  if (manualQty > 1) {
    return { qty: manualQty, unitType: "Manual Override", ruleMatched: `Manual (${manualQty})` };
  }

  const text = `${title} ${description}`.replace(/\s+/g, " ").trim();
  const cleanSku = String(sku || "").trim().toUpperCase();

  // 1. Explicit Box / Pack / Jar / Bag / Card / Strip / Roll counts
  // Matches: (50/BOX), 144/Box, Box of 10, Pack of 25, 10 pack, 10-Pack, 10pk, Bag of 100, Jar of 50, Card of 10
  const boxPackPatterns = [
    /\((\d+)\s*\/\s*(?:box|bx|pack|pk|bag|jar|card|strip|roll)\)/i,
    /\b(\d+)\s*\/\s*(?:box|bx|pack|pk|bag|jar)\b/i,
    /\b(?:box|pack|bag|jar|card|strip|roll|set)\s+of\s+(\d+)\b/i,
    /\b(\d+)\s*[-]?\s*(?:pack|pk|pcs|pieces|per\s+box|per\s+pack)\b/i,
    /\bqty[:\s]*(\d+)\b/i
  ];
  for (const regex of boxPackPatterns) {
    const match = text.match(regex);
    if (match && parseInt(match[1], 10) > 1) {
      const qty = parseInt(match[1], 10);
      return { qty, unitType: "Multi-Pack", ruleMatched: match[0] };
    }
  }

  // 2. Multiplier shorthand (e.g., "x 20", "x25", "10x", "(10)") - avoids tyre/wheel dimensions like 26 x 1.75 or 700 x 28c
  const multMatch = text.match(/(?:^|\s|\()x\s*(\d{2,3})(?:\)|\s|$)/i) || text.match(/\b(\d{2,3})x(?:\s|$)/i);
  if (multMatch && parseInt(multMatch[1], 10) > 1) {
    const qty = parseInt(multMatch[1], 10);
    return { qty, unitType: "Multi-Pack", ruleMatched: multMatch[0].trim() };
  }

  // 3. Trade "Gross" (144 units, common for spokes/nipples)
  if (/\bgross\b/i.test(text) && !/\bgross\s+weight\b/i.test(text)) {
    return { qty: 144, unitType: "Gross Box", ruleMatched: "Gross (144)" };
  }

  // 4. Bulk Cable / Housing / Rim Tape Lengths in Metres (ignores "mm" like 40mm or 180mm)
  // Matches: 10m, 30m, 50m, 100m, 25m Reel, 30m Coil
  const metreMatch = text.match(/\b(\d+(?:\.\d+)?)\s*m(?:\s+(?:reel|coil|roll|box|length))?\b/i);
  if (metreMatch && !/\b\d+\s*mm\b/i.test(metreMatch[0])) {
    const metres = parseFloat(metreMatch[1]);
    if (metres >= 5) {
      return { qty: metres, unitType: "Per Metre", ruleMatched: `${metres}m` };
    }
  }

  // 5. Workshop Fluids & Pastes in Litres / Millilitres (splits into 100ml workshop/retail units)
  // Matches: 1L, 2L, 5L, 1000ml, 2000ml, 5000ml
  const litreMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:l|ltr|litre|litres)\b/i);
  if (litreMatch) {
    const litres = parseFloat(litreMatch[1]);
    if (litres >= 1) {
      const unitsOf100ml = Math.round(litres * 10);
      return { qty: unitsOf100ml, unitType: "Per 100ml", ruleMatched: `${litres}L (${unitsOf100ml}x100ml)` };
    }
  }
  const mlMatch = text.match(/\b(\d{4,5})\s*ml\b/i);
  if (mlMatch) {
    const ml = parseInt(mlMatch[1], 10);
    if (ml >= 1000) {
      const unitsOf100ml = Math.round(ml / 100);
      return { qty: unitsOf100ml, unitType: "Per 100ml", ruleMatched: `${ml}ml (${unitsOf100ml}x100ml)` };
    }
  }

  // 6. Fallback SKU Suffix Check (e.g., TUES20SBX without explicit count -> flags for review)
  if (/BX$/.test(cleanSku)) {
    return { qty: 1, unitType: "Box SKU (Verify Qty)", ruleMatched: `SKU ${cleanSku}` };
  }

  return { qty: 1, unitType: "Single Unit", ruleMatched: "Default (1)" };
}

// Split wholesale multi-packs, lengths, or bulk volumes into single retail/workshop units
function normalizePackItem(item) {
  const detected = detectWholesaleUnit(item.title, item.webDescription, item.sku, item.packQty);
  const packQty = detected.qty;
  const rawCost = Number(item.cost || 0);
  const rawRrp = Number(item.rrp || 0);

  const unitCost = packQty > 1 ? +(rawCost / packQty).toFixed(2) : rawCost;
  const unitRrp = packQty > 1 && rawRrp > 0 ? +(rawRrp / packQty).toFixed(2) : rawRrp;

  let normalizedTitle = String(item.title || "").trim();
  if (detected.unitType === "Per Metre" && !/\[per metre\]/i.test(normalizedTitle)) {
    normalizedTitle += " [Per Metre]";
  } else if (detected.unitType === "Per 100ml" && !/\[per 100ml\]/i.test(normalizedTitle)) {
    normalizedTitle += " [Per 100ml]";
  }

  const autoTags = [item.tags];
  if (packQty > 1) autoTags.push(`Split-${detected.unitType.replace(/\s+/g, "-")}`);

  return {
    ...item,
    title: normalizedTitle,
    barcode: cleanBarcode(item.barcode),
    originalPackCost: rawCost,
    detectedPackQty: packQty,
    detectedUnitType: detected.unitType,
    detectedRuleMatched: detected.ruleMatched,
    cost: unitCost,
    rrp: unitRrp,
    tags: autoTags.filter(Boolean).join(" | "),
    packSplitApplied: packQty > 1
  };
}

// Map normalized items to Saledock's ProductImportTemplate CSV format
function buildSaledockCSV(items) {
  const headers = [
    "ProductCode", "Barcode", "Title", "Brand", "Category", "SubCategory",
    "Supplier", "CostPrice", "RetailPrice", "SalePrice", "TaxCode", "StockLevel",
    "ReorderLevel", "ReorderQty", "Weight", "Length", "Width", "Height",
    "Option1Name", "Option1Value", "Option2Name", "Option2Value",
    "Option3Name", "Option3Value", "ShortDescription", "WebDescription",
    "MetaTitle", "MetaDescription", "URL", "Images", "Visible", "NonStock", "Featured", "Tags"
  ];

  const escapeCsv = (val) => {
    const s = val === null || val === undefined ? "" : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = items.map((p) => {
    const visible = Boolean(p.visible);
    const tags = [p.tags, "B2B-Skimmer"].filter(Boolean).join(" | ");
    return [
      p.sku, p.barcode, p.title, p.brand, p.category, p.subCategory,
      p.supplier, p.cost, p.rrp, p.salePrice || "", p.taxCode || "T1", p.stock || 0,
      p.reorderLevel || 0, p.reorderQty || 0, p.weight || "", "", "", "",
      p.option1Name || "", p.option1Value || "", p.option2Name || "", p.option2Value || "",
      "", "", p.shortDescription || "", p.webDescription || "",
      p.metaTitle || p.title, p.metaDescription || "", p.urlSlug || "",
      Array.isArray(p.images) ? p.images.join(" | ") : (p.images || ""),
      visible ? "TRUE" : "FALSE", "FALSE", "FALSE", tags
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
