# Local AI Web Translator | Chinese to Russian (ZH → RU)

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Local AI](https://img.shields.io/badge/AI_Backend-Ollama_%7C_LM_Studio_%7C_vLLM-blueviolet)](https://github.com/XFN52/local-ai-web-translator)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI_Compatible_v1-orange)](https://github.com/XFN52/local-ai-web-translator)
[![Tests Passing](https://img.shields.io/badge/Tests-100%25_Passed-brightgreen)](test_dom_translation.js)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/XFN52/local-ai-web-translator/pulls)

> **High-performance, 100% DOM-safe browser extension** for seamless Chinese-to-Russian web translation powered by local Large Language Models (LLMs). Built specifically for modern dynamic SPAs, React/Vue applications, and complex enterprise UI frameworks (Semi UI, Ant Design, Element Plus).

---

## 🔍 Overview / Краткий обзор

**Local AI Web Translator** solves the primary flaw of traditional web translators: broken layouts, corrupted React component state, detached event handlers, and frozen dropdowns. By operating strictly on `TextNode.nodeValue` and live DOM attributes, it translates web pages natively without re-rendering or modifying the underlying DOM hierarchy.

- **English**: Lightweight Chrome Extension (Manifest V3) for Chinese to Russian web translation using local LLMs (Ollama, LM Studio, vLLM).
- **Русский**: Браузерное расширение (Manifest V3) для точного перевода веб-интерфейсов с китайского на русский язык через локальные нейросети.
- **中文**: 基于本地大语言模型 (Ollama / vLLM / LM Studio) 的 Chrome 扩展 (Manifest V3)，实现中文到俄语的高保真无损网页翻译，专为 React / Vue SPA 设计。

---

## ⚡ Key Highlights & Comparison / Сравнение

| Feature / Критерий | Standard Translators (Google, DeepL) | Local AI Web Translator (Ours) |
| :--- | :--- | :--- |
| **DOM Safety & React VDOM** | ❌ Replaces innerHTML, crashes React/Vue | ✅ **100% safe**: updates only `TextNode.nodeValue` |
| **Complex UI & Selects** | ❌ Breaks portals, freezes Semi UI dropdowns | ✅ **Protected**: portal detection & auto-closing |
| **Hover Tooltips & Attributes** | ❌ Ignores `data-tooltip`, `placeholder` | ✅ **Live scan**: translates attributes on the fly |
| **Token & Quota Consumption** | ❌ Floods LLM with entire document | ✅ **Viewport-Only**: translates visible viewport + lazy scroll |
| **Translation Caching** | ❌ Re-queries API on navigation | ✅ **Dual-Tier**: instant `pageCache` + 5,000 LRU storage |
| **SPA Route Stability** | ❌ Translation resets on tab switch | ✅ **Persistent**: hooks `pushState`, `popstate`, `focus` |
| **Privacy & Security** | ❌ Sends private company data to cloud | ✅ **100% Local & Offline**: zero external telemetry |
| **Restoration Fidelity** | ❌ Needs full page reload | ✅ **Bit-Exact**: instant rollback via `WeakMap` |

---

## 🚀 Key Features / Ключевые возможности

- 🛡️ **100% DOM Tree Integrity**: Zero alterations to DOM structure or CSS layout. React fibers, event listeners, and Vue virtual nodes stay untouched.
- 👁️ **Viewport-Only Scan & Lazy Scroll**: Translates only what is visible on the user's screen. Offscreen elements are registered in an `IntersectionObserver` and translated on scroll, reducing LLM token consumption by up to 80%.
- ⚡ **Dual-Tier High-Performance Caching**:
  - In-memory synchronous `pageCache` for instant translation of recurring UI labels.
  - Persistent LRU cache up to 5,000 entries stored in `chrome.storage.local`.
  - In-batch deduplication: identical Chinese strings in the same batch are sent to the LLM only once.
- 💬 **Dynamic Tooltip & Attribute Translation**: Automatically tracks and translates `data-tooltip`, `data-title`, `data-tip`, `title`, `placeholder`, and `aria-label`.
- 🔄 **Enterprise SPA & Tab Resiliency**: Automatically handles route transitions (`pushState`, `replaceState`, `hashchange`, `popstate`), tab switches (`visibilitychange`, `focus`), and React component re-mounts.
- 🎯 **Semi UI / Ant Design Fixes**: Special handling for `.semi-portal`, `.semi-popover`, `.semi-select-option`, and capture-phase click delegation preventing dropdown lockups.
- 🔒 **Privacy-First & Masked Logging**: Local background logging (`logger.js`) with automatic redaction of API keys (`sk-***`, `Bearer ***`).

---

## 🛠️ Architecture / Архитектура

```text
Web Page DOM
     │
     ├──► TreeWalker(NodeFilter.SHOW_TEXT) ──► Filter Ignored Tags (script, style, code...)
     │
     ├──► collectChineseAttributes() ────────► Filter (data-tooltip, placeholder, title...)
     │
     ▼
Viewport Check (isElementInViewport)
     ├──► In-Viewport  ──► Check pageCache & LRU Cache
     │                          ├──► Cache Hit  ──► Instant nodeValue mutation
     │                          └──► Cache Miss ──► Batch Request (deduplicated)
     │                                                    │
     │                                                    ▼
     │                                            background.js Service Worker
     │                                                    │
     │                                                    ▼
     │                                      Local LLM API (Ollama / vLLM / LM Studio)
     │                                                    │
     │                                                    ▼
     │                                         Atomic DOM nodeValue Update
     │
     └──► Below Fold   ──► Register in IntersectionObserver ──► Translate on Scroll
```

---

## 📦 Supported Local AI Backends / Совместимые бэкенды

Local AI Web Translator works with any OpenAI-compatible `/v1/chat/completions` endpoint:

| Backend | Default Endpoint | Authorization | Notes |
| :--- | :--- | :--- | :--- |
| **Ollama** | `http://localhost:11434/v1/chat/completions` | None required | Fast, lightweight local deployment |
| **LM Studio** | `http://localhost:1234/v1/chat/completions` | None required | Interactive GUI for GGUF models |
| **vLLM** | `http://localhost:8000/v1/chat/completions` | Optional Bearer | High-throughput batching for servers |
| **LocalAI** | `http://localhost:8080/v1/chat/completions` | Optional Bearer | Self-hosted multi-model engine |
| **Custom Proxy** | `http://localhost:8045/v1/chat/completions` | Bearer token | Compatible with custom gateways |

### Recommended Models for Chinese → Russian (ZH → RU)

- **Qwen 2.5 (7B / 14B / 32B)**: Exceptional translation accuracy and cultural nuance handling for Chinese idioms and technical terms.
- **DeepSeek-V3 / DeepSeek-R1**: State-of-the-art multilingual reasoning and concise UI translation.
- **Gemini-Flash**: Ultra-low latency, ideal for real-time web browsing.

---

## 📥 Installation / Установка

1. **Clone the repository**:
   ```bash
   git clone https://github.com/XFN52/local-ai-web-translator.git
   ```
2. **Open Extensions page** in your Chromium browser (Chrome, Edge, Brave, Vivaldi):
   ```text
   chrome://extensions/
   ```
3. Enable **"Developer mode"** (Режим разработчика) in the top-right corner.
4. Click **"Load unpacked"** (Загрузить распакованное) and select the cloned project folder.

---

## ⚙️ Configuration / Настройка

Click the extension icon in your browser toolbar to open the control popup:

- **API URL**: Endpoint URL (Default: `http://localhost:8045/v1/chat/completions` or `http://localhost:11434/v1/chat/completions`).
- **Model**: LLM model name (e.g. `gemini-3.8-flash-low`, `qwen2.5:latest`, `deepseek-v3`).
- **API Key**: Bearer token (optional for Ollama/LM Studio, required for secured endpoints).
- **Batch Size**: Number of strings per batch request (Default: `20`, Range: `5–50`).
- **Cache Controls**: Live display of cached entries and one-click "Clear Cache" button.

---

## 🧪 Testing / Тестирование

Run the integrated automated test suite validating DOM extraction, tooltip collection, LRU cache eviction, in-batch deduplication, and 100% exact rollback:

```bash
node test_dom_translation.js
```

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
