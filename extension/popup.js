// Saledock B2B Product Data Skimmer & Importer - Popup Controller
// Version: v1.0.3 (Build 2026.11.15.5)
// License: MIT | Co-authored by Benjamin Goddard & Gemini

const statusEl = document.getElementById("status");
const countEl = document.getElementById("itemCount");
const auditCountEl = document.getElementById("auditCount");
const siteBadgeEl = document.getElementById("siteBadge");
const supplierInput = document.getElementById("supplierName");
const packQtyInput = document.getElementById("defaultPackQty");
const marginModeSelect = document.getElementById("marginMode");
const customMarginWrap = document.getElementById("customMarginWrap");
const customMarginInput = document.getElementById("customMarginPct");
const previewBoxEl = document.getElementById("previewBox");

const KNOWN_SUPPLIERS = {
  "www.thecycledivision.com": "The Cycle Division",
  "thecycledivision.com": "The Cycle Division",
  "ison-distribution.com": "Ison Distribution",
  "www.ison-distribution.com": "Ison Distribution"
};

function setStatus(text) {
  statusEl.textContent = text;
}

function refreshCounts() {
  chrome.runtime.sendMessage({ type: "GET_SKIMMED_ITEMS" }, (res) => {
    if (res && res.ok) {
      countEl.textContent = String(res.items.length);
    }
  });
  chrome.runtime.sendMessage({ type: "GET_AUDIT_LOGS" }, (res) => {
    if (res && res.ok) {
      auditCountEl.textContent = String(res.logs.length);
    }
  });
}

// Detect active site and auto-populate supplier badge
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url) return;
  try {
    const hostname = new URL(tab.url).hostname.toLowerCase();
    const matchedName = KNOWN_SUPPLIERS[hostname];
    if (matchedName) {
      siteBadgeEl.textContent = `Adapter: ${matchedName}`;
      if (!supplierInput.value.trim()) {
        supplierInput.placeholder = matchedName;
      }
    } else {
      siteBadgeEl.textContent = `Adapter: Generic / JSON-LD (${hostname})`;
    }
  } catch (_) {}
});

// Load saved settings
chrome.storage.local.get(["supplierName", "marginMode", "customMarginPct"], (data) => {
  if (data.supplierName) supplierInput.value = data.supplierName;
  if (data.marginMode) {
    marginModeSelect.value = data.marginMode;
    customMarginWrap.style.display = data.marginMode === "custom" ? "block" : "none";
  }
  if (data.customMarginPct) customMarginInput.value = data.customMarginPct;
});

supplierInput.addEventListener("change", () => {
  chrome.storage.local.set({ supplierName: supplierInput.value.trim() });
});

marginModeSelect.addEventListener("change", () => {
  const mode = marginModeSelect.value;
  customMarginWrap.style.display = mode === "custom" ? "block" : "none";
  chrome.storage.local.set({ marginMode: mode });
});

customMarginInput.addEventListener("change", () => {
  chrome.storage.local.set({ customMarginPct: customMarginInput.value });
});

