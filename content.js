/**
 * Content Script for Local AI Web Translator (Chinese -> Russian)
 * Guarantees zero DOM/layout breakage by operating strictly on TextNode.nodeValue.
 */

(() => {
  // Regex to detect Han (Chinese) characters
  const HAN_REGEX = /[\u4e00-\u9fa5]/;

  // Tags whose text content must NEVER be modified or translated
  const IGNORED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "OPTGROUP",
    "DATALIST",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "SVG",
    "CANVAS",
    "AUDIO",
    "VIDEO",
    "IFRAME"
  ]);

  // WeakMap for 100% faithful restoration of original texts and attributes
  const originalTextMap = new WeakMap();
  const originalAttrMap = new WeakMap();
  // Set of actively tracked translated nodes and attribute elements
  const activeNodes = new Set();
  const activeAttrElements = new Set();
  // In-memory cache for instant page-level translation of repeated elements
  const pageCache = new Map();

  // Attributes that frequently contain user-facing Chinese text (tooltips, titles, placeholders, accessibility labels)
  const TRANSLATABLE_ATTRS = ["data-tooltip", "data-title", "data-tip", "title", "placeholder", "aria-label"];

  let isTranslating = false;
  let isTranslated = false;

  function sendLog(level, tag, message, meta = {}) {
    try {
      chrome.runtime.sendMessage({
        type: "LOG_EVENT",
        level,
        tag,
        message,
        meta: {
          url: window.location.href,
          pageTitle: document.title,
          ...meta
        }
      });
    } catch (e) {
      // Silently ignore if context invalidated during reload
    }
  }

  /**
   * Checks if an element or any of its ancestors should be skipped for text translation.
   * @param {Element|null} el
   * @returns {boolean}
   */
  function isIgnoredElement(el) {
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (IGNORED_TAGS.has(current.tagName)) return true;
      if (current.getAttribute("translate") === "no") return true;
      if (current.classList && current.classList.contains("notranslate")) return true;
      if (current.isContentEditable) return true;
      current = current.parentElement;
    }
    return false;
  }

  /**
   * Checks if an element should be skipped for translatable attributes.
   * @param {Element|null} el
   * @returns {boolean}
   */
  function isIgnoredAttributeElement(el) {
    if (!el) return true;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NOSCRIPT") return true;
    if (el.getAttribute("translate") === "no") return true;
    if (el.classList && el.classList.contains("notranslate")) return true;
    return false;
  }

  const LAYOUT_FIX_STYLE_ID = "local-ai-translator-layout-fix";

  /**
   * Injects non-destructive CSS rules to prevent UI collisions and rightward overflows
   * caused by Russian text being longer than Chinese source characters.
   */
  function injectLayoutProtectionStyles() {
    if (document.getElementById(LAYOUT_FIX_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = LAYOUT_FIX_STYLE_ID;
    style.textContent = `
      /* Fix 1: Top navigation flex layout - prevents overlapping buttons */
      .topbar nav, nav.nav, [aria-label="主导航"] {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        gap: 8px !important;
        overflow-x: auto !important;
        scrollbar-width: none !important;
      }
      .topbar nav button, nav.nav button, [aria-label="主导航"] button {
        position: relative !important;
        width: auto !important;
        min-width: max-content !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
        margin: 0 !important;
      }

      /* Fix 2: Table summary rows and action buttons - prevents horizontal overflow */
      .expand-summary, [data-market-row] summary {
        overflow-x: auto !important;
        scrollbar-width: thin !important;
      }
      .marketplace-actions {
        flex-shrink: 0 !important;
        display: flex !important;
        gap: 6px !important;
        align-items: center !important;
        white-space: nowrap !important;
      }
      .marketplace-actions .marketplace-btn {
        white-space: nowrap !important;
        min-width: max-content !important;
        padding: 4px 8px !important;
        font-size: 12px !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeLayoutProtectionStyles() {
    const el = document.getElementById(LAYOUT_FIX_STYLE_ID);
    if (el) el.remove();
  }

  /**
   * Checks if an element is currently within the visible viewport (with 150px scroll buffer).
   * Used to translate strictly visible text and avoid wasting LLM quota.
   * @param {Element|null} el
   * @param {number} buffer
   * @returns {boolean}
   */
  function isElementInViewport(el, buffer = 150) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      return (
        rect.bottom >= -buffer &&
        rect.top <= vh + buffer &&
        rect.right >= -buffer &&
        rect.left <= vw + buffer
      );
    } catch (e) {
      return true;
    }
  }

  /**
   * Collects translatable text nodes containing Chinese characters.
   * @param {Node} root
   * @returns {Array<{node: Text, leading: string, core: string, trailing: string}>}
   */
  function collectChineseTextNodes(root = document.body) {
    if (!root) return [];

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !HAN_REGEX.test(node.nodeValue)) {
            return NodeFilter.FILTER_SKIP;
          }
          if (isIgnoredElement(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const items = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      const raw = currentNode.nodeValue;
      const leading = raw.match(/^\s*/)[0];
      const trailing = raw.match(/\s*$/)[0];
      const core = raw.trim();

      if (core && HAN_REGEX.test(core)) {
        activeNodes.delete(currentNode);
        if (!originalTextMap.has(currentNode)) {
          originalTextMap.set(currentNode, raw);
        }
        items.push({
          type: "text",
          node: currentNode,
          leading,
          core,
          trailing
        });
      }
      currentNode = walker.nextNode();
    }

    sendLog("INFO", "DOM_SCAN", `Found ${items.length} Chinese text nodes on page`, {
      nodesCount: items.length,
      samplePreview: items.slice(0, 3).map(i => i.core)
    });
    return items;
  }

  /**
   * Collects translatable attributes containing Chinese characters (tooltips, titles, placeholders, aria-labels).
   * @param {Node} root
   * @returns {Array<{type: string, el: Element, attrName: string, leading: string, core: string, trailing: string}>}
   */
  function collectChineseAttributes(root = document.body) {
    if (!root) return [];
    const items = [];
    const selector = TRANSLATABLE_ATTRS.map(a => `[${a}]`).join(", ");
    const candidates = [];

    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.matches && root.matches(selector)) {
        candidates.push(root);
      }
      if (root.querySelectorAll) {
        const found = root.querySelectorAll(selector);
        for (let i = 0; i < found.length; i++) {
          candidates.push(found[i]);
        }
      }
    }

    for (const el of candidates) {
      if (isIgnoredAttributeElement(el)) continue;
      for (const attr of TRANSLATABLE_ATTRS) {
        const raw = el.getAttribute(attr);
        if (raw && HAN_REGEX.test(raw)) {
          const leading = raw.match(/^\s*/)[0];
          const trailing = raw.match(/\s*$/)[0];
          const core = raw.trim();
          if (core && HAN_REGEX.test(core)) {
            activeAttrElements.delete(el);
            if (!originalAttrMap.has(el)) {
              originalAttrMap.set(el, {});
            }
            const origs = originalAttrMap.get(el);
            if (!(attr in origs)) {
              origs[attr] = raw;
            }
            items.push({
              type: "attr",
              el,
              attrName: attr,
              leading,
              core,
              trailing
            });
          }
        }
      }
    }

    if (items.length > 0) {
      sendLog("INFO", "ATTR_SCAN", `Found ${items.length} Chinese attributes (tooltips/placeholders) on page`, {
        attrsCount: items.length,
        samplePreview: items.slice(0, 3).map(i => `${i.attrName}: ${i.core}`)
      });
    }
    return items;
  }

  /**
   * Safely closes any open Semi UI selects or popover portals when clicking outside or switching dropdowns.
   * Resolves the issue where multiple select popovers remain open simultaneously.
   */
  function closeAllOpenPortals(exceptTarget = null) {
    const openSelects = document.querySelectorAll(".semi-select-open");
    for (const sel of openSelects) {
      if (exceptTarget && (sel === exceptTarget || sel.contains(exceptTarget))) continue;
      const fiberKey = Object.keys(sel).find(k => k.startsWith("__reactFiber"));
      if (!fiberKey) continue;
      let cur = sel[fiberKey];
      while (cur) {
        if (cur.stateNode && cur.stateNode.foundation) {
          if (typeof cur.stateNode.foundation.close === "function") {
            try { cur.stateNode.foundation.close(); } catch (e) {}
          }
          if (typeof cur.stateNode.foundation.closeDropdown === "function") {
            try { cur.stateNode.foundation.closeDropdown(); } catch (e) {}
          }
        }
        cur = cur.return;
      }
    }

    const portals = document.querySelectorAll(".semi-portal");
    for (const p of portals) {
      if (exceptTarget && (p === exceptTarget || p.contains(exceptTarget))) continue;
      const inner = p.querySelector(".semi-portal-inner") || p;
      const fiberKey = Object.keys(inner).find(k => k.startsWith("__reactFiber"));
      if (!fiberKey) continue;
      let cur = inner[fiberKey];
      while (cur) {
        if (cur.stateNode && cur.stateNode.foundation) {
          if (typeof cur.stateNode.foundation.hide === "function") {
            try { cur.stateNode.foundation.hide(); } catch (e) {}
          }
          if (typeof cur.stateNode.foundation.close === "function") {
            try { cur.stateNode.foundation.close(); } catch (e) {}
          }
        }
        cur = cur.return;
      }
    }
  }

  function handleOutsidePortalInteractions(e) {
    if (e.target && e.target.closest && e.target.closest(".semi-portal, .semi-select-option")) {
      return;
    }
    closeAllOpenPortals(e.target);
  }

  let portalCloserBound = false;
  function initGlobalPortalCloser() {
    if (portalCloserBound) return;
    portalCloserBound = true;
    document.addEventListener("pointerdown", handleOutsidePortalInteractions, true);
  }

  let mutationObserver = null;
  let viewportObserver = null;
  const unobservedNodesMap = new Map();
  const pendingScrollQueue = [];
  let viewportScrollDebounce = null;

  /**
   * Observes elements that are outside the viewport and translates them only when scrolled into view.
   */
  function observeOffscreenNodes(offscreenItems, settings) {
    if (!offscreenItems || offscreenItems.length === 0) return;

    if (!viewportObserver) {
      viewportObserver = new IntersectionObserver(
        (entries) => {
          if (!isTranslated) return;

          for (const entry of entries) {
            if (entry.isIntersecting) {
              const el = entry.target;
              const itemsForEl = unobservedNodesMap.get(el);
              if (itemsForEl && itemsForEl.length > 0) {
                for (const item of itemsForEl) {
                  const isAlive = item.type === "attr"
                    ? (item.el.isConnected && !activeAttrElements.has(item.el))
                    : (item.node.isConnected && !activeNodes.has(item.node));
                  if (isAlive) {
                    pendingScrollQueue.push(item);
                  }
                }
                unobservedNodesMap.delete(el);
              }
              viewportObserver.unobserve(el);
            }
          }

          if (pendingScrollQueue.length > 0) {
            clearTimeout(viewportScrollDebounce);
            viewportScrollDebounce = setTimeout(async () => {
              if (pendingScrollQueue.length === 0 || !isTranslated) return;
              const batch = pendingScrollQueue.splice(0, pendingScrollQueue.length);
              sendLog("INFO", "VIEWPORT_SCROLL", `Translating ${batch.length} items scrolled into viewport (quota-efficient)`, {
                scrolledCount: batch.length,
                sample: batch[0]?.core
              });
              await translateItemsList(batch, settings);
            }, 80);
          }
        },
        {
          root: null,
          rootMargin: "150px 0px 150px 0px",
          threshold: 0.01
        }
      );
    }

    for (const item of offscreenItems) {
      const el = item.type === "attr" ? item.el : item.node.parentElement;
      if (!el) continue;
      if (!unobservedNodesMap.has(el)) {
        unobservedNodesMap.set(el, []);
        viewportObserver.observe(el);
      }
      unobservedNodesMap.get(el).push(item);
    }
  }

  function stopObservingViewport() {
    if (viewportObserver) {
      viewportObserver.disconnect();
      viewportObserver = null;
    }
    unobservedNodesMap.clear();
    pendingScrollQueue.length = 0;
    if (viewportScrollDebounce) {
      clearTimeout(viewportScrollDebounce);
      viewportScrollDebounce = null;
    }
  }

  /**
   * Starts MutationObserver to automatically translate newly added DOM nodes,
   * in-place text updates (characterData), and elements toggled visible (attributes).
   */
  function startObservingDynamicContent(settings) {
    if (mutationObserver) return;

    let pendingNodes = [];
    let debounceTimer = null;

    mutationObserver = new MutationObserver((mutations) => {
      if (!isTranslated) return;

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const addedNode of mutation.addedNodes) {
            if (addedNode.id === "local-ai-translator-root") continue;
            if (addedNode.nodeType === Node.ELEMENT_NODE) {
              const nodes = collectChineseTextNodes(addedNode);
              for (const n of nodes) {
                if (!pendingNodes.some(p => p.node === n.node)) {
                  pendingNodes.push(n);
                }
              }
              const attrs = collectChineseAttributes(addedNode);
              for (const a of attrs) {
                if (!pendingNodes.some(p => p.el === a.el && p.attrName === a.attrName)) {
                  pendingNodes.push(a);
                }
              }
            } else if (addedNode.nodeType === Node.TEXT_NODE) {
              if (HAN_REGEX.test(addedNode.nodeValue) && !isIgnoredElement(addedNode.parentElement)) {
                const raw = addedNode.nodeValue;
                const leading = raw.match(/^\s*/)[0];
                const trailing = raw.match(/\s*$/)[0];
                const core = raw.trim();
                if (core && HAN_REGEX.test(core) && !originalTextMap.has(addedNode)) {
                  originalTextMap.set(addedNode, raw);
                  if (!pendingNodes.some(p => p.node === addedNode)) {
                    pendingNodes.push({ type: "text", node: addedNode, leading, core, trailing });
                  }
                }
              }
            }
          }
        } else if (mutation.type === "characterData") {
          const target = mutation.target;
          if (
            target &&
            target.nodeType === Node.TEXT_NODE &&
            HAN_REGEX.test(target.nodeValue) &&
            !isIgnoredElement(target.parentElement)
          ) {
            const raw = target.nodeValue;
            const leading = raw.match(/^\s*/)[0];
            const trailing = raw.match(/\s*$/)[0];
            const core = raw.trim();
            if (core && HAN_REGEX.test(core)) {
              activeNodes.delete(target);
              originalTextMap.set(target, raw);
              if (!pendingNodes.some(p => p.node === target)) {
                pendingNodes.push({ type: "text", node: target, leading, core, trailing });
              }
            }
          }
        } else if (mutation.type === "attributes") {
          const el = mutation.target;
          if (
            el &&
            el.nodeType === Node.ELEMENT_NODE &&
            el.id !== "local-ai-translator-root"
          ) {
            const attrName = mutation.attributeName;
            if (TRANSLATABLE_ATTRS.includes(attrName)) {
              const raw = el.getAttribute(attrName);
              if (raw && HAN_REGEX.test(raw)) {
                const leading = raw.match(/^\s*/)[0];
                const trailing = raw.match(/\s*$/)[0];
                const core = raw.trim();
                if (core && HAN_REGEX.test(core)) {
                  activeAttrElements.delete(el);
                  if (!originalAttrMap.has(el)) {
                    originalAttrMap.set(el, {});
                  }
                  const origs = originalAttrMap.get(el);
                  if (!(attrName in origs)) {
                    origs[attrName] = raw;
                  }
                  if (!pendingNodes.some(p => p.el === el && p.attrName === attrName)) {
                    pendingNodes.push({ type: "attr", el, attrName, leading, core, trailing });
                  }
                }
              }
            } else if (!isIgnoredElement(el) && isElementInViewport(el)) {
              const nodes = collectChineseTextNodes(el);
              for (const n of nodes) {
                if (!activeNodes.has(n.node) && !pendingNodes.some(p => p.node === n.node)) {
                  pendingNodes.push(n);
                }
              }
              const attrs = collectChineseAttributes(el);
              for (const a of attrs) {
                if (!activeAttrElements.has(a.el) && !pendingNodes.some(p => p.el === a.el && p.attrName === a.attrName)) {
                  pendingNodes.push(a);
                }
              }
            }
          }
        }
      }

      if (pendingNodes.length > 0) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (pendingNodes.length === 0 || !isTranslated) return;
          const toProcess = [...pendingNodes];
          pendingNodes = [];

          const visible = [];
          const offscreen = [];
          for (const item of toProcess) {
            const targetEl = item.type === "attr" ? item.el : item.node?.parentElement;
            if (!targetEl || !targetEl.isConnected) continue;
            if (isElementInViewport(targetEl)) {
              visible.push(item);
            } else {
              offscreen.push(item);
            }
          }

          if (visible.length > 0) {
            sendLog("DEBUG", "DOM_OBSERVER", `Dynamic visible content detected: translating ${visible.length} items`);
            await translateItemsList(visible, settings);
          }
          if (offscreen.length > 0) {
            observeOffscreenNodes(offscreen, settings);
          }
        }, 80);
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "open", "hidden", "aria-hidden", ...TRANSLATABLE_ATTRS]
    });
  }

  /**
   * Disconnects the dynamic content MutationObserver.
   */
  function stopObservingDynamicContent() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  let cachedSettings = null;
  async function getSettings() {
    if (cachedSettings) return cachedSettings;
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          apiUrl: "http://localhost:8045/v1/chat/completions",
          model: "gemini-3.8-flash-low",
          apiKey: "",
          batchSize: 20
        },
        (res) => {
          cachedSettings = res;
          resolve(res);
        }
      );
    });
  }

  let isScanning = false;
  async function reScanAndTranslateVisible() {
    if (!isTranslated || isScanning) return;
    isScanning = true;
    try {
      const textItems = collectChineseTextNodes(document.body);
      const attrItems = collectChineseAttributes(document.body);
      const items = [...textItems, ...attrItems];
      const visible = [];
      const offscreen = [];
      for (const item of items) {
        const targetEl = item.type === "attr" ? item.el : item.node?.parentElement;
        if (!targetEl || !targetEl.isConnected) continue;
        if (isElementInViewport(targetEl)) {
          visible.push(item);
        } else {
          offscreen.push(item);
        }
      }

      const settings = await getSettings();

      if (visible.length > 0) {
        sendLog("DEBUG", "TAB_RESCAN", `Tab switch / revalidation: translating ${visible.length} visible items`);
        await translateItemsList(visible, settings);
      }

      if (offscreen.length > 0) {
        observeOffscreenNodes(offscreen, settings);
      }
    } catch (e) {
      console.error("[LocalAI Translator] Re-scan error:", e);
    } finally {
      isScanning = false;
    }
  }

  function scheduleReScan(delay = 60) {
    if (!isTranslated) return;
    setTimeout(() => {
      if (!isTranslated) return;
      reScanAndTranslateVisible();
    }, delay);
  }

  let isHistoryPatched = false;
  function patchHistory() {
    if (isHistoryPatched) return;
    isHistoryPatched = true;
    try {
      const origPush = history.pushState;
      history.pushState = function (...args) {
        const ret = origPush.apply(this, args);
        window.dispatchEvent(new Event("locationchange"));
        return ret;
      };
      const origReplace = history.replaceState;
      history.replaceState = function (...args) {
        const ret = origReplace.apply(this, args);
        window.dispatchEvent(new Event("locationchange"));
        return ret;
      };
    } catch (e) {}
  }

  let navEventsBound = false;
  function handleTabOrRouteChange() {
    if (!isTranslated) return;
    scheduleReScan(50);
    scheduleReScan(200);
    scheduleReScan(500);
  }

  function tabClickHandler(e) {
    if (!isTranslated) return;
    const tabEl = e.target.closest(
      '[role="tab"], [role="tabpanel"], nav button, [data-page], .console-side-item, .semi-tabs-tab, .ant-tabs-tab, .topbar nav button, aside button, button, a'
    );
    if (tabEl) {
      scheduleReScan(60);
      scheduleReScan(200);
      scheduleReScan(600);
    }
  }

  function visibilityChangeHandler() {
    if (document.visibilityState === "visible" && isTranslated) {
      sendLog("DEBUG", "TAB_VISIBLE", "Tab returned to foreground: re-scanning viewport");
      scheduleReScan(50);
      scheduleReScan(200);
    }
  }

  function windowFocusHandler() {
    if (isTranslated) {
      scheduleReScan(50);
      scheduleReScan(200);
    }
  }

  /**
   * Automatically detects SPA route changes, tab clicks, and tab visibility switches.
   */
  function startObservingSpaNavigation(settings) {
    if (settings) cachedSettings = settings;
    patchHistory();
    initGlobalPortalCloser();

    if (!navEventsBound) {
      navEventsBound = true;
      window.addEventListener("popstate", handleTabOrRouteChange);
      window.addEventListener("hashchange", handleTabOrRouteChange);
      window.addEventListener("locationchange", handleTabOrRouteChange);
      document.addEventListener("click", tabClickHandler, true);
      document.addEventListener("visibilitychange", visibilityChangeHandler);
      window.addEventListener("focus", windowFocusHandler);
    }
  }

  function stopObservingSpaNavigation() {
    if (navEventsBound) {
      navEventsBound = false;
      window.removeEventListener("popstate", handleTabOrRouteChange);
      window.removeEventListener("hashchange", handleTabOrRouteChange);
      window.removeEventListener("locationchange", handleTabOrRouteChange);
      document.removeEventListener("click", tabClickHandler, true);
      document.removeEventListener("visibilitychange", visibilityChangeHandler);
      window.removeEventListener("focus", windowFocusHandler);
    }
  }

  /**
   * Translates an array of collected items (text nodes or attributes) in batches.
   */
  async function translateItemsList(items, settings, onProgress) {
    if (!items || items.length === 0) return;

    let translatedSoFar = 0;
    const uncachedItems = [];

    // Instant local cache check: translate known strings synchronously without IPC
    for (const item of items) {
      if (item.type === "attr") {
        if (!item.el || !item.el.isConnected) continue;
        if (pageCache.has(item.core)) {
          const cachedCore = pageCache.get(item.core);
          item.el.setAttribute(item.attrName, item.leading + cachedCore + item.trailing);
          activeAttrElements.add(item.el);
          translatedSoFar++;
        } else {
          uncachedItems.push(item);
        }
      } else {
        if (!item.node || !item.node.isConnected) continue;
        if (pageCache.has(item.core)) {
          const cachedCore = pageCache.get(item.core);
          item.node.nodeValue = item.leading + cachedCore + item.trailing;
          activeNodes.add(item.node);
          translatedSoFar++;
        } else {
          uncachedItems.push(item);
        }
      }
    }

    if (translatedSoFar > 0) {
      sendLog("DEBUG", "PAGE_CACHE_HIT", `Instant translated ${translatedSoFar} items from page cache`);
      if (typeof onProgress === "function") {
        onProgress(translatedSoFar, items.length);
      }
    }

    if (uncachedItems.length === 0) {
      return;
    }

    const batchSize = Math.max(5, Math.min(50, Number(settings.batchSize) || 20));

    for (let i = 0; i < uncachedItems.length; i += batchSize) {
      const batch = uncachedItems.slice(i, i + batchSize);
      const textCores = batch.map((b) => b.core);

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "TRANSLATE_BATCH",
            texts: textCores,
            apiUrl: settings.apiUrl,
            model: settings.model,
            apiKey: settings.apiKey
          },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(res);
          }
        );
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Unknown background translation error");
      }

      const translations = response.translations;
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const translatedCore = translations[j] || item.core;
        pageCache.set(item.core, translatedCore);
        if (item.type === "attr") {
          if (!item.el || !item.el.isConnected) continue;
          item.el.setAttribute(item.attrName, item.leading + translatedCore + item.trailing);
          activeAttrElements.add(item.el);
        } else {
          if (!item.node || !item.node.isConnected) continue;
          item.node.nodeValue = item.leading + translatedCore + item.trailing;
          activeNodes.add(item.node);
        }
      }

      translatedSoFar += batch.length;
      sendLog("DEBUG", "DOM_MUTATE", `In-place updated batch of ${batch.length} items (total active nodes: ${activeNodes.size}, attrs: ${activeAttrElements.size})`);
      if (typeof onProgress === "function") {
        onProgress(translatedSoFar, items.length);
      }
    }
  }

  /**
   * Restores all modified nodes and attributes to their original pre-translation values.
   */
  function restoreOriginal() {
    removeLayoutProtectionStyles();
    stopObservingDynamicContent();
    stopObservingSpaNavigation();
    stopObservingViewport();
    let restoredCount = 0;
    for (const node of activeNodes) {
      if (node && node.isConnected && originalTextMap.has(node)) {
        node.nodeValue = originalTextMap.get(node);
        restoredCount++;
      }
    }
    activeNodes.clear();

    for (const el of activeAttrElements) {
      if (el && el.isConnected && originalAttrMap.has(el)) {
        const origs = originalAttrMap.get(el);
        for (const [attrName, origVal] of Object.entries(origs)) {
          if (origVal === null) {
            el.removeAttribute(attrName);
          } else {
            el.setAttribute(attrName, origVal);
          }
          restoredCount++;
        }
      }
    }
    activeAttrElements.clear();

    isTranslated = false;
    try {
      sessionStorage.setItem("local_ai_translator_active", "false");
    } catch (e) {}
    updateWidgetUI("idle");
    sendLog("INFO", "DOM_RESTORE", `Restored ${restoredCount} items (text nodes & attributes) to original Chinese`, { restoredCount });
    return restoredCount;
  }

  /**
   * Translates only the currently visible viewport elements, observing off-screen elements on scroll.
   */
  async function translatePage() {
    if (isTranslating) return;

    if (isTranslated) {
      restoreOriginal();
      return;
    }

    const textItems = collectChineseTextNodes(document.body);
    const attrItems = collectChineseAttributes(document.body);
    const items = [...textItems, ...attrItems];

    if (items.length === 0) {
      updateWidgetUI("no_chinese");
      return;
    }

    isTranslating = true;

    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          apiUrl: "http://localhost:8045/v1/chat/completions",
          model: "gemini-3.8-flash-low",
          apiKey: "",
          batchSize: 20
        },
        resolve
      );
    });

    // Separate elements into in-viewport vs off-screen to preserve LLM quota
    const visibleItems = [];
    const offscreenItems = [];
    for (const item of items) {
      const targetEl = item.type === "attr" ? item.el : item.node?.parentElement;
      if (!targetEl) continue;
      if (isElementInViewport(targetEl)) {
        visibleItems.push(item);
      } else {
        offscreenItems.push(item);
      }
    }

    // Fallback: if viewport calculation detected 0 items (e.g. initial scroll at blank space), translate first chunk
    if (visibleItems.length === 0 && items.length > 0) {
      visibleItems.push(...items.slice(0, 15));
      offscreenItems.splice(0, visibleItems.length);
    }

    sendLog("INFO", "VIEWPORT_SCAN", `Viewport-only scan: ${visibleItems.length} visible (translating now), ${offscreenItems.length} off-screen (deferred to save quota)`, {
      visibleCount: visibleItems.length,
      deferredOffscreenCount: offscreenItems.length,
      totalChineseFound: items.length
    });

    updateWidgetUI("translating", { current: 0, total: visibleItems.length });

    try {
      injectLayoutProtectionStyles();
      if (visibleItems.length > 0) {
        await translateItemsList(visibleItems, settings, (current, total) => {
          updateWidgetUI("translating", { current, total });
        });
      }

      isTranslated = true;
      try {
        sessionStorage.setItem("local_ai_translator_active", "true");
      } catch (e) {}
      // Start observing scroll for off-screen items, dynamic DOM insertions & SPA route changes
      observeOffscreenNodes(offscreenItems, settings);
      startObservingDynamicContent(settings);
      startObservingSpaNavigation(settings);
      updateWidgetUI("done");
    } catch (err) {
      console.error("[LocalAI Translator] Page translation error:", err);
      updateWidgetUI("error", { error: err.message });
    } finally {
      isTranslating = false;
    }
  }

  // --- Non-intrusive Floating UI (Shadow DOM) ---
  let shadowRoot = null;
  let widgetContainer = null;

  function initFloatingWidget() {
    if (document.getElementById("local-ai-translator-root")) return;

    widgetContainer = document.createElement("div");
    widgetContainer.id = "local-ai-translator-root";
    widgetContainer.style.all = "initial";
    widgetContainer.style.position = "fixed";
    widgetContainer.style.bottom = "16px";
    widgetContainer.style.right = "16px";
    widgetContainer.style.zIndex = "2147483647";

    shadowRoot = widgetContainer.attachShadow({ mode: "closed" });
    shadowRoot.innerHTML = `
      <style>
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #1e1e24;
          color: #f4f4f5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          font-weight: 500;
          padding: 7px 12px;
          border-radius: 20px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.25);
          cursor: pointer;
          user-select: none;
          transition: all 0.2s ease;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .badge:hover {
          background: #2b2b36;
          transform: translateY(-1px);
        }
        .badge.busy {
          cursor: wait;
          opacity: 0.85;
        }
        .badge.active {
          background: #0284c7;
          border-color: #38bdf8;
        }
        .badge.error {
          background: #b91c1c;
          border-color: #f87171;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
        }
        .busy .dot {
          background: #f59e0b;
          animation: pulse 1s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 0.3; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1.1); }
        }
      </style>
      <div id="btn" class="badge" title="Локальный AI переводчик ZH -> RU">
        <span class="dot"></span>
        <span id="label">ZH → RU</span>
      </div>
    `;

    const btn = shadowRoot.getElementById("btn");
    btn.addEventListener("click", () => {
      if (isTranslating) return;
      if (isTranslated) {
        restoreOriginal();
      } else {
        translatePage();
      }
    });

    document.documentElement.appendChild(widgetContainer);
  }

  function updateWidgetUI(state, data = {}) {
    if (!shadowRoot) return;
    const btn = shadowRoot.getElementById("btn");
    const label = shadowRoot.getElementById("label");
    if (!btn || !label) return;

    btn.className = "badge";

    if (state === "translating") {
      btn.classList.add("busy");
      label.textContent = `Перевод ${data.current || 0}/${data.total || 0}...`;
    } else if (state === "done") {
      btn.classList.add("active");
      label.textContent = "Оригинал (ZH)";
    } else if (state === "no_chinese") {
      label.textContent = "Нет китайского";
      setTimeout(() => {
        label.textContent = "ZH → RU";
      }, 2000);
    } else if (state === "error") {
      btn.classList.add("error");
      label.textContent = "Ошибка API";
      btn.title = data.error || "Ошибка подключения";
      setTimeout(() => {
        btn.className = "badge";
        label.textContent = "ZH → RU";
      }, 4000);
    } else {
      label.textContent = "ZH → RU";
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "TRANSLATE_PAGE") {
      translatePage().then(() => {
        sendResponse({ success: true, isTranslated });
      });
      return true;
    }
    if (msg.action === "RESTORE_ORIGINAL") {
      const restored = restoreOriginal();
      sendResponse({ success: true, restoredCount: restored });
      return true;
    }
    if (msg.action === "GET_STATUS") {
      sendResponse({
        isTranslating,
        isTranslated,
        activeNodesCount: activeNodes.size,
        activeAttrsCount: activeAttrElements.size
      });
      return true;
    }
  });

  function checkAutoResume() {
    initFloatingWidget();
    initGlobalPortalCloser();
    try {
      if (sessionStorage.getItem("local_ai_translator_active") === "true") {
        setTimeout(() => {
          if (!isTranslated && !isTranslating) {
            sendLog("INFO", "AUTO_RESUME", "Auto-resuming translation on tab navigation");
            translatePage();
          }
        }, 150);
      }
    } catch (e) {}
  }

  // Inject floating button and auto-resume when document is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkAutoResume);
  } else {
    checkAutoResume();
  }
})();
