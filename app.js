const CSS_URL = "./assets/caveduck.css";
const MAX_ROWS = 220;

const categoryRules = [
  ["Layout", /^(container|static|fixed|absolute|relative|sticky|inset|top|right|bottom|left|z-|float|clear|isolate|object-|overflow|overscroll)/],
  ["Display", /^(block|inline|hidden|flex|grid|table|contents|flow-root|visible|collapse|sr-only|not-sr-only)/],
  ["Spacing", /^(m[trblxy]?|p[trblxy]?|space-[xy]|gap|scroll-m|scroll-p)-/],
  ["Sizing", /^(w|h|min-w|min-h|max-w|max-h|size|aspect)-/],
  ["Typography", /^(font|text|leading|tracking|list|placeholder|decoration|underline|overline|line-through|uppercase|lowercase|capitalize|normal-case|truncate|break|whitespace|align|antialiased|subpixel)/],
  ["Color", /^(bg|from|via|to|fill|stroke|accent|caret|border|outline|ring|divide)-/],
  ["Effects", /^(shadow|opacity|mix-blend|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop|filter)/],
  ["Border", /^(rounded|border|divide|outline|ring)-/],
  ["Transform", /^(transform|translate|scale|rotate|skew|origin)-/],
  ["Animation", /^(animate|transition|duration|ease|delay)-/],
  ["Interaction", /^(cursor|select|resize|pointer-events|touch|snap|scroll|appearance|outline|focus|hover|active|disabled|group|peer)/],
];

const state = {
  classes: [],
  varProviders: new Map(),
  category: "All",
  query: "",
  selected: null,
  previewBg: "checker",
};

const els = {
  tabs: document.querySelector("#categoryTabs"),
  list: document.querySelector("#classList"),
  search: document.querySelector("#classSearch"),
  count: document.querySelector("#resultCount"),
  selectedClass: document.querySelector("#selectedClass"),
  selectedCategory: document.querySelector("#selectedCategory"),
  selectedCss: document.querySelector("#selectedCss"),
  selectedVars: document.querySelector("#selectedVars"),
  detailPreview: document.querySelector("#detailPreview"),
  copySelected: document.querySelector("#copySelected"),
  previewBgButtons: document.querySelectorAll("button[data-preview-bg]"),
  toast: document.querySelector("#toast"),
};

init();

async function init() {
  try {
    const cssText = await fetch(CSS_URL).then((response) => {
      if (!response.ok) throw new Error(`Unable to load ${CSS_URL}`);
      return response.text();
    });
    state.classes = parseClasses(cssText);
    state.varProviders = buildVariableProviders(state.classes);
    state.selected = state.classes[0] || null;
    document.body.dataset.previewBg = state.previewBg;
    bindEvents();
    render();
  } catch (error) {
    els.list.innerHTML = `<div class="ccr-empty">CSS 載入失敗：${escapeHtml(error.message)}</div>`;
    els.selectedClass.textContent = "Load failed";
  }
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  els.copySelected.addEventListener("click", () => {
    if (state.selected) copyClass(state.selected.name);
  });

  els.previewBgButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.previewBg = button.dataset.previewBg;
      document.body.dataset.previewBg = state.previewBg;
      els.previewBgButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });
}

function parseClasses(cssText) {
  const cleanCss = cssText.replace(/@import[^;]+;/g, "");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cleanCss);
  const classMap = new Map();

  walkRules(sheet.cssRules, (rule) => {
    if (!rule.selectorText || !rule.style) return;
    const declaration = summarizeDeclaration(rule.style.cssText);
    if (!declaration) return;

    extractClassNames(rule.selectorText).forEach((name) => {
      if (!isReferenceClass(name)) return;
      const existing = classMap.get(name);
      const cssText = existing ? mergeCssText(existing.cssText, rule.style.cssText) : rule.style.cssText;
      const mergedDeclaration = summarizeDeclaration(cssText);
      classMap.set(name, {
        name,
        declaration: mergedDeclaration,
        cssText,
        category: existing?.category || categorize(name, mergedDeclaration),
        previewKind: previewKind(name, mergedDeclaration),
      });
    });
  });

  return Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function walkRules(rules, visit) {
  Array.from(rules).forEach((rule) => {
    if (rule.cssRules) walkRules(rule.cssRules, visit);
    visit(rule);
  });
}

function extractClassNames(selectorText) {
  const found = new Set();
  const regex = /\.((?:\\.|[A-Za-z0-9_!/\-[\].])+)/g;
  let match;
  while ((match = regex.exec(selectorText))) {
    found.add(cssUnescape(match[1]));
  }
  return found;
}

function cssUnescape(value) {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
}

function isReferenceClass(name) {
  if (!name || name.length > 96) return false;
  if (/^\d/.test(name)) return false;
  if (name.includes("://") || name.includes(".com")) return false;
  return /[A-Za-z_-]/.test(name);
}

function summarizeDeclaration(cssText) {
  return cssText
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
}

