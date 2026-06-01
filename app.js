const CSS_URL = "./assets/caveduck.css";
const PAGE_SIZE = 80;
const FAMILY_LIMIT = 20;

const categoryRules = [
  ["Layout", /^(container|static|fixed|absolute|relative|sticky|inset|top|right|bottom|left|z-|float|clear|isolate|object-|overflow|overscroll)/],
  ["Display", /^(block|inline|hidden|flex|grid|table|contents|flow-root|visible|collapse|sr-only|not-sr-only)/],
  ["Spacing", /^(m[trblxy]?|p[trblxy]?|space-[xy]|gap|scroll-m|scroll-p)-/],
  ["Sizing", /^(w|h|min-w|min-h|max-w|max-h|size|aspect|basis)-/],
  ["Typography", /^(font|text|leading|tracking|list|placeholder|decoration|underline|overline|line-through|uppercase|lowercase|capitalize|normal-case|truncate|break|whitespace|align|antialiased|subpixel|prose|line-clamp)/],
  ["Color", /^(bg|from|via|to|fill|stroke|accent|caret|border|outline|ring|divide)-/],
  ["Effects", /^(shadow|opacity|mix-blend|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop|filter)/],
  ["Border", /^(rounded|border|divide|outline|ring)-/],
  ["Transform", /^(transform|translate|scale|rotate|skew|origin)-/],
  ["Animation", /^(animate|transition|duration|ease|delay)-/],
  ["Interaction", /^(cursor|select|resize|pointer-events|touch|snap|scroll|appearance|focus|hover|active|disabled|group|peer|aria)/],
];

const usageOrder = [
  "All",
  "常用版面",
  "狀態欄常用",
  "文字排版",
  "色彩",
  "裝飾",
  "手機檢查",
  "Caveduck 特有",
  "易誤用",
];

const state = {
  classes: [],
  families: new Map(),
  varProviders: new Map(),
  category: "All",
  usage: "All",
  page: 1,
  viewMode: "classes",
  query: "",
  selected: null,
  previewBg: "checker",
};

const els = {
  tabs: document.querySelector("#categoryTabs"),
  usageTabs: document.querySelector("#usageTabs"),
  list: document.querySelector("#classList"),
  search: document.querySelector("#classSearch"),
  count: document.querySelector("#resultCount"),
  selectedClass: document.querySelector("#selectedClass"),
  detailContent: document.querySelector("#detailContent"),
  detailPreview: document.querySelector("#detailPreview"),
  copySelected: document.querySelector("#copySelected"),
  previewBgButtons: document.querySelectorAll("button[data-preview-bg]"),
  viewButtons: document.querySelectorAll("button[data-view-mode]"),
  viewLabel: document.querySelector("#viewLabel"),
  toast: document.querySelector("#toast"),
};

init();

async function init() {
  try {
    const cssText = await fetch(CSS_URL).then((response) => {
      if (!response.ok) throw new Error(`Unable to load ${CSS_URL}`);
      return response.text();
    });
    state.classes = enrichClasses(parseClasses(cssText));
    state.varProviders = buildVariableProviders(state.classes);
    state.families = buildFamilies(state.classes);
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
    state.page = 1;
    state.viewMode = "classes";
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

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.viewMode = button.dataset.viewMode;
      state.page = 1;
      render();
    });
  });

  document.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy-value]");
    if (copyButton) {
      copyClass(copyButton.dataset.copyValue);
      return;
    }

    const familyButton = event.target.closest("[data-select-class]");
    if (familyButton) {
      state.selected = state.classes.find((item) => item.name === familyButton.dataset.selectClass) || state.selected;
      state.viewMode = "family";
      state.page = 1;
      render();
      return;
    }

    const tagButton = event.target.closest("[data-tag-value]");
    if (tagButton) {
      applyTagFilter(tagButton.dataset.tagValue);
    }
  });
}

