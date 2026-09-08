try {
  importScripts("config.js");
} catch (e) {
  // Ignore in environments where importScripts is not available
}

const DEFAULT_API_URL = typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.apiUrl : "http://localhost:8045/v1/chat/completions";
const DEFAULT_MODEL = typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.model : "gemini-3.8-flash-low";
const DEFAULT_API_KEY = typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.apiKey : "";
const LOGGER_ENDPOINT = "http://127.0.0.1:8046/log";

/**
 * Sends masked log entries to the local file logger (http://127.0.0.1:8046/log)
 * and persists to chrome.storage.local for popup access.
 */
function writeLog(level, tag, message, meta = {}) {
  const timestamp = new Date().toISOString();
  fetch(LOGGER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp, level, tag, message, meta })
  }).catch(() => {});

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ logs: [] }, (res) => {
      const logs = res.logs || [];
      logs.push({ timestamp, level, tag, message, meta });
      if (logs.length > 100) logs.shift();
      chrome.storage.local.set({ logs });
    });
  }
}

/**
 * Strips markdown code fences from LLM output if present.
 * @param {string} raw
 * @returns {string}
 */
function cleanJsonOutput(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

const MAX_CACHE_SIZE = 5000;
const translationCache = new Map();
let isCacheLoaded = false;
let saveCacheDebounce = null;

/**
 * Loads cached translations from chrome.storage.local into in-memory Map.
 */
async function loadCache() {
  if (isCacheLoaded) return;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const res = await new Promise((resolve) => {
        chrome.storage.local.get({ translation_cache: {} }, resolve);
      });
      const entries = Object.entries(res.translation_cache || {});
      for (const [k, v] of entries) {
        if (typeof k === "string" && typeof v === "string") {
          translationCache.set(k, v);
        }
      }
      isCacheLoaded = true;
      writeLog("INFO", "CACHE_INIT", `Loaded ${translationCache.size} translation pairs from storage`);
    } catch (e) {
      isCacheLoaded = true;
    }
  } else {
    isCacheLoaded = true;
  }
}

/**
 * Debounced persistence of translationCache to chrome.storage.local.
 */
function scheduleSaveCache() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  clearTimeout(saveCacheDebounce);
  saveCacheDebounce = setTimeout(() => {
    while (translationCache.size > MAX_CACHE_SIZE) {
      const oldestKey = translationCache.keys().next().value;
      translationCache.delete(oldestKey);
    }
    const obj = {};
    for (const [k, v] of translationCache.entries()) {
      obj[k] = v;
    }
    chrome.storage.local.set({ translation_cache: obj }, () => {
      writeLog("DEBUG", "CACHE_SAVED", `Persisted ${translationCache.size} entries to storage`);
    });
  }, 1000);
}

/**
 * Executes direct network request to local AI API for an array of unique strings.
 * @param {string[]} texts
 * @param {string} apiUrl
 * @param {string} model
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function requestAiTranslation(texts, apiUrl, model, apiKey) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const endpoint = apiUrl || DEFAULT_API_URL;
  const targetModel = model || DEFAULT_MODEL;
  const key = apiKey !== undefined ? apiKey : DEFAULT_API_KEY;
  const startTime = Date.now();
  const totalChars = texts.reduce((acc, t) => acc + (t ? t.length : 0), 0);

  writeLog("INFO", "BATCH_REQ", `Sending batch to AI (${texts.length} unique nodes, ${totalChars} chars)`, {
    model: targetModel,
    endpoint,
    nodeCount: texts.length,
    inputSample: texts.slice(0, 3)
  });

  const systemPrompt = [
    "You are a professional Chinese to Russian translator for web pages.",
    "Translate each Chinese text string in the input JSON array into natural, fluent Russian.",
    "Maintain the exact tone, terminology, and formatting tags/placeholders if any.",
    "UI CONCISENESS & COMPACTNESS: For buttons, navigation menus, tags, badges, and table headers (short strings under 10 Chinese characters), keep Russian translations VERY SHORT and compact (1-2 words max) to preserve web layout and prevent buttons from overflowing. Examples: 首页 -> Главная; 模型市场 -> Модели; 商家入驻 -> Партнерам; 控制台 -> Консоль; 文档 -> Доки; 禁 -> Блок; 固定此商家 -> Закрепить; 加入路由 -> В маршрут; 保真 -> Оригинал; 稳定 -> Стабильно; 高速 -> Быстро; 高质 -> Качество.",
    "CRITICAL REQUIREMENT: Output ONLY a valid JSON array of strings in the exact same length and order as the input array.",
    "Do NOT include markdown formatting, explanations, keys, or code blocks."
  ].join(" ");

  const requestBody = {
    model: targetModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(texts) }
    ],
    temperature: 0.1,
    stream: false
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
  } catch (networkErr) {
    writeLog("ERROR", "NETWORK", `Network connection to AI failed: ${networkErr.message}`, {
      endpoint,
      model: targetModel
    });
    throw networkErr;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    writeLog("ERROR", "API_RES", `AI server returned HTTP ${response.status}`, {
      status: response.status,
      errorBody: errText
    });
    throw new Error(`Local AI API error (${response.status}): ${errText || response.statusText}`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string") {
    writeLog("ERROR", "PARSE", "Response missing choices[0].message.content", { rawData: data });
    throw new Error("Invalid response structure from local AI API: missing choices[0].message.content");
  }

  const cleaned = cleanJsonOutput(rawContent);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    writeLog("ERROR", "JSON_PARSE", `Failed to parse AI JSON: ${parseErr.message}`, {
      rawOutputPreview: rawContent.slice(0, 300)
    });
    console.error("[LocalAI Translator] JSON parse failure on output:", rawContent);
    throw new Error(`Failed to parse AI JSON response: ${parseErr.message}`);
  }

  if (!Array.isArray(parsed)) {
    writeLog("ERROR", "STRUCTURE", "AI output was not a JSON array", { parsedType: typeof parsed });
    throw new Error("AI output was not a JSON array");
  }

  if (parsed.length !== texts.length) {
    writeLog("WARN", "ALIGNMENT", `Array size mismatch: expected ${texts.length}, got ${parsed.length}. Performing fallback alignment.`, {
      expected: texts.length,
      received: parsed.length
    });
    const adjusted = [];
    for (let i = 0; i < texts.length; i++) {
      adjusted.push(typeof parsed[i] === "string" ? parsed[i] : (parsed[i] ? String(parsed[i]) : texts[i]));
    }
    parsed = adjusted;
  }

  const result = parsed.map((item, idx) => (typeof item === "string" ? item : (item ? String(item) : texts[idx])));
  const latencyMs = Date.now() - startTime;

  const pairs = texts.map((zh, idx) => ({
    zh,
    ru: result[idx],
    leadingLen: (zh.match(/^\s*/) || [""])[0].length,
    trailingLen: (zh.match(/\s*$/) || [""])[0].length
  }));

  writeLog("INFO", "BATCH_DONE", `Batch translated successfully in ${latencyMs}ms (${result.length} unique nodes)`, {
    latencyMs,
    model: targetModel,
    usage: data?.usage || null,
    pairs
  });

  return result;
}

