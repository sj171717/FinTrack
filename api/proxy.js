const https = require("https");
const http = require("http");

module.exports = async (req, res) => {
  const target = req.query?.url;
  if (!target) return res.status(400).send("Missing url param");

  const hostMatch = target.match(/^https?:\/\/([^/?#]+)/);
  if (!hostMatch) return res.status(400).send("Invalid url");
  const hostname = hostMatch[1];

  const allowed = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "stooq.com",
    "cdn.jsdelivr.net",
    "api.elections.kalshi.com",
    "news.google.com",
    "api.financialdatasets.ai",
  ];
  if (!allowed.includes(hostname)) return res.status(403).send("Host not allowed");

  const rawPath = target.replace(/^https?:\/\/[^/?#]+/, "") || "/";
  const path = rawPath.replace(/\^/g, "%5E");

  const isYahoo = hostname.includes("yahoo.com");
  const isFD = hostname === "api.financialdatasets.ai";
  const headers = isYahoo ? {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  } : isFD ? {
    "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)",
    "Accept": "application/json",
    ...(req.headers["x-api-key"] ? { "X-API-KEY": req.headers["x-api-key"] } : {}),
  } : {
    "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)",
    "Accept": "text/plain, */*",
  };

  const lib = target.startsWith("https://") ? https : http;

  try {
    const body = await new Promise((resolve, reject) => {
      const req2 = lib.request({ hostname, path, method: "GET", headers, timeout: 9000 }, (r) => {
        if ((r.statusCode === 301 || r.statusCode === 302) && r.headers.location) {
          const loc = r.headers.location;
          const rh = loc.includes("yahoo.com") ? headers : { "User-Agent": headers["User-Agent"] };
          const req3 = https.request(loc, { method: "GET", headers: rh }, (r2) => {
            const chunks = [];
            r2.on("data", c => chunks.push(c));
            r2.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            r2.on("error", reject);
          });
          req3.on("error", reject);
          req3.end();
          return;
        }
        const chunks = [];
        r.on("data", c => chunks.push(c));
        r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        r.on("error", reject);
      });
      req2.on("error", reject);
      req2.on("timeout", () => { req2.destroy(); reject(new Error("timeout")); });
      req2.end();
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(200).send(body);
  } catch (err) {
    res.status(502).send("Upstream error: " + err.message);
  }
};
