const https = require("https");

function get(url) {
  return new Promise((resolve) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=15");

  const tickers = (req.query?.tickers || "")
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => t && t !== "CASH" && /^[A-Z]{1,6}$/.test(t));

  if (!tickers.length) return res.status(400).json({ error: "No tickers" });

  const out = {};

  // ── Primary: Finnhub (if key available) ──
  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey) {
    const fhResults = await Promise.allSettled(
      tickers.map(t => get(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${fhKey}`))
    );
    tickers.forEach((t, i) => {
      const r = fhResults[i];
      if (r.status === "fulfilled" && r.value && r.value.c > 0) {
        const price = r.value.c;
        const prevClose = r.value.pc;
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : (r.value.dp || 0);
        out[t] = { price, changePct, prevClose };
      }
    });
  }

  // ── Fallback: Yahoo Finance batch for any missing tickers ──
  const missing = tickers.filter(t => !out[t]);
  if (missing.length) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${missing.map(encodeURIComponent).join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose`;
    const data = await get(url);
    const results = data?.quoteResponse?.result || [];
    for (const r of results) {
      const price = r.regularMarketPrice;
      const changePct = r.regularMarketChangePercent || 0;
      const prevClose = r.regularMarketPreviousClose || 0;
      if (price > 0) out[r.symbol] = { price, changePct, prevClose };
    }
  }

  res.status(200).json(out);
};