// 1. Skim active B2B supplier tab (auto-selects Ison Table Adapter, Cycle Division WooCommerce, or Generic)
document.getElementById("btnSkimPage").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return setStatus("No active browser tab found.");

  const hostname = new URL(tab.url).hostname.toLowerCase();
  const autoSupplier = KNOWN_SUPPLIERS[hostname] || hostname;
  const supplier = supplierInput.value.trim() || autoSupplier;
  const packQty = Math.max(1, parseInt(packQtyInput.value || "1", 10));

  const marginOptions = {
    useRecommended: marginModeSelect.value === "recommended",
    customMarkup: Number(customMarginInput.value || 45)
  };

  setStatus(`Skimming ${supplier}...`);

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: (supplierLabel, defaultPack) => {
        const host = window.location.hostname.toLowerCase();
        const extracted = [];

        // Read breadcrumbs for Category / SubCategory if available
        const crumbs = Array.from(document.querySelectorAll("nav.breadcrumbs a, .woocommerce-breadcrumb a, .breadcrumb a"))
          .map((a) => a.textContent.trim())
          .filter((t) => t && t.toLowerCase() !== "home");
        const activeCategory = crumbs[0] || "";
        const activeSubCategory = document.querySelector("h1.heading, .woocommerce-products-header__title, h1")?.textContent?.trim() || crumbs[1] || "";

        // Adapter 1: Ison Distribution Table Layout (tr / td rows)
        if (host.includes("ison-distribution") || document.querySelector("table tr td small strong, table tr td img[src*='complete']")) {
          const rows = document.querySelectorAll("table tr");
          rows.forEach((row) => {
            const cells = row.querySelectorAll("td");
            if (cells.length >= 8) {
              const cell0 = cells[0]; // Title, specs, HS code
              const cell1 = cells[1]; // Colour/Option 1
              const cell2 = cells[2]; // Size/Option 2
              const cell4 = cells[4]; // SKU (e.g. PD5DARAS)
              const cell5 = cells[5]; // Stock check icon
              const cell6 = cells[6]; // RRP (e.g. £189.99)
              const cell7 = cells[7]; // Trade Price 1 (e.g. £118.11)
              const cell8 = cells[8]; // Trade Price 2 / Stockist if present (e.g. £102.70)
              const cellImg = cells[11] || cells[cells.length - 1]; // Image thumbnail/link

              const fullText = cell0?.textContent?.trim() || "";
              // Extract main title (everything before the first <br> or specs)
              const titleNode = cell0?.querySelector("small");
              const title = titleNode ? titleNode.textContent.split(",")[0].trim() || titleNode.textContent.trim() : fullText.split("\n")[0].trim();
              const sku = cell4?.querySelector("small")?.textContent?.trim() || cell4?.textContent?.trim() || "";
              
              const option1 = cell1?.textContent?.trim() || "";
              const option2 = cell2?.textContent?.trim() || "";

              const rrpText = cell6?.textContent || "0";
              const officialRrp = parseFloat(rrpText.replace(/[^0-9.]/g, "")) || 0;

              // Use best net trade price available (cell 8 if present and valid, otherwise cell 7)
              const priceCell = (cell8 && cell8.textContent.includes("£")) ? cell8 : cell7;
              const netPrice = parseFloat((priceCell?.textContent || "0").replace(/[^0-9.]/g, "")) || 0;

              const inStock = cell5?.querySelector(".fa-check, .text-success") !== null ||
                cell5?.textContent?.toLowerCase().includes("in stock") || true;

              const imgUrl = cellImg?.querySelector("img")?.src || cellImg?.querySelector("a")?.href || "";

              if (title && sku && netPrice > 0) {
                extracted.push({
                  sku,
                  barcode: "",
                  title: option1 ? `${title} - ${option1}` : title,
                  brand: "",
                  category: activeCategory,
                  subCategory: activeSubCategory,
                  supplier: supplierLabel,
                  cost: netPrice,
                  rrp: officialRrp,
                  stock: inStock ? 1 : 0,
                  packQty: defaultPack,
                  webDescription: fullText,
                  option1Name: option1 ? "Colour" : "",
                  option1Value: option1,
                  option2Name: option2 ? "Size" : "",
                  option2Value: option2,
                  images: imgUrl ? [imgUrl] : [],
                  visible: true
                });
              }
            }
          });
        }

        // Adapter 2: The Cycle Division / WooCommerce B2B Grid & List
        if (extracted.length === 0 && (host.includes("thecycledivision.com") || document.querySelector("ul.products li.product"))) {
          const cards = document.querySelectorAll(".facetwp-template ul.products li.product, main ul.products:not(.swiper-wrapper) li.product");
          cards.forEach((card) => {
            const titleEl = card.querySelector(".product-info h2.ts-product, .woocommerce-loop-product__title");
            const skuEl = card.querySelector("p.ts-sku, .sku");
            const cartBtn = card.querySelector(".add_to_cart_button[data-product_sku]");
            const priceEl = card.querySelector(".product-cart-wrap > span.ts-price .amount, .price > .amount, .price ins .amount");
            const rrpEl = card.querySelector(".rrp, .srp, del .amount");
            const stockEl = card.querySelector("p.stock");
            const imgEl = card.querySelector(".image img");
            const linkEl = card.querySelector(".product-info a[href], .image a[href*='/product/']");

            const title = titleEl?.textContent?.trim() || "";
            const sku = (skuEl?.textContent || cartBtn?.getAttribute("data-product_sku") || "").trim();
            const netPrice = parseFloat((priceEl?.textContent || "0").replace(/[^0-9.]/g, "")) || 0;
            const officialRrp = rrpEl ? (parseFloat(rrpEl.textContent.replace(/[^0-9.]/g, "")) || 0) : 0;

            const stockText = stockEl?.textContent?.trim() || "";
            const stockMatch = stockText.match(/(\d+)\s+in\s+stock/i);
            const stockQty = stockMatch ? parseInt(stockMatch[1], 10) : (stockText.toLowerCase().includes("in stock") ? 1 : 0);

            let brand = "";
            const catClass = Array.from(card.classList).find((c) => c.startsWith("product_cat-"));
            if (catClass) {
              const rawBrand = catClass.replace("product_cat-", "").split("-")[0];
              if (rawBrand && !["inner", "workshop", "wheelbarrow", "escooter"].includes(rawBrand)) {
                brand = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);
              }
            }

            if (title && sku) {
              extracted.push({
                sku,
                barcode: "",
                title,
                brand,
                category: activeCategory,
                subCategory: activeSubCategory,
                supplier: supplierLabel,
                cost: netPrice,
                rrp: officialRrp,
                stock: stockQty,
                packQty: defaultPack,
                webDescription: "",
                urlSlug: linkEl?.href || "",
                images: imgEl?.src ? [imgEl.src] : [],
                visible: true
              });
            }
          });
        }

        // Adapter 3: Schema.org JSON-LD fallback
        if (extracted.length === 0) {
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
                    category: activeCategory,
                    subCategory: activeSubCategory,
                    supplier: supplierLabel,
                    cost: Number(offer.price || 0),
                    rrp: 0,
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
        }

        // Adapter 4: Generic product card fallback
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
                category: activeCategory,
                subCategory: activeSubCategory,
                supplier: supplierLabel,
                cost: numericPrice,
                rrp: 0,
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

      chrome.runtime.sendMessage({ type: "SAVE_SKIMMED_ITEMS", items, marginOptions }, (res) => {
        refreshCounts();
        const processed = (res && res.processed) || [];
        const splitCount = processed.filter((p) => p.packSplitApplied).length;

        if (processed.length > 0) {
          const sample = processed[0];
          previewBoxEl.style.display = "block";
          previewBoxEl.innerHTML =
            `<strong>Sample (${sample.sku}):</strong> Net £${sample.cost.toFixed(2)} &rarr; ` +
            `+VAT £${sample.costIncVat.toFixed(2)} &rarr; ` +
            `<strong>Sell £${sample.rrp.toFixed(2)}</strong> (${sample.priceSource})`;
        }

        setStatus(`Saved ${items.length} item(s) (${splitCount} bulk pack/length split).`);
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
    setStatus(`Exported ${res.count} product(s) to Saledock CSV.`);
  });
});

// 3. Export Pricing & Pack Audit Log CSV
document.getElementById("btnExportAudit").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "EXPORT_AUDIT_CSV" }, (res) => {
    if (!res || !res.ok || res.count === 0) {
      return setStatus("Audit log is empty.");
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Saledock_PricingAuditLog_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${res.count} audit log record(s).`);
  });
});

// 4. Saledock Back-Office OOSP & Publish Macro
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

// 5. Clear IndexedDB Queue
document.getElementById("btnClear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_SKIMMED_ITEMS" }, () => {
    previewBoxEl.style.display = "none";
    refreshCounts();
    setStatus("Skimmed queue cleared (Audit log retained).");
  });
});

refreshCounts();
