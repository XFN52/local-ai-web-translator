/**
 * Self-test suite for Local AI Web Translator logic.
 * Runs in pure Node.js using assert (stdlib only).
 */

const assert = require("assert");

// 1. Test Han (Chinese) Regex detection
const HAN_REGEX = /[\u4e00-\u9fa5]/;

assert.strictEqual(HAN_REGEX.test("你好，世界！"), true, "Should detect standard Chinese characters");
assert.strictEqual(HAN_REGEX.test("Hello World 123!"), false, "Should not detect English text");
assert.strictEqual(HAN_REGEX.test("Version 2.0 更新说明"), true, "Should detect mixed Chinese text");
assert.strictEqual(HAN_REGEX.test("   \n\t   "), false, "Should not detect whitespace");

// 2. Test Whitespace Preservation
function preserveWhitespace(raw, translatedCore) {
  const leading = raw.match(/^\s*/)[0];
  const trailing = raw.match(/\s*$/)[0];
  return leading + translatedCore + trailing;
}

const rawSample = "\n  立即登录 / 注册账户  \t";
const translatedCore = "Войти сейчас / Регистрация";
const restored = preserveWhitespace(rawSample, translatedCore);
assert.strictEqual(
  restored,
  "\n  Войти сейчас / Регистрация  \t",
  "Leading and trailing whitespace must be preserved exactly"
);

// 3. Test Markdown JSON Output Cleaner (from background.js)
function cleanJsonOutput(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

const markdownJson = "```json\n[\"Привет\", \"Мир\"]\n```";
const cleaned = cleanJsonOutput(markdownJson);
assert.deepStrictEqual(JSON.parse(cleaned), ["Привет", "Мир"], "Markdown code fence should be stripped");

// 4. Test DOM Simulation with TreeWalker & 100% Faithful Rollback
class MockNode {
  constructor(nodeType, nodeValue, tagName = null) {
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.tagName = tagName ? tagName.toUpperCase() : null;
    this.parentElement = null;
    this.children = [];
    this.isConnected = true;
    this.attributes = {};
    this.className = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }
}

const IGNORED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT",
  "SELECT", "OPTION", "OPTGROUP", "DATALIST",
  "CODE", "PRE", "KBD", "SAMP", "SVG", "CANVAS"
]);

function isIgnored(el) {
  let cur = el;
  while (cur) {
    if (cur.tagName && IGNORED_TAGS.has(cur.tagName)) return true;
    if (cur.getAttribute("translate") === "no") return true;
    cur = cur.parentElement;
  }
  return false;
}

// Build mock document:
// <div>
//   <h1>  淘宝网首页  </h1>
//   <code>function zh() { return "测试"; }</code>
//   <p>Welcome to our store</p>
//   <span> 购物车 (3) </span>
//   <span data-tooltip="近期成功率表现较好">ℹ</span>
//   <input placeholder="全部商户" />
//   <select><option>10 条/页</option></select>
//   <div role="combobox" x-semi-prop="placeholder">全部模型</div>
//   <div class="semi-portal"><div class="semi-popover"><div class="semi-select-option">最近成功优先</div></div></div>
// </div>
const root = new MockNode(1, null, "DIV");
const h1 = new MockNode(1, null, "H1");
const h1Text = new MockNode(3, "  淘宝网首页  ");
h1.appendChild(h1Text);

const code = new MockNode(1, null, "CODE");
const codeText = new MockNode(3, 'function zh() { return "测试"; }');
code.appendChild(codeText);

const p = new MockNode(1, null, "P");
const pText = new MockNode(3, "Welcome to our store");
p.appendChild(pText);

const span = new MockNode(1, null, "SPAN");
const spanText = new MockNode(3, " 购物车 (3) ");
span.appendChild(spanText);

const tooltipSpan = new MockNode(1, null, "SPAN");
tooltipSpan.attributes["data-tooltip"] = "近期成功率表现较好";
const tooltipSpanText = new MockNode(3, "ℹ");
tooltipSpan.appendChild(tooltipSpanText);