function mergeCssText(first, second) {
  const merged = declarationMap(first);
  declarationMap(second).forEach((value, property) => {
    merged.set(property, value);
  });
  return Array.from(merged, ([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function categorize(name, declaration) {
  const base = stripVariants(name);
  const matched = categoryRules.find(([, pattern]) => pattern.test(base));
  if (matched) return matched[0];
  if (/color|background|oklch|rgb|#[0-9a-f]/i.test(declaration)) return "Color";
  return "Utilities";
}

function stripVariants(name) {
  const parts = name.split(":");
  return parts[parts.length - 1].replace(/^!/, "").replace(/^-/, "");
}

function previewKind(name, declaration) {
  const base = stripVariants(name);
  if (/^(text|font|leading|tracking|underline|decoration|uppercase|lowercase|capitalize)/.test(base)) return "text";
  if (/^(w|h|min|max|size|aspect|p|m|rounded|border|shadow|bg|opacity|rotate|scale|translate)/.test(base)) return "box";
  if (/^(flex|grid|block|inline|hidden)/.test(base)) return "layout";
  if (/color|background|border|shadow|width|height|padding|margin|transform|display/i.test(declaration)) return "box";
  return "text";
}

function render() {
  const counts = buildCategoryCounts();
  renderTabs(counts);
  const filtered = getFilteredClasses();
  els.count.textContent = filtered.length.toLocaleString();
  if (!filtered.includes(state.selected)) state.selected = filtered[0] || state.classes[0] || null;
  renderList(filtered.slice(0, MAX_ROWS), filtered.length);
  renderDetail();
}

function buildCategoryCounts() {
  const counts = new Map([["All", state.classes.length]]);
  state.classes.forEach((item) => counts.set(item.category, (counts.get(item.category) || 0) + 1));
  return counts;
}

function renderTabs(counts) {
  const categories = ["All", ...Array.from(counts.keys()).filter((key) => key !== "All").sort()];
  els.tabs.innerHTML = categories
    .map((category) => {
      const active = category === state.category ? " is-active" : "";
      return `<button class="ccr-tab${active}" type="button" data-category="${escapeHtml(category)}">
        <strong>${escapeHtml(category)}</strong><span>${counts.get(category)}</span>
      </button>`;
    })
    .join("");

  els.tabs.querySelectorAll(".ccr-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.category = tab.dataset.category;
      render();
    });
  });
}

function getFilteredClasses() {
  const terms = state.query.split(/\s+/).filter(Boolean);
  return state.classes.filter((item) => {
    if (state.category !== "All" && item.category !== state.category) return false;
    if (!terms.length) return true;
    const haystack = `${item.name} ${item.category} ${item.declaration}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function renderList(items, total) {
  if (!items.length) {
    els.list.innerHTML = '<div class="ccr-empty">找不到符合條件的 class</div>';
    return;
  }

  const limitNote =
    total > MAX_ROWS
      ? `<div class="ccr-empty">顯示前 ${MAX_ROWS} 筆；請輸入更精確的搜尋字串縮小範圍。</div>`
      : "";

  els.list.innerHTML =
    items
      .map((item) => {
        const selected = item === state.selected ? " is-selected" : "";
        return `<article class="ccr-row${selected}" data-class="${escapeHtml(item.name)}">
          <div class="ccr-class-cell">
            <code class="ccr-class-name">${escapeHtml(item.name)}</code>
            <button class="ccr-copy" type="button" aria-label="Copy ${escapeHtml(item.name)}">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M8 8V5.8c0-1 .8-1.8 1.8-1.8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H16"></path>
                <path d="M4 9.8C4 8.8 4.8 8 5.8 8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V9.8Z"></path>
              </svg>
            </button>
          </div>
          <div class="ccr-summary">${escapeHtml(item.declaration)}</div>
          <div class="ccr-mini-preview">${previewMarkup(item)}</div>
        </article>`;
      })
      .join("") + limitNote;

  els.list.querySelectorAll(".ccr-row").forEach((row) => {
    row.addEventListener("click", () => selectClass(row.dataset.class));
    row.querySelector(".ccr-copy").addEventListener("click", (event) => {
      event.stopPropagation();
      copyClass(row.dataset.class);
    });
  });
}

function selectClass(name) {
  state.selected = state.classes.find((item) => item.name === name) || state.selected;
  renderDetail();
  els.list.querySelectorAll(".ccr-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.class === name);
  });
}

function renderDetail() {
  if (!state.selected) return;
  els.selectedClass.textContent = state.selected.name;
  els.selectedCategory.textContent = state.selected.category;
  els.selectedCss.textContent = state.selected.declaration;
  els.selectedVars.innerHTML = variableValueMarkup(state.selected);
  els.detailPreview.innerHTML = previewMarkup(state.selected, true);
}

function variableValueMarkup(item) {
  const references = extractVariableReferences(item.cssText);
  if (!references.length) return '<span class="ccr-muted-value">No variable reference</span>';

  const localDeclarations = declarationMap(item.cssText);
  const rootStyle = getComputedStyle(document.documentElement);
  return references
    .map(({ name, fallback }) => {
      const localValue = localDeclarations.get(name);
      if (localValue) return variableLine(name, localValue, "this class");

      const rootValue = rootStyle.getPropertyValue(name).trim();
      if (rootValue) return variableLine(name, rootValue, ":root");

      const providers = (state.varProviders.get(name) || []).filter((provider) => provider.name !== item.name);
      if (providers.length) {
        const providerText = providers
          .slice(0, 3)
          .map((provider) => `${provider.name} = ${provider.value}`)
          .join("; ");
        const more = providers.length > 3 ? `; +${providers.length - 3} more` : "";
        return variableLine(name, `${providerText}${more}`, "provided by class");
      }

      if (fallback !== null) {
        const value = fallback || "empty fallback";
        return variableLine(name, value, "fallback");
      }

      return variableLine(name, "not defined", "unresolved");
    })
    .join("");
}

function buildVariableProviders(items) {
  const providers = new Map();
  items.forEach((item) => {
    declarationMap(item.cssText).forEach((value, property) => {
      if (!property.startsWith("--")) return;
      if (!providers.has(property)) providers.set(property, []);
      providers.get(property).push({ name: item.name, value });
    });
  });
  return providers;
}

function extractVariableReferences(cssText) {
  const references = new Map();
  const regex = /var\((--[A-Za-z0-9_-]+)(?:,([^)]*))?\)/g;
  let match;
  while ((match = regex.exec(cssText))) {
    if (!references.has(match[1])) {
      references.set(match[1], {
        name: match[1],
        fallback: match[2] === undefined ? null : match[2].trim(),
      });
    }
  }
  return Array.from(references.values());
}

function variableLine(name, value, source) {
  return `<code class="ccr-var-value"><span>${escapeHtml(name)}:</span> ${escapeHtml(value)} <em>${escapeHtml(source)}</em></code>`;
}

function previewMarkup(item, large = false) {
  const label = item.previewKind === "text" ? "Sample text" : "Preview";
  const sizeClass = large ? " is-large" : "";
  const kindClass = ` is-${item.previewKind}`;
  const style = previewStyle(item);
  return `<div class="ccr-preview-canvas${sizeClass}${kindClass}">
    ${previewGuide(item)}
    <div class="ccr-preview-subject" style="${escapeHtml(style)}">${escapeHtml(label)}</div>
  </div>`;
}

function previewStyle(item) {
  const declarations = declarationMap(item.cssText);
  const base = [
    "box-sizing: border-box",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "min-width: 44px",
    "min-height: 28px",
    "padding: 6px 10px",
    "border: 1px dashed rgba(8, 127, 140, 0.34)",
    "border-radius: 4px",
    "background-color: rgba(228, 246, 247, 0.9)",
    "color: #12313d",
    "font-size: 12px",
    "line-height: 1.2",
    "text-align: center",
  ];

  if (item.previewKind === "text") {
    base.push("min-width: 72px", "background-color: #ffffff");
  }

  if (item.previewKind === "layout") {
    base.push("width: 86px", "gap: 6px");
  }

  if (hasOffsetDeclaration(declarations) && !declarations.has("position")) {
    base.push("position: relative");
  }

  const removes = removalKeysFor(declarations);
  const baseCss = base.filter((entry) => !removes.has(entry.split(":")[0])).join("; ");
  return `${baseCss}; ${item.cssText}`;
}

function declarationMap(cssText) {
  const map = new Map();
  cssText
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const index = part.indexOf(":");
      if (index > -1) map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    });
  return map;
}

function removalKeysFor(declarations) {
  const keys = new Set();
  declarations.forEach((_, property) => {
    keys.add(property);
    if (property === "background-color" || property === "background") keys.add("background-color");
    if (property === "border" || /^border(-(width|style|inline|block|top|right|bottom|left))?$/.test(property)) {
      keys.add("border");
    }
    if (property === "border-radius" || property.startsWith("border-") && property.endsWith("-radius")) {
      keys.add("border-radius");
    }
    if (property === "padding" || property.startsWith("padding-")) keys.add("padding");
    if (property === "display") keys.add("display");
    if (property === "width") {
      keys.add("width");
      keys.add("min-width");
    }
    if (property === "height") {
      keys.add("height");
      keys.add("min-height");
    }
    if (property === "font-size") keys.add("font-size");
    if (property === "line-height") keys.add("line-height");
    if (property === "color") keys.add("color");
  });
  return keys;
}

function hasOffsetDeclaration(declarations) {
  return ["top", "right", "bottom", "left", "inset", "inset-block", "inset-inline"].some((property) =>
    declarations.has(property)
  );
}

function previewGuide(item) {
  const cssText = item.cssText;
  if (/margin|translate|rotate|scale|skew|top:|right:|bottom:|left:|position:/i.test(cssText)) {
    return '<div class="ccr-preview-origin" aria-hidden="true"></div>';
  }
  if (/display:\s*(flex|grid)/i.test(cssText)) {
    return '<span class="ccr-preview-dot"></span><span class="ccr-preview-dot"></span><span class="ccr-preview-dot"></span>';
  }
  return "";
}

async function copyClass(name) {
  await navigator.clipboard.writeText(name);
  els.toast.textContent = `Copied ${name}`;
  els.toast.classList.add("is-visible");
  window.clearTimeout(copyClass.timer);
  copyClass.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 1200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}