/**
 * Requests translation for a batch of strings, leveraging cache and deduplication.
 * @param {string[]} texts - Array of plain text strings in Chinese
 * @param {string} apiUrl - OpenAI-compatible endpoint URL
 * @param {string} model - Model identifier
 * @param {string} apiKey - Optional Bearer authentication token
 * @returns {Promise<string[]>} Translated Russian strings
 */
async function translateBatch(texts, apiUrl, model, apiKey) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  await loadCache();

  const result = new Array(texts.length);
  const missingIndicesMap = new Map();
  let hitCount = 0;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (translationCache.has(text)) {
      result[i] = translationCache.get(text);
      hitCount++;
    } else {
      if (!missingIndicesMap.has(text)) {
        missingIndicesMap.set(text, []);
      }
      missingIndicesMap.get(text).push(i);
    }
  }

  // 100% cache hit: return immediately without network call
  if (hitCount === texts.length) {
    writeLog("INFO", "CACHE_HIT", `All ${texts.length} nodes resolved from cache (0ms API latency, 0 quota spent)`);
    return result;
  }

  const uniqueMissing = Array.from(missingIndicesMap.keys());
  writeLog("INFO", "CACHE_STATS", `Cache resolved ${hitCount}/${texts.length} nodes (${Math.round((hitCount / texts.length) * 100)}%). Sending ${uniqueMissing.length} unique missing texts to AI.`);

  const aiTranslations = await requestAiTranslation(uniqueMissing, apiUrl, model, apiKey);

  for (let m = 0; m < uniqueMissing.length; m++) {
    const orig = uniqueMissing[m];
    const trans = aiTranslations[m] || orig;
    translationCache.set(orig, trans);

    const indices = missingIndicesMap.get(orig);
    if (indices) {
      for (const idx of indices) {
        result[idx] = trans;
      }
    }
  }

  scheduleSaveCache();
  return result;
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOG_EVENT") {
    writeLog(message.level, message.tag, message.message, message.meta);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "TRANSLATE_BATCH") {
    translateBatch(message.texts, message.apiUrl, message.model, message.apiKey)
      .then((translations) => {
        sendResponse({ success: true, translations });
      })
      .catch((err) => {
        writeLog("ERROR", "TRANSLATE", `Batch translation failed: ${err.message}`);
        console.error("[LocalAI Translator] Batch translation error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  if (message?.type === "GET_CACHE_STATS") {
    loadCache().then(() => {
      sendResponse({ size: translationCache.size, maxSize: MAX_CACHE_SIZE });
    });
    return true;
  }

  if (message?.type === "CLEAR_CACHE") {
    translationCache.clear();
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove("translation_cache", () => {
        writeLog("INFO", "CACHE_CLEAR", "Translation cache cleared by user request");
        sendResponse({ success: true, size: 0 });
      });
    } else {
      writeLog("INFO", "CACHE_CLEAR", "Translation cache cleared");
      sendResponse({ success: true, size: 0 });
    }
    return true;
  }

  if (message?.type === "CHECK_CONNECTION") {
    const endpoint = message.apiUrl || DEFAULT_API_URL;
    const key = message.apiKey !== undefined ? message.apiKey : DEFAULT_API_KEY;
    const headers = {};
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    writeLog("INFO", "API", `Checking connection to ${endpoint}`);
    fetch(endpoint.replace(/\/chat\/completions\/?$/, "/models"), { method: "GET", headers })
      .then((res) => {
        writeLog("INFO", "API", `Connection check successful: HTTP ${res.status}`);
        sendResponse({ ok: res.ok, status: res.status });
      })
      .catch((err) => {
        writeLog("WARN", "API", `Connection check failed: ${err.message}`);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
});
