const https = require("https");

function get(url, extraHeaders = {}) {
  return new Promise((resolve) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...extraHeaders,
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Fetch Jan 2 close price via Yahoo Finance v8 chart (ytd range, daily interval)
async function yahooYtdStart(ticker) {
  const year = new Date().getFullYear();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${Math.floor(new Date(`${year}-01-01`).getTime() / 1000)}&period2=${Math.floor(new Date(`${year}-01-15`).getTime() / 1000)}`;
  const data = await get(url, {
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
    "Accept-Language": "en-US,en;q=0.9",
  });
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;
  const closes = result.indicators?.quote?.[0]?.close || [];
  // First non-null close in Jan (the first trading day of the year)
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] != null && closes[i] > 0) return closes[i];
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Cache for 24 hours — Jan 1 price doesn't change
  res.setHeader("Cache-Control", "public, max-age=86400");

  const tickers = (req.query?.tickers || "")
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => t && t !== "CASH" && /^[A-Z]{1,6}$/.test(t));

  if (!tickers.length) return res.status(400).json({ error: "No tickers" });

  const year = new Date().getFullYear();
  const from = Math.floor(new Date(`${year}-01-01`).getTime() / 1000);
  const to   = Math.floor(new Date(`${year}-01-10`).getTime() / 1000);

  const fhKey = process.env.FINNHUB_API_KEY;
  const out = {};

  // ── Primary: Finnhub (if key available) ──
  if (fhKey) {
    const results = await Promise.allSettled(
      tickers.map(t =>
        get(`https://finnhub.io/api/v1/stock/candle?symbol=${t}&resolution=D&from=${from}&to=${to}&token=${fhKey}`)
      )
    );
    tickers.forEach((t, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value?.s === "ok" && r.value?.c?.length) {
        out[t] = r.value.c[0];
      }
    });
  }

  // ── Fallback: Yahoo Finance for any missing tickers ──
  const missing = tickers.filter(t => !out[t]);
  if (missing.length) {
    const results = await Promise.allSettled(missing.map(t => yahooYtdStart(t)));
    missing.forEach((t, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value > 0) {
        out[t] = r.value;
      }
    });
  }

  res.status(200).json(out);
};