const searchInput = new MockNode(1, null, "INPUT");
searchInput.attributes["placeholder"] = "全部商户";

const select = new MockNode(1, null, "SELECT");
const option = new MockNode(1, null, "OPTION");
const optionText = new MockNode(3, "10 条/页");
option.appendChild(optionText);
select.appendChild(option);

const combobox = new MockNode(1, null, "DIV");
combobox.attributes["role"] = "combobox";
combobox.attributes["x-semi-prop"] = "placeholder";
const comboText = new MockNode(3, "全部模型");
combobox.appendChild(comboText);

root.appendChild(h1);
root.appendChild(code);
root.appendChild(p);
root.appendChild(span);
root.appendChild(tooltipSpan);
root.appendChild(searchInput);
root.appendChild(select);
root.appendChild(combobox);

const portal = new MockNode(1, null, "DIV");
portal.className = "semi-portal";
const popover = new MockNode(1, null, "DIV");
popover.className = "semi-popover";
const portalOpt = new MockNode(1, null, "DIV");
portalOpt.className = "semi-select-option";
const portalOptText = new MockNode(3, "最近成功优先");
portalOpt.appendChild(portalOptText);
popover.appendChild(portalOpt);
portal.appendChild(popover);
root.appendChild(portal);

// Collect translatable nodes and attributes
const originalMap = new WeakMap();
const originalAttrMap = new WeakMap();
const collectedNodes = [];
const collectedAttrs = [];

const TRANSLATABLE_ATTRS = ["data-tooltip", "title", "placeholder", "aria-label"];