function parseClasses(cssText) {
  const cleanCss = cssText.replace(/@import[^;]+;/g, "");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cleanCss);
  const classMap = new Map();

  walkRules(sheet.cssRules, (rule) => {
    if (!rule.selectorText || !rule.style) return;
    if (!summarizeDeclaration(rule.style.cssText)) return;

    extractClassNames(rule.selectorText).forEach((name) => {
      if (!isReferenceClass(name)) return;
      const existing = classMap.get(name);
      const cssText = existing ? mergeCssText(existing.cssText, rule.style.cssText) : rule.style.cssText;
      const declaration = summarizeDeclaration(cssText);
      classMap.set(name, {
        name,
        declaration,
        cssText,
        category: existing?.category || categorize(name, declaration),
      });
    });
  });

  return Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function enrichClasses(items) {
  return items.map((item) => {
    const meta = buildMetadata(item);
    return {
      ...item,
      ...meta,
      searchText: [
        item.name,
        item.declaration,
        item.category,
        meta.usageCategory,
        meta.usageTags.join(" "),
        meta.previewType,
        meta.purpose,
        meta.requirements.join(" "),
        meta.riskTags.join(" "),
        meta.familyKey,
      ]
        .join(" ")
        .toLowerCase(),
    };
  });
}

function buildMetadata(item) {
  const base = stripVariants(item.name);
  const declarations = declarationMap(item.cssText);
  const previewType = detectPreviewType(base, declarations, item.name);
  const riskTags = detectRiskTags(base, declarations, item.name, previewType);
  const usageTags = detectUsageTags(base, declarations, item.name, riskTags);
  return {
    previewType,
    usageCategory: usageTags[0],
    usageTags,
    riskTags,
    requirements: detectRequirements(base, declarations, item.name, previewType),
    purpose: describePurpose(base, declarations, item.name, previewType),
    exampleHtml: exampleHtmlFor(item.name, previewType, base),
    inlineStyle: `style="${styleAttribute(item.cssText)}"`,
    classSnippet: `class="${item.name}"`,
    familyKey: familyKeyFor(base, item.name),
  };
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
  if (name.endsWith(":")) return false;
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
  return Array.from(merged, ([property, value]) => `${property}: ${value}`).join("; ");
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

function detectPreviewType(base, declarations, name) {
  if (/^(sr-only|hidden|invisible|collapse|pointer-events|cursor|select|resize|appearance|touch|snap|aria|group|peer)/.test(base)) return "no-preview";
  if (/^(hover|focus|active|disabled):/.test(name) || /(^|:)hover:|(^|:)focus:|(^|:)active:/.test(name)) return "state-preview";
  if (/^(duration|transition|delay|ease)-/.test(base)) return "no-preview";
  if (/^(top|right|bottom|left|inset|z-|absolute|relative|fixed|sticky|static|translate|rotate|scale|skew|transform)/.test(base) || hasAnyDeclaration(declarations, ["top", "right", "bottom", "left", "inset", "position", "z-index", "translate", "rotate", "scale", "transform"])) return "position-preview";
  if (/^(m[trblxy]?|p[trblxy]?|gap|space-[xy])-/.test(base) || hasDeclarationLike(declarations, /^(margin|padding|gap|row-gap|column-gap)/)) return "spacing-preview";
  if (/^(bg|text|border|fill|stroke|accent|caret|from|via|to)-/.test(base) || hasDeclarationLike(declarations, /(color|background|fill|stroke)/)) return "color-preview";
  if (/^(font|text|leading|tracking|truncate|line-clamp|whitespace|break|decoration|underline|uppercase|lowercase|capitalize|prose)/.test(base) || hasDeclarationLike(declarations, /(font|line-height|letter-spacing|text-overflow|white-space)/)) return "typography-preview";
  if (/^(flex|grid|block|inline|table|contents|flow-root|container|overflow|object|aspect|w-|h-|min-|max-|basis)/.test(base) || hasDeclarationLike(declarations, /^(display|grid|flex|overflow|width|height|max-width|min-width|aspect-ratio)/)) return "layout-preview";
  if (/^(shadow|opacity|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop|filter|mix-blend|animate|transition|duration|ease|delay|rotate|scale|translate|skew)/.test(base) || hasDeclarationLike(declarations, /(box-shadow|filter|opacity|transform|rotate|scale|translate|animation|transition)/)) return "effect-preview";
  return "no-preview";
}

function detectUsageTags(base, declarations, name, riskTags) {
  const tags = [];
  if (isCaveduckSpecific(name, declarations)) tags.push("Caveduck 特有");
  if (isMobileRisk(base, declarations)) tags.push("手機檢查");
  if (/^(font|text|leading|tracking|truncate|line-clamp|whitespace|break|prose|decoration|underline)/.test(base)) tags.push("文字排版");
  if (/^(bg|text|border|fill|stroke|accent|caret|from|via|to)-/.test(base) || hasDeclarationLike(declarations, /(color|background)/)) tags.push("色彩");
  if (/^(shadow|blur|backdrop|filter|opacity|rounded|border|gradient|animate|transition|rotate|scale|translate)/.test(base)) tags.push("裝飾");
  if (/^(details|summary|border|rounded|bg|text|font|space|grid)/.test(base)) tags.push("狀態欄常用");
  if (riskTags.length) tags.push("易誤用");
  if (!tags.length) tags.push("常用版面");
  return Array.from(new Set(tags));
}

function detectRiskTags(base, declarations, name, previewType) {
  const tags = [];
  if (/^(top|right|bottom|left|inset|z-)/.test(base)) tags.push("需要定位容器");
  if (isMobileRisk(base, declarations)) tags.push("可能造成手機橫向爆版");
  if (/^(truncate|text-ellipsis|line-clamp)/.test(base)) tags.push("需要 overflow 條件");
  if (previewType === "no-preview") tags.push("可能沒有明顯預覽");
  if (isCaveduckSpecific(name, declarations)) tags.push("Caveduck 特有");
  return tags;
}

function detectRequirements(base, declarations, name, previewType) {
  if (/^(top|right|bottom|left|inset|z-)/.test(base)) return ["需搭配 position: relative / absolute / fixed / sticky；單獨使用時可能沒有可見效果。"];
  if (/^(truncate|text-ellipsis|line-clamp)/.test(base)) return ["需有寬度限制與 overflow 條件，文字超出時才看得出效果。"];
  if (/^(gap|space-[xy])/.test(base)) return ["需套在 flex / grid 或有多個子元素的容器上。"];
  if (/^(group|peer|aria|hover|focus|active|disabled)/.test(name) || previewType === "state-preview") return ["需要特定互動狀態、父層 class 或 ARIA/data 狀態才會觸發。"];
  if (previewType === "no-preview") return ["此 class 偏行為或瀏覽器狀態，通常無法用單一靜態方塊完整預覽。"];
  if (hasDeclarationLike(declarations, /var\(--tw-/)) return ["部分 Tailwind 組合變數需要搭配同系列 class 才會產生完整效果。"];
  return ["可直接套用在 Caveduck 允許的 HTML 元素 class 屬性上。"];
}

function describePurpose(base, declarations, name, previewType) {
  if (/^(top|right|bottom|left|inset)/.test(base)) return "控制元素相對定位容器的位移。";
  if (/^z-/.test(base)) return "控制元素堆疊順序。";
  if (/^(m[trblxy]?)-/.test(base)) return "控制元素外距，影響它和周圍內容的距離。";
  if (/^(p[trblxy]?)-/.test(base)) return "控制元素內距，影響內容和邊界的距離。";
  if (/^gap/.test(base)) return "控制 flex / grid 子元素之間的間距。";
  if (/^font/.test(base)) return "控制字型家族、字重或字型相關設定。";
  if (/^(text|leading|tracking|truncate|line-clamp|whitespace)/.test(base)) return "控制文字大小、顏色、行高、截斷或排版行為。";
  if (/^(bg|from|via|to)/.test(base)) return "控制背景色、漸層或背景相關效果。";
  if (/^(border|rounded|ring|outline)/.test(base)) return "控制邊框、圓角、外框或 focus ring 視覺。";
  if (/^(flex|grid|block|inline|hidden|overflow|container|w-|h-|min-|max-)/.test(base)) return "控制版面、顯示方式、尺寸或溢出行為。";
  if (/^(shadow|blur|backdrop|filter|opacity|animate|transition|rotate|scale|translate)/.test(base)) return "控制陰影、濾鏡、透明度、動畫或變形效果。";
  if (isCaveduckSpecific(name, declarations)) return "Caveduck CSS 中的自訂 class 或設計 token，可用於貼近站內既有風格。";
  return `${previewTypeLabel(previewType)} 類 utility，效果來自 CSS declaration。`;
}

function exampleHtmlFor(className, previewType, base) {
  if (previewType === "position-preview") {
    return `<div class="relative">\n  <div class="absolute ${className}">內容</div>\n</div>`;
  }
  if (previewType === "spacing-preview") return `<div class="${className}">內容</div>`;
  if (previewType === "typography-preview") return `<p class="${className}">這是一段 Caveduck 文字內容</p>`;
  if (previewType === "layout-preview") {
    if (/^(flex|grid|gap|space)/.test(base)) return `<div class="${className}">\n  <span>項目</span>\n  <span>項目</span>\n</div>`;
    return `<div class="${className}">內容</div>`;
  }
  return `<span class="${className}">內容</span>`;
}

function familyKeyFor(base, name) {
  const normalized = base.replace(/^!/, "").replace(/^-/, "");
  if (/^(top|right|bottom|left|inset)/.test(normalized)) return normalized.split("-")[0];
  if (/^(font|leading|tracking|text|bg|border|rounded|shadow|opacity|blur|backdrop|filter|overflow|grid-cols|col|row|gap|space|w|h|min-w|min-h|max-w|max-h|p|m|px|py|pt|pr|pb|pl|mx|my|mt|mr|mb|ml)-/.test(normalized)) {
    const parts = normalized.split("-");
    if ((parts[0] === "bg" || parts[0] === "text" || parts[0] === "border") && /^(duck|dgray|background|primary|error)/.test(parts[1] || "")) return `${parts[0]}-${parts[1]}`;
    if (parts[0] === "min" || parts[0] === "max") return `${parts[0]}-${parts[1]}`;
    return parts[0];
  }
  return name.split(":").slice(-1)[0].split("-")[0];
}

function buildFamilies(items) {
  const families = new Map();
  items.forEach((item) => {
    if (!families.has(item.familyKey)) families.set(item.familyKey, []);
    families.get(item.familyKey).push(item);
  });
  return families;
}

function hasDeclarationLike(declarations, pattern) {
  return Array.from(declarations.keys()).some((property) => pattern.test(property)) ||
    Array.from(declarations.values()).some((value) => pattern.test(value));
}

function hasAnyDeclaration(declarations, names) {
  return names.some((name) => declarations.has(name));
}

function isMobileRisk(base, declarations) {
  return /^(min-w|max-w-none|w-\[|whitespace-nowrap|grid-cols-[5-9])/.test(base) ||
    /width:\s*(3[2-9]\d|[4-9]\d\d)px|min-width|max-width:\s*none|white-space:\s*nowrap/.test(serializeDeclarations(declarations));
}

function isCaveduckSpecific(name, declarations) {
  return /(duck|dgray|caveduck|official|bottom-bar|character-|wedding|snapshot|album-swiper|font-(pretendard|notoKr|racing|playfair|cormorant))/i.test(name) ||
    /(duck|dgray|caveduck|wedding|font-cormorant|font-playfair|font-racing|font-pretendard)/i.test(serializeDeclarations(declarations));
}

function previewTypeLabel(type) {
  return {
    "position-preview": "定位",
    "spacing-preview": "間距",
    "color-preview": "色彩",
    "typography-preview": "文字排版",
    "layout-preview": "版面",
    "effect-preview": "裝飾效果",
    "state-preview": "互動狀態",
    "no-preview": "行為",
  }[type] || "CSS";
}

function serializeDeclarations(declarations) {
  return Array.from(declarations, ([property, value]) => `${property}: ${value}`).join("; ");
}

function styleAttribute(cssText) {
  return cssText.replace(/"/g, "&quot;");
}

function render() {
  const categoryCounts = buildCounts("category");
  const usageCounts = buildCounts("usageCategory");
  renderTabs(els.tabs, ["All", ...Array.from(categoryCounts.keys()).filter((key) => key !== "All").sort()], categoryCounts, "category");
  renderTabs(els.usageTabs, usageOrder, usageCounts, "usage");
  const filtered = getVisibleClasses();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  els.count.textContent = filtered.length.toLocaleString();
  if (!filtered.includes(state.selected)) state.selected = filtered[0] || state.classes[0] || null;
  renderViewControls(filtered.length);
  const start = (state.page - 1) * PAGE_SIZE;
  renderList(filtered.slice(start, start + PAGE_SIZE), filtered.length, totalPages);
  renderDetail();
}

function buildCounts(key) {
  const counts = new Map([["All", state.classes.length]]);
  state.classes.forEach((item) => {
    const values = key === "usageCategory" ? item.usageTags : [item[key]];
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  });
  return counts;
}

function renderTabs(container, categories, counts, stateKey) {
  container.innerHTML = categories
    .map((category) => {
      const active = category === state[stateKey] ? " is-active" : "";
      return `<button class="ccr-tab${active}" type="button" data-filter-key="${stateKey}" data-filter-value="${escapeHtml(category)}">
        <strong>${escapeHtml(category)}</strong><span>${counts.get(category) || 0}</span>
      </button>`;
    })
    .join("");

  container.querySelectorAll(".ccr-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state[tab.dataset.filterKey] = tab.dataset.filterValue;
      state.page = 1;
      state.viewMode = "classes";
      render();
    });
  });
}

function getFilteredClasses() {
  const terms = state.query.split(/\s+/).filter(Boolean);
  return state.classes.filter((item) => {
    if (state.category !== "All" && item.category !== state.category) return false;
    if (state.usage !== "All" && !item.usageTags.includes(state.usage)) return false;
    if (!terms.length) return true;
    return terms.every((term) => item.searchText.includes(term));
  });
}

function getVisibleClasses() {
  if (state.viewMode !== "family") return getFilteredClasses();
  const key = state.selected?.familyKey;
  if (!key) return [];
  return state.families.get(key) || [];
}

function renderViewControls(total) {
  els.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewMode === state.viewMode);
  });

  if (state.viewMode === "family" && state.selected) {
    els.viewLabel.textContent = `${state.selected.familyKey} 同系列：${total.toLocaleString()} classes`;
    return;
  }
  els.viewLabel.textContent = "";
}

