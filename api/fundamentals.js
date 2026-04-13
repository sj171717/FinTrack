const https = require("https");

function fetchJson(url, apiKey) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
        "User-Agent": "FinTrack/1.0",
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { resolve(null); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const apiKey = process.env.FD_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Not configured" });

  const BASE = "https://api.financialdatasets.ai";

  try {
    const [incR, balR, factR] = await Promise.allSettled([
      fetchJson(`${BASE}/financials/income-statements/?ticker=${ticker}&period=ttm&limit=1`, apiKey),
      fetchJson(`${BASE}/financials/balance-sheets/?ticker=${ticker}&period=ttm&limit=1`, apiKey),
      fetchJson(`${BASE}/company/facts/?ticker=${ticker}`, apiKey),
    ]);

    const incRaw = incR.status === "fulfilled" ? incR.value : null;
    const balRaw = balR.status === "fulfilled" ? balR.value : null;
    const factsRaw = factR.status === "fulfilled" ? factR.value : null;

    // Return raw for debugging
    res.status(200).json({ _debug: { incRaw, balRaw, factsRaw } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
