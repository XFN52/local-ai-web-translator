/**
 * Popup Script for Local AI Web Translator
 */

document.addEventListener("DOMContentLoaded", () => {
  const apiUrlInput = document.getElementById("apiUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const modelInput = document.getElementById("model");
  const batchSizeInput = document.getElementById("batchSize");
  const translateBtn = document.getElementById("translateBtn");
  const restoreBtn = document.getElementById("restoreBtn");
  const toggleSettings = document.getElementById("toggleSettings");
  const settingsPanel = document.getElementById("settingsPanel");
  const testApiBtn = document.getElementById("testApiBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const cacheStats = document.getElementById("cacheStats");
  const clearCacheBtn = document.getElementById("clearCacheBtn");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  const DEFAULTS = {
    apiUrl: typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.apiUrl : "http://localhost:8045/v1/chat/completions",
    model: typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.model : "gemini-3.8-flash-low",
    apiKey: typeof DEFAULT_CONFIG !== "undefined" ? DEFAULT_CONFIG.apiKey : "",
    batchSize: 20
  };

  function refreshCacheStats() {
    if (!cacheStats) return;
    chrome.runtime.sendMessage({ type: "GET_CACHE_STATS" }, (res) => {
      if (!chrome.runtime.lastError && res) {
        cacheStats.textContent = `Кэш: ${res.size || 0} записей`;
      }
    });
  }

  function setStatus(text, type = "normal") {
    statusText.textContent = text;
    statusDot.className = "status-dot";
    if (type === "active") statusDot.classList.add("active");
    if (type === "error") statusDot.classList.add("error");
  }

  // Load saved options
  chrome.storage.sync.get(DEFAULTS, (items) => {
    apiUrlInput.value = items.apiUrl || DEFAULTS.apiUrl;
    apiKeyInput.value = items.apiKey || DEFAULTS.apiKey;
    modelInput.value = items.model || DEFAULTS.model;
    batchSizeInput.value = items.batchSize || DEFAULTS.batchSize;
  });

  // Toggle settings view
  toggleSettings.addEventListener("click", () => {
    settingsPanel.classList.toggle("open");
  });

  // Save settings
  saveSettingsBtn.addEventListener("click", () => {
    const newSettings = {
      apiUrl: apiUrlInput.value.trim() || DEFAULTS.apiUrl,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || DEFAULTS.model,
      batchSize: parseInt(batchSizeInput.value, 10) || DEFAULTS.batchSize
    };
    chrome.storage.sync.set(newSettings, () => {
      setStatus("Настройки сохранены", "active");
      setTimeout(() => setStatus("Готов к переводу"), 2000);
    });
  });

  // Clear translation cache
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, (res) => {
        if (!chrome.runtime.lastError && res && res.success) {
          if (cacheStats) cacheStats.textContent = "Кэш: 0 записей";
          setStatus("Кэш очищен", "active");
          setTimeout(() => setStatus("Готов к переводу"), 2000);
        }
      });
    });
  }

  refreshCacheStats();

  // Test local API connection
  testApiBtn.addEventListener("click", () => {
    const url = apiUrlInput.value.trim() || DEFAULTS.apiUrl;
    const key = apiKeyInput.value.trim() || DEFAULTS.apiKey;
    setStatus("Проверка связи с API...");
    chrome.runtime.sendMessage({ type: "CHECK_CONNECTION", apiUrl: url, apiKey: key }, (res) => {
      if (chrome.runtime.lastError) {
        setStatus("Ошибка фонового сервиса", "error");
        return;
      }
      if (res && res.ok) {
        setStatus(`API доступен (HTTP ${res.status})`, "active");
      } else {
        setStatus("API недоступен: " + (res?.error || "проверьте порт"), "error");
      }
    });
  });

  // Send action to active tab
  function sendTabAction(actionName) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        setStatus("Вкладка не найдена", "error");
        return;
      }
      const tabId = tabs[0].id;
      setStatus("Отправка запроса на страницу...");

      chrome.tabs.sendMessage(tabId, { action: actionName }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus("Обновите страницу для подключения скрипта", "error");
          return;
        }
        if (actionName === "TRANSLATE_PAGE") {
          setStatus("Перевод запущен на странице", "active");
        } else if (actionName === "RESTORE_ORIGINAL") {
          setStatus(`Восстановлено узлов: ${response?.restoredCount || 0}`, "active");
        }
      });
    });
  }

  translateBtn.addEventListener("click", () => sendTabAction("TRANSLATE_PAGE"));
  restoreBtn.addEventListener("click", () => sendTabAction("RESTORE_ORIGINAL"));

  // Check current page translation status on open
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "GET_STATUS" }, (res) => {
        if (!chrome.runtime.lastError && res) {
          if (res.isTranslating) {
            setStatus("Идет перевод страницы...", "active");
          } else if (res.isTranslated) {
            setStatus(`Страница переведена (${res.activeNodesCount} узлов)`, "active");
          }
        }
      });
    }
  });

  // Export logs handler
  const downloadLogsBtn = document.getElementById("downloadLogsBtn");
  if (downloadLogsBtn) {
    downloadLogsBtn.addEventListener("click", () => {
      chrome.storage.local.get({ logs: [] }, (res) => {
        const text = (res.logs || []).map((l) => `[${l.timestamp}] [${l.level}] [${l.tag}] ${l.message} ${l.meta ? JSON.stringify(l.meta) : ""}`).join("\n");
        const blob = new Blob([text || "Логи отсутствуют\n"], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `translator_${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }
});
