const https = require("https");

function fetchDirect(url) {
  return new Promise((resolve, reject) => {
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
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
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
  res.setHeader("Cache-Control", "public, max-age=30");

  const fhKey = process.env.FINNHUB_API_KEY;
  if (!fhKey) return res.status(503).json({ error: "No API key" });

  const ticker = (req.query?.ticker || "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const now = Math.floor(Date.now() / 1000);
  // From market open today (14:30 UTC = 9:30 AM ET), or 24h ago for safety
  const from = now - 24 * 60 * 60;

  const data = await fetchDirect(
    `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=5&from=${from}&to=${now}&token=${fhKey}`
  );

  if (!data || data.s !== "ok" || !data.c?.length) {
    return res.status(200).json({ pts: [], timestamps: [] });
  }

  // Filter to today's session only (after midnight ET = 04:00 UTC)
  const todayStart = new Date();
  todayStart.setUTCHours(4, 0, 0, 0); // midnight ET approx
  const todayStartTs = Math.floor(todayStart.getTime() / 1000);

  const pts = [], timestamps = [];
  for (let i = 0; i < data.t.length; i++) {
    if (data.t[i] >= todayStartTs && data.c[i] != null) {
      pts.push(data.c[i]);
      timestamps.push(data.t[i] * 1000);
    }
  }

  res.status(200).json({ pts, timestamps });
};
