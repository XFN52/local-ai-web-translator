// Default configuration for Local AI Web Translator
const DEFAULT_CONFIG = {
  apiUrl: "http://localhost:8045/v1/chat/completions",
  model: "gemini-3.8-flash-low",
  apiKey: "",
  batchSize: 20
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = DEFAULT_CONFIG;
}
