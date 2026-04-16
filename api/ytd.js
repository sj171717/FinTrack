const https = require("https");

function get(url) {
  return new Promise((resolve) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0" },
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
  // Jan 1 to Jan 10 window — catches first trading day even if Jan 1/2/3 are holidays
  const from = Math.floor(new Date(`${year}-01-01`).getTime() / 1000);
  const to   = Math.floor(new Date(`${year}-01-10`).getTime() / 1000);

  const fhKey = process.env.FINNHUB_API_KEY;
  const out = {};

  if (fhKey) {
    const results = await Promise.allSettled(
      tickers.map(t =>
        get(`https://finnhub.io/api/v1/stock/candle?symbol=${t}&resolution=D&from=${from}&to=${to}&token=${fhKey}`)
      )
    );
    tickers.forEach((t, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value?.s === "ok" && r.value?.c?.length) {
        // First closing price of the year
        out[t] = r.value.c[0];
      }
    });
  }

  res.status(200).json(out);
};
