const https = require("https");

function fetchYahoo(sym) {
  return new Promise((resolve) => {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 40 * 24 * 60 * 60; // 40 days back
    const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${start}&period2=${end}`;
    const req = https.request({
      hostname: "query1.finance.yahoo.com",
      path,
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
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = data?.chart?.result?.[0];
          if (!result) return resolve(null);
          const timestamps = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          const rows = timestamps
            .map((ts, i) => ({ ts: ts * 1000, c: closes[i] }))
            .filter(x => x.c != null && !isNaN(x.c));
          resolve(rows.length >= 2 ? rows : null);
        } catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Finnhub candles fallback (if key available)
function fetchFinnhub(sym, fhKey) {
  return new Promise((resolve) => {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 40 * 24 * 60 * 60;
    const path = `/api/v1/stock/candle?symbol=${sym}&resolution=D&from=${start}&to=${end}&token=${fhKey}`;
    const req = https.request({
      hostname: "finnhub.io",
      path,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0" },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (data?.s !== "ok" || !data?.c?.length) return resolve(null);
          const rows = data.t.map((ts, i) => ({ ts: ts * 1000, c: data.c[i] }))
            .filter(x => x.c != null && !isNaN(x.c));
          resolve(rows.length >= 2 ? rows : null);
        } catch { resolve(null); }
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
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache

  const tickers = (req.query?.tickers || "")
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => t && t !== "CASH" && /^[A-Z]{1,6}$/.test(t));

  if (!tickers.length) return res.status(400).json({ error: "No tickers" });

  const fhKey = process.env.FINNHUB_API_KEY;

  const results = await Promise.allSettled(
    tickers.map(async t => {
      // Primary: Yahoo Finance
      let rows = await fetchYahoo(t);
      // Fallback: Finnhub candles (if key set)
      if (!rows && fhKey) rows = await fetchFinnhub(t, fhKey);
      return { t, rows };
    })
  );

  const out = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.rows) {
      out[r.value.t] = {
        pts: r.value.rows.map(x => x.c),
        timestamps: r.value.rows.map(x => x.ts),
      };
    }
  }

  res.status(200).json(out);
};
