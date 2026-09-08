/**
 * Lightweight Local Log Server for Local AI Web Translator
 * Appends extension events to ./logs/translator.log (Node.js stdlib only)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.LOG_PORT, 10) || 8046;
const LOGS_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOGS_DIR, "translator.log");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function maskSensitiveData(text) {
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch (e) {
      return String(text);
    }
  }
  return text
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, "Bearer ***");
}

function formatLogEntry(entry) {
  const timestamp = entry.timestamp || new Date().toISOString();
  const level = (entry.level || "INFO").toUpperCase();
  const tag = entry.tag || "EXT";
  const message = maskSensitiveData(entry.message || "");

  let block = `[${timestamp}] [${level}] [${tag}] ${message}\n`;

  if (entry.meta && typeof entry.meta === "object") {
    if (Array.isArray(entry.meta.pairs) && entry.meta.pairs.length > 0) {
      block += `  ┌─ Translation Mapping (${entry.meta.pairs.length} nodes):\n`;
      entry.meta.pairs.forEach((p, idx) => {
        const num = String(idx + 1).padStart(3, "0");
        const spaces = `(spaces: ^${p.leadingLen || 0} / $${p.trailingLen || 0})`;
        block += `  │ [#${num}] ZH: "${p.zh}" ${spaces}\n  │        RU: "${p.ru}"\n`;
      });
      block += `  └────────────────────────────────────────────────────────\n`;
    }

    const otherMeta = { ...entry.meta };
    delete otherMeta.pairs;
    if (Object.keys(otherMeta).length > 0) {
      block += `  [DETAILS]: ${maskSensitiveData(JSON.stringify(otherMeta, null, 2)).replace(/\n/g, "\n  ")}\n`;
    }
  }

  return block;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2e6) req.destroy();
    });

    req.on("end", () => {
      try {
        const entry = JSON.parse(body);
        const logBlock = formatLogEntry(entry);

        fs.appendFile(LOG_FILE, logBlock, (err) => {
          if (err) {
            console.error("Failed to append log:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          process.stdout.write(logBlock);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/logs")) {
    if (fs.existsSync(LOG_FILE)) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      fs.createReadStream(LOG_FILE).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Лог-файл пока пуст. Запустите перевод страницы.\n");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[Local Logger] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Local Logger] Log file destination: ${LOG_FILE}`);
});