function renderList(items, total, totalPages) {
  if (!items.length) {
    els.list.innerHTML = '<div class="ccr-empty">找不到符合條件的 class</div>';
    return;
  }

  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(state.page * PAGE_SIZE, total);

  els.list.innerHTML =
    items
      .map((item) => {
        const selected = item === state.selected ? " is-selected" : "";
        return `<article class="ccr-row${selected}" data-class="${escapeHtml(item.name)}">
          <div class="ccr-class-cell">
            <code class="ccr-class-name">${escapeHtml(item.name)}</code>
            <button class="ccr-copy" type="button" data-copy-value="${escapeHtml(item.name)}" aria-label="Copy ${escapeHtml(item.name)}">
              ${copyIcon()}
            </button>
          </div>
          <div class="ccr-summary">
            <span>${escapeHtml(item.declaration)}</span>
            ${calcSummaryMarkup(item)}
            <span class="ccr-row-tags">${tagMarkup([...item.usageTags.slice(0, 2), ...item.riskTags.slice(0, 1)], true)}</span>
          </div>
          <div class="ccr-mini-preview">${previewMarkup(item)}</div>
        </article>`;
      })
      .join("") + paginationMarkup(start, end, total, totalPages);

  els.list.querySelectorAll(".ccr-row").forEach((row) => {
    row.addEventListener("click", () => selectClass(row.dataset.class));
  });

  els.list.querySelectorAll("[data-page-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.page += button.dataset.pageAction === "next" ? 1 : -1;
      render();
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
  const item = state.selected;
  els.selectedClass.textContent = item.name;
  els.detailPreview.innerHTML = previewMarkup(item, true);
  els.detailContent.innerHTML = `
    <section class="ccr-detail-section">
      <h3>用途</h3>
      <p>${escapeHtml(item.purpose)}</p>
      <div class="ccr-tag-list">${tagMarkup([item.previewType, item.category, ...item.usageTags, ...item.riskTags], true)}</div>
    </section>
    <section class="ccr-detail-section">
      <h3>必要搭配</h3>
      ${listMarkup(item.requirements)}
    </section>
    <section class="ccr-detail-section">
      <h3>常見誤用</h3>
      ${listMarkup(item.riskTags.length ? item.riskTags : ["目前未標記高風險條件。"])}
    </section>
    <section class="ccr-detail-section">
      <div class="ccr-section-heading">
        <h3>CSS declaration</h3>
        <button class="ccr-section-copy" type="button" data-copy-value="${escapeHtml(item.cssText)}" aria-label="Copy CSS declaration">${copyIcon()}</button>
      </div>
      <code class="ccr-code-block">${escapeHtml(item.cssText)}</code>
      ${calcDetailMarkup(item)}
    </section>
    <section class="ccr-detail-section">
      <h3>Variable values</h3>
      <div class="ccr-var-list">${variableValueMarkup(item)}</div>
    </section>
    <section class="ccr-detail-section">
      <h3>同系列</h3>
      ${familyMarkup(item)}
    </section>`;
}

function listMarkup(items) {
  return `<ul class="ccr-note-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function paginationMarkup(start, end, total, totalPages) {
  if (totalPages <= 1) return "";
  return `<div class="ccr-pagination">
    <span>${start.toLocaleString()}-${end.toLocaleString()} / ${total.toLocaleString()}</span>
    <div>
      <button type="button" data-page-action="prev" ${state.page === 1 ? "disabled" : ""}>Prev</button>
      <strong>${state.page} / ${totalPages}</strong>
      <button type="button" data-page-action="next" ${state.page === totalPages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function familyMarkup(item) {
  const family = (state.families.get(item.familyKey) || []).slice(0, FAMILY_LIMIT);
  if (family.length <= 1) return '<span class="ccr-muted-value">沒有其他同系列 class</span>';
  const more = (state.families.get(item.familyKey) || []).length - family.length;
  return `<div class="ccr-family-list">
    ${family
      .map(
        (entry) => `<button class="${entry.name === item.name ? "is-active" : ""}" type="button" data-select-class="${escapeHtml(entry.name)}">
          <code>${escapeHtml(entry.name)}</code>
          <span data-copy-value="${escapeHtml(entry.name)}">${copyIcon()}</span>
        </button>`
      )
      .join("")}
    ${more > 0 ? `<p>另有 ${more} 筆，請用搜尋縮小範圍。</p>` : ""}
  </div>`;
}

function tagMarkup(tags, clickable = false) {
  return Array.from(new Set(tags.filter(Boolean)))
    .map((tag) => {
      if (!clickable) return `<span class="ccr-tag">${escapeHtml(tag)}</span>`;
      return `<button class="ccr-tag" type="button" data-tag-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
    })
    .join("");
}

function applyTagFilter(tag) {
  const categories = new Set(state.classes.map((item) => item.category));
  state.page = 1;
  state.viewMode = "classes";
  if (categories.has(tag)) {
    state.category = tag;
    state.usage = "All";
    state.query = "";
  } else if (usageOrder.includes(tag)) {
    state.usage = tag;
    state.category = "All";
    state.query = "";
  } else {
    state.category = "All";
    state.usage = "All";
    state.query = tag.toLowerCase();
  }
  els.search.value = state.query;
  render();
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

      if (fallback !== null) return variableLine(name, fallback || "empty fallback", "fallback");
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
  const swatch = colorSwatch(value);
  return `<code class="ccr-var-value"><span>${escapeHtml(name)}:</span> <span class="ccr-var-main">${swatch}${escapeHtml(value)}</span> <em>${escapeHtml(source)}</em></code>`;
}

function colorSwatch(value) {
  const color = colorValue(value);
  if (!color) return "";
  return `<i class="ccr-color-swatch" style="background-color: ${escapeHtml(color)}"></i>`;
}

function colorValue(value) {
  const trimmed = String(value).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/i.test(trimmed)) return trimmed;
  return "";
}

function calcSummaryMarkup(item) {
  const results = buildCalcResults(item).filter((result) => result.result);
  if (!results.length) return "";
  return `<span class="ccr-calc-summary">= ${escapeHtml(results[0].result)}</span>`;
}

function calcDetailMarkup(item) {
  const results = buildCalcResults(item);
  if (!results.length) return "";
  return `<div class="ccr-calc-list">
    ${results.map(calcLine).join("")}
  </div>`;
}

function calcLine(result) {
  if (result.result) {
    return `<code><span>${escapeHtml(result.property)}:</span> ${escapeHtml(result.variable)}=${escapeHtml(result.variableValue)} <em>${escapeHtml(result.substituted)} = ${escapeHtml(result.result)}</em></code>`;
  }
  return `<code><span>${escapeHtml(result.property)}:</span> ${escapeHtml(result.substituted)} <em>${escapeHtml(result.note)}</em></code>`;
}

function buildCalcResults(item) {
  const declarations = declarationMap(item.cssText);
  const results = [];
  declarations.forEach((value, property) => {
    const calc = parseSupportedCalc(value);
    if (!calc) return;
    const resolved = resolveCssVariable(calc.variable, item, calc.fallback);
    if (!resolved.value) {
      results.push({
        property,
        substituted: value,
        note: "variable unresolved",
      });
      return;
    }

    const substituted = `calc(${resolved.value} * ${formatNumber(calc.multiplier)})`;
    const numeric = multiplyCssValue(resolved.value, calc.multiplier);
    results.push({
      property,
      variable: calc.variable,
      variableValue: resolved.value,
      substituted,
      result: numeric,
      note: numeric ? resolved.source : "substituted only",
    });
  });
  return results;
}

function parseSupportedCalc(value) {
  const trimmed = value.trim();
  let match = trimmed.match(/^calc\(\s*var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)\s*\*\s*(-?\d*\.?\d+)\s*\)$/);
  if (match) return { variable: match[1], fallback: match[2]?.trim() || null, multiplier: Number(match[3]) };

  match = trimmed.match(/^calc\(\s*(-?\d*\.?\d+)\s*\*\s*var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)\s*\)$/);
  if (match) return { variable: match[2], fallback: match[3]?.trim() || null, multiplier: Number(match[1]) };
  return null;
}

function resolveCssVariable(name, item, fallback = null) {
  const localValue = declarationMap(item.cssText).get(name);
  if (localValue) return { value: localValue, source: "this class" };

  const rootValue = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (rootValue) return { value: rootValue, source: ":root" };

  const provider = (state.varProviders.get(name) || []).find((entry) => entry.name !== item.name);
  if (provider) return { value: provider.value, source: provider.name };

  if (fallback) return { value: fallback, source: "fallback" };
  return { value: "", source: "unresolved" };
}

function multiplyCssValue(value, multiplier) {
  const match = value.trim().match(/^(-?\d*\.?\d+)([A-Za-z%]+)$/);
  if (!match || Number.isNaN(multiplier)) return "";
  const next = Number(match[1]) * multiplier;
  return `${formatNumber(next)}${match[2]}`;
}

function formatNumber(value) {
  return Number.parseFloat(value.toFixed(6)).toString();
}

function previewMarkup(item, large = false) {
  const sizeClass = large ? " is-large" : "";
  const valueMarkup = spacingValueMarkup(item);
  return `<div class="ccr-preview-canvas${sizeClass} is-${item.previewType}">
    ${previewContent(item, large)}
  </div>${valueMarkup}`;
}

function previewContent(item, large = false) {
  const style = previewStyle(item);
  if (item.previewType === "no-preview" || item.previewType === "state-preview") {
    return `<div class="ccr-preview-note">${escapeHtml(item.previewType === "state-preview" ? "需要互動狀態" : "無靜態預覽")}</div>`;
  }
  if (item.previewType === "position-preview") {
    return `<div class="ccr-preview-frame">
      <div class="ccr-preview-origin ccr-position-origin" style="${escapeHtml(positionOriginStyle(style))}" aria-hidden="true">Item</div>
      <div class="ccr-preview-subject ccr-position-subject" style="${escapeHtml(style)}">Item</div>
    </div>`;
  }
  if (item.previewType === "spacing-preview") {
    return spacingPreviewMarkup(item, style, large);
  }
  if (item.previewType === "typography-preview") {
    return `<p class="ccr-preview-subject ccr-text-sample" style="${escapeHtml(style)}">Item text sample that can overflow</p>`;
  }
  if (item.previewType === "layout-preview") {
    return `<div class="ccr-preview-subject ccr-layout-sample" style="${escapeHtml(style)}"><span>A</span><span>B</span><span>C</span></div>`;
  }
  if (item.previewType === "effect-preview") {
    return `<div class="ccr-effect-frame"><div class="ccr-preview-subject" style="${escapeHtml(style)}">Item</div></div>`;
  }
  return `<div class="ccr-preview-subject" style="${escapeHtml(style)}">Item</div>`;
}

function spacingPreviewMarkup(item, style, large) {
  const model = spacingModel(item);
  if (model.kind === "gap") {
    return `<div class="ccr-spacing-frame"><div class="ccr-preview-subject ccr-layout-sample" style="${escapeHtml(style)}"><span>A</span><span>B</span><span>C</span></div></div>`;
  }
  return `<div class="ccr-spacing-frame">
    <div class="ccr-preview-origin ccr-spacing-origin is-${model.kind} ${model.negative ? "is-negative" : "is-positive"} side-${model.side}" style="--ccr-margin-size: ${model.strength}px">
      <div class="ccr-margin-fill" aria-hidden="true"></div>
      <div class="ccr-margin-ghost" style="${escapeHtml(marginZeroStyle(style))}" aria-hidden="true">Item</div>
      <div class="ccr-preview-subject ccr-margin-subject" style="${escapeHtml(spacingSubjectStyle(style))}">Item</div>
    </div>
  </div>`;
}

function spacingValueMarkup(item) {
  if (item.previewType !== "spacing-preview" && item.previewType !== "position-preview") return "";
  if (item.previewType === "spacing-preview") {
    const model = spacingModel(item);
    if (model.kind === "gap") return "";
    return `<span class="ccr-box-value">${escapeHtml(model.valueLabel)}</span>`;
  }

  const result = buildCalcResults(item).find((entry) => entry.result);
  if (!result) return "";
  return `<span class="ccr-box-value">${escapeHtml(result.result)}</span>`;
}

function spacingModel(item) {
  const declarations = declarationMap(item.cssText);
  const gapEntry = firstDeclaration(declarations, /^(gap|row-gap|column-gap)$/);
  if (gapEntry) return { kind: "gap", strength: 0, negative: false };

  const marginEntry = firstDeclaration(declarations, /^margin/);
  const paddingEntry = firstDeclaration(declarations, /^padding/);
  const entry = marginEntry || paddingEntry;
  const value = entry ? entry[1] : "";
  const calc = parseSupportedCalc(value);
  const resolved = calc ? resolveCssVariable(calc.variable, item, calc.fallback) : null;
  const result = calc && resolved?.value ? multiplyCssValue(resolved.value, calc.multiplier) : value;
  const property = entry ? entry[0] : "";
  const side = spacingSide(property);
  const negative = /^-/.test(String(result).trim());
  const strength = Math.max(2, Math.min(28, cssPixelMagnitude(result)));
  return {
    kind: marginEntry ? "margin" : "padding",
    side,
    negative,
    strength,
    valueLabel: result || value,
  };
}

function spacingSide(property) {
  if (/-(top|block-start)$/.test(property)) return "top";
  if (/-(right|inline-end)$/.test(property)) return "right";
  if (/-(bottom|block-end)$/.test(property)) return "bottom";
  if (/-(left|inline-start)$/.test(property)) return "left";
  if (/-inline$/.test(property)) return "inline";
  if (/-block$/.test(property)) return "block";
  return "all";
}

function firstDeclaration(declarations, pattern) {
  return Array.from(declarations).find(([property]) => pattern.test(property));
}

function cssPixelMagnitude(value) {
  const match = String(value).trim().match(/^-?(\d*\.?\d+)([A-Za-z%]*)/);
  if (!match) return 8;
  const amount = Math.abs(Number(match[1]));
  const unit = match[2] || "px";
  if (unit === "rem" || unit === "em") return amount * 16;
  if (unit === "px") return amount;
  return Math.min(24, amount * 12);
}

function marginZeroStyle(style) {
  return `${spacingSubjectStyle(style)}; margin: 0; margin-inline: 0; margin-block: 0; margin-top: 0; margin-right: 0; margin-bottom: 0; margin-left: 0`;
}

function spacingSubjectStyle(style) {
  return `${style}; width: 46px; height: 28px`;
}

function positionOriginStyle(style) {
  return `${style}; position: relative; inset: auto; top: auto; right: auto; bottom: auto; left: auto; translate: none; rotate: none; scale: none; transform: none`;
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
    "border: 1px solid rgba(8, 127, 140, 0.34)",
    "border-radius: 4px",
    "background-color: rgba(228, 246, 247, 0.9)",
    "color: #12313d",
    "font-size: 12px",
    "line-height: 1.2",
    "text-align: center",
  ];

  if (item.previewType === "typography-preview") base.push("width: 118px", "background-color: #ffffff");
  if (item.previewType === "layout-preview") base.push("width: 126px", "gap: 6px");
  if (item.previewType === "position-preview" && !declarations.has("position")) base.push("position: relative");

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
    if (property === "border" || /^border(-(width|style|inline|block|top|right|bottom|left))?$/.test(property)) keys.add("border");
    if (property === "border-radius" || (property.startsWith("border-") && property.endsWith("-radius"))) keys.add("border-radius");
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

function copyIcon() {
  return `<svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M8 8V5.8c0-1 .8-1.8 1.8-1.8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H16"></path>
    <path d="M4 9.8C4 8.8 4.8 8 5.8 8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V9.8Z"></path>
  </svg>`;
}

async function copyClass(value) {
  await navigator.clipboard.writeText(value);
  els.toast.textContent = `Copied ${value}`;
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