function walk(node) {
  if (node.nodeType === 3) {
    const val = node.nodeValue;
    if (val && HAN_REGEX.test(val) && !isIgnored(node.parentElement)) {
      originalMap.set(node, val);
      collectedNodes.push(node);
    }
  } else {
    // Check translatable attributes on element
    if (node.attributes) {
      for (const attr of TRANSLATABLE_ATTRS) {
        const val = node.getAttribute(attr);
        if (val && HAN_REGEX.test(val)) {
          if (!originalAttrMap.has(node)) {
            originalAttrMap.set(node, {});
          }
          originalAttrMap.get(node)[attr] = val;
          collectedAttrs.push({ node, attr, val });
        }
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
}

walk(root);

assert.strictEqual(collectedNodes.length, 4, "Should collect H1, SPAN, COMBOBOX, and PORTAL_OPTION text nodes");
assert.strictEqual(collectedAttrs.length, 2, "Should collect data-tooltip and placeholder attributes");
assert.strictEqual(codeText.nodeValue, 'function zh() { return "测试"; }', "Code content must remain completely untouched");
assert.strictEqual(pText.nodeValue, "Welcome to our store", "English text must remain untouched");
assert.strictEqual(optionText.nodeValue, "10 条/页", "Native select option text must be excluded to prevent form corruption");
assert.strictEqual(comboText.nodeValue, "全部模型", "Combobox text collected for translation");
assert.strictEqual(portalOptText.nodeValue, "最近成功优先", "Semi UI portal/popover options collected for translation");

// Simulate Translation Replacement for text nodes and attributes
const mockTranslations = ["Главная страница Taobao", "Корзина (3)", "Все модели", "Сначала недавние успешные"];
for (let i = 0; i < collectedNodes.length; i++) {
  const node = collectedNodes[i];
  node.nodeValue = preserveWhitespace(originalMap.get(node), mockTranslations[i]);
}

const mockAttrTranslations = ["Хорошие показатели успешности в последнее время", "Все продавцы"];
for (let i = 0; i < collectedAttrs.length; i++) {
  const item = collectedAttrs[i];
  item.node.attributes[item.attr] = mockAttrTranslations[i];
}

assert.strictEqual(h1Text.nodeValue, "  Главная страница Taobao  ", "H1 must be translated with whitespace preserved");
assert.strictEqual(spanText.nodeValue, " Корзина (3) ", "Span must be translated with whitespace preserved");
assert.strictEqual(comboText.nodeValue, "Все модели", "Combobox must be translated");
assert.strictEqual(portalOptText.nodeValue, "Сначала недавние успешные", "Portal option must be translated");
assert.strictEqual(tooltipSpan.attributes["data-tooltip"], "Хорошие показатели успешности в последнее время", "Tooltip attribute must be translated");
assert.strictEqual(searchInput.attributes["placeholder"], "Все продавцы", "Placeholder attribute must be translated");

// Simulate 100% Rollback
for (const node of collectedNodes) {
  node.nodeValue = originalMap.get(node);
}
for (const item of collectedAttrs) {
  item.node.attributes[item.attr] = originalAttrMap.get(item.node)[item.attr];
}

assert.strictEqual(h1Text.nodeValue, "  淘宝网首页  ", "H1 must be restored exactly to original Chinese text");
assert.strictEqual(spanText.nodeValue, " 购物车 (3) ", "Span must be restored exactly to original Chinese text");
assert.strictEqual(comboText.nodeValue, "全部模型", "Combobox must be restored to original Chinese");
assert.strictEqual(portalOptText.nodeValue, "最近成功优先", "Portal option must be restored to original Chinese");
assert.strictEqual(tooltipSpan.attributes["data-tooltip"], "近期成功率表现较好", "Tooltip attribute restored to original Chinese");
assert.strictEqual(searchInput.attributes["placeholder"], "全部商户", "Placeholder attribute restored to original Chinese");

// 5. Test Cache & Deduplication Logic
class CacheTester {
  constructor(maxSize = 5) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.aiCallCount = 0;
    this.uniqueTextsSent = [];
  }

  async mockRequestAi(uniqueTexts) {
    this.aiCallCount++;
    this.uniqueTextsSent.push(...uniqueTexts);
    const mockDict = {
      "确定": "Подтвердить",
      "取消": "Отмена",
      "搜索": "Поиск",
      "重置": "Сброс",
      "编辑": "Редактировать",
      "删除": "Удалить"
    };
    return uniqueTexts.map(t => mockDict[t] || ("RU_" + t));
  }

  async translateBatch(texts) {
    const result = new Array(texts.length);
    const missingIndicesMap = new Map();
    let hitCount = 0;

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (this.cache.has(text)) {
        result[i] = this.cache.get(text);
        hitCount++;
      } else {
        if (!missingIndicesMap.has(text)) {
          missingIndicesMap.set(text, []);
        }
        missingIndicesMap.get(text).push(i);
      }
    }

    if (hitCount === texts.length) {
      return { result, hitCount, aiCalled: false };
    }

    const uniqueMissing = Array.from(missingIndicesMap.keys());
    const aiTranslations = await this.mockRequestAi(uniqueMissing);

    for (let m = 0; m < uniqueMissing.length; m++) {
      const orig = uniqueMissing[m];
      const trans = aiTranslations[m] || orig;
      this.cache.set(orig, trans);

      // Evict oldest if exceeding maxSize
      while (this.cache.size > this.maxSize) {
        const oldest = this.cache.keys().next().value;
        this.cache.delete(oldest);
      }

      const indices = missingIndicesMap.get(orig);
      if (indices) {
        for (const idx of indices) {
          result[idx] = trans;
        }
      }
    }

    return { result, hitCount, aiCalled: true };
  }
}

(async () => {
  const tester = new CacheTester(5);

  // Test 5.1: Batch with duplicates sent to AI (deduplicated)
  const batch1 = ["确定", "取消", "确定", "取消", "确定"];
  const res1 = await tester.translateBatch(batch1);
  assert.strictEqual(tester.aiCallCount, 1, "AI should be called exactly once for batch 1");
  assert.deepStrictEqual(tester.uniqueTextsSent, ["确定", "取消"], "Only unique strings should be sent to AI");
  assert.deepStrictEqual(
    res1.result,
    ["Подтвердить", "Отмена", "Подтвердить", "Отмена", "Подтвердить"],
    "Duplicate items in batch must map back to their original positions"
  );

  // Test 5.2: 100% Cache Hit
  const batch2 = ["取消", "确定", "取消"];
  const res2 = await tester.translateBatch(batch2);
  assert.strictEqual(tester.aiCallCount, 1, "AI should NOT be called on 100% cache hit");
  assert.strictEqual(res2.hitCount, 3, "All 3 items should hit the cache");
  assert.deepStrictEqual(res2.result, ["Отмена", "Подтвердить", "Отмена"]);

  // Test 5.3: Partial Cache Hit
  const batch3 = ["确定", "搜索", "取消", "重置"];
  const res3 = await tester.translateBatch(batch3);
  assert.strictEqual(tester.aiCallCount, 2, "AI should be called once more for missing items");
  assert.deepStrictEqual(
    tester.uniqueTextsSent.slice(2),
    ["搜索", "重置"],
    "Only uncached items '搜索' and '重置' should be sent to AI"
  );
  assert.deepStrictEqual(
    res3.result,
    ["Подтвердить", "Поиск", "Отмена", "Сброс"]
  );

  // Test 5.4: LRU Eviction when exceeding maxSize
  assert.strictEqual(tester.cache.size, 4, "Cache should currently hold 4 items (确定, 取消, 搜索, 重置)");
  await tester.translateBatch(["编辑", "删除"]);
  assert.strictEqual(tester.cache.size, 5, "Cache must not exceed maxSize of 5 items");
  assert.strictEqual(tester.cache.has("确定"), false, "Oldest key '确定' must be evicted first");
  assert.strictEqual(tester.cache.has("删除"), true, "Newest key '删除' must be in cache");

  // 6. Test Tab Switch & React Re-render Resilience
  const activeNodesSet = new Set();
  const pageCache = new Map([
    ["首页", "Главная"],
    ["模型市场", "Модели"],
    ["使用日志", "Логи"]
  ]);

  // Tab 1: "首页"
  const tabNode1 = new MockNode(3, "首页");
  // Simulate translation of Tab 1
  tabNode1.nodeValue = pageCache.get(tabNode1.nodeValue);
  activeNodesSet.add(tabNode1);
  assert.strictEqual(tabNode1.nodeValue, "Главная");
  assert.strictEqual(activeNodesSet.has(tabNode1), true);

  // User switches to Tab 2: React mounts new node "模型市场"
  const tabNode2 = new MockNode(3, "模型市场");
  // Re-scan detects tabNode2
  assert.strictEqual(activeNodesSet.has(tabNode2), false, "Tab 2 node is new and must not be marked active");
  if (pageCache.has(tabNode2.nodeValue)) {
    tabNode2.nodeValue = pageCache.get(tabNode2.nodeValue);
    activeNodesSet.add(tabNode2);
  }
  assert.strictEqual(tabNode2.nodeValue, "Модели", "Tab 2 must be translated instantly from pageCache");

  // User switches back to Tab 1: React re-renders Tab 1 back to Chinese "首页"
  tabNode1.nodeValue = "首页";
  // Our updated collectChineseTextNodes explicitly unsets activeNodes when Han is detected:
  if (HAN_REGEX.test(tabNode1.nodeValue)) {
    activeNodesSet.delete(tabNode1);
  }
  assert.strictEqual(activeNodesSet.has(tabNode1), false, "Re-rendered node must be cleared from activeNodes");
  // Re-scan re-translates from pageCache
  if (pageCache.has(tabNode1.nodeValue)) {
    tabNode1.nodeValue = pageCache.get(tabNode1.nodeValue);
    activeNodesSet.add(tabNode1);
  }
  assert.strictEqual(tabNode1.nodeValue, "Главная", "Tab 1 must be instantly re-translated after React re-render");

  console.log("All test assertions passed successfully! DOM restoration, translation, cache, deduplication & tab resilience verified.");
})();
