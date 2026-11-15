// Saledock B2B Product Data Skimmer & Importer - Popup Controller
// Version: v1.0.0 (Build 2026.11.15.1)
// License: MIT | Co-authored by Benjamin Goddard & Gemini

const statusEl = document.getElementById("status");
const countEl = document.getElementById("itemCount");
const supplierInput = document.getElementById("supplierName");
const packQtyInput = document.getElementById("defaultPackQty");

function setStatus(text) {
  statusEl.textContent = text;
}

function refreshCount() {
  chrome.runtime.sendMessage({ type: "GET_SKIMMED_ITEMS" }, (res) => {
    if (res && res.ok) {
      countEl.textContent = String(res.items.length);
    }
  });
}

// Load saved supplier label
chrome.storage.local.get(["supplierName"], (data) => {
  if (data.supplierName) supplierInput.value = data.supplierName;
});

supplierInput.addEventListener("change", () => {
  chrome.storage.local.set({ supplierName: supplierInput.value.trim() });
});

// 1. Skim active B2B supplier tab using generic structured DOM/JSON-LD extraction
document.getElementById("btnSkimPage").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return setStatus("No active browser tab found.");

  const supplier = supplierInput.value.trim() || new URL(tab.url).hostname;
  const packQty = Math.max(1, parseInt(packQtyInput.value || "1", 10));

  setStatus("Skimming active B2B page...");

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: (supplierLabel, defaultPack) => {
        const extracted = [];

        // Attempt 1: Schema.org JSON-LD product blocks
        document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
          try {
            const parsed = JSON.parse(script.textContent);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            entries.forEach((entry) => {
              if (entry["@type"] === "Product" && (entry.sku || entry.mpn)) {
                const offer = Array.isArray(entry.offers) ? entry.offers[0] : (entry.offers || {});
                extracted.push({
                  sku: String(entry.sku || entry.mpn).trim(),
                  barcode: String(entry.gtin13 || entry.gtin12 || entry.gtin || "").trim(),
                  title: String(entry.name || "").trim(),
                  brand: typeof entry.brand === "object" ? (entry.brand.name || "") : (entry.brand || ""),
                  category: "",
                  subCategory: "",
                  supplier: supplierLabel,
                  cost: Number(offer.price || 0),
                  rrp: Number(offer.price || 0),
                  stock: String(offer.availability || "").includes("InStock") ? 1 : 0,
                  packQty: defaultPack,
                  webDescription: String(entry.description || "").trim(),
                  images: Array.isArray(entry.image) ? entry.image : (entry.image ? [entry.image] : []),
                  visible: true
                });
              }
            });
          } catch (_) {}
        });

        // Attempt 2: Generic product card fallback if no JSON-LD found
        if (extracted.length === 0) {
          document.querySelectorAll("[data-sku], .product-item, .product-card").forEach((card, idx) => {
            const sku = card.getAttribute("data-sku") ||
              card.querySelector("[data-sku], .sku, .product-sku")?.textContent?.trim() ||
              `SKIM-${Date.now()}-${idx}`;
            const title = card.querySelector("h2, h3, .product-title, .product-name")?.textContent?.trim() || "";
            const priceText = card.querySelector(".price, .trade-price, [data-price]")?.textContent || "0";
            const numericPrice = parseFloat(priceText.replace(/[^0-9.]/g, "")) || 0;
            const img = card.querySelector("img")?.src || "";

            if (title) {
              extracted.push({
                sku,
                barcode: "",
                title,
                brand: "",
                category: "",
                subCategory: "",
                supplier: supplierLabel,
                cost: numericPrice,
                rrp: numericPrice,
                stock: 1,
                packQty: defaultPack,
                webDescription: "",
                images: img ? [img] : [],
                visible: true
              });
            }
          });
        }

        return extracted;
      },
      args: [supplier, packQty]
    },
    (results) => {
      if (chrome.runtime.lastError) {
        return setStatus("Error: " + chrome.runtime.lastError.message);
      }
      const items = (results && results[0] && results[0].result) || [];
      if (items.length === 0) {
        return setStatus("No structured product data detected on this page.");
      }

      chrome.runtime.sendMessage({ type: "SAVE_SKIMMED_ITEMS", items }, () => {
        refreshCount();
        setStatus(`Saved ${items.length} item(s) to IndexedDB.`);
      });
    }
  );
});

// 2. Export Saledock 33-Column CSV
document.getElementById("btnExportCsv").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "EXPORT_SALEDOCK_CSV" }, (res) => {
    if (!res || !res.ok || res.count === 0) {
      return setStatus("Queue is empty. Skim items first.");
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Saledock_ProductImport_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${res.count} product(s) to CSV.`);
  });
});

// 3. Saledock Back-Office OOSP & Publish Macro
document.getElementById("btnRunOospMacro").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("backoffice.saledock.com")) {
    return setStatus("Open backoffice.saledock.com/Ecommerce/Product first.");
  }

  setStatus("Running Saledock OOSP & Publish macro...");
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      let toggled = 0;
      document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        const labelText = (cb.closest("label, td, tr")?.textContent || "").toLowerCase();
        if ((labelText.includes("publish") || labelText.includes("out of stock") || labelText.includes("oosp")) && !cb.checked) {
          cb.click();
          toggled++;
        }
      });
      return toggled;
    }
  }, (results) => {
    const count = (results && results[0] && results[0].result) || 0;
    setStatus(`Macro complete: toggled ${count} switch(es).`);
  });
});

// 4. Clear IndexedDB Queue
document.getElementById("btnClear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_SKIMMED_ITEMS" }, () => {
    refreshCount();
    setStatus("Skimmed queue cleared.");
  });
});

refreshCount();
