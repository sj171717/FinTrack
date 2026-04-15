const https = require("https");

function fetchDirect(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0" },
      timeout: 12000,
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
  const fhKey = process.env.FINNHUB_API_KEY;
  if (!fhKey) return res.status(503).json({ error: "No API key" });

  const tickers = (req.query?.tickers || "")
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => t && t !== "CASH" && /^[A-Z]{1,6}$/.test(t));

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const to = new Date(now.getFullYear(), now.getMonth() + 5, 0).toISOString().split("T")[0];
  const fh = `token=${fhKey}`;

  const reqs = [
    fetchDirect(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&${fh}`),
    fetchDirect(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&${fh}`),
    ...tickers.map(t => fetchDirect(`https://finnhub.io/api/v1/stock/dividend?symbol=${t}&from=${from}&to=${to}&${fh}`)),
  ];

  const results = await Promise.allSettled(reqs);
  const [econR, earnR, ...divRs] = results;

  const KEEP = new Set(["US","JP","EU","GB","CN","HK","TW"]);
  const economic = (econR.value?.economicCalendar || [])
    .filter(ev => KEEP.has(ev.country) && ev.impact === "high")
    .map(ev => ({ ...ev, date: ev.time ? ev.time.split(" ")[0] : null }))
    .filter(ev => ev.date);

  const tickerSet = new Set(tickers);
  const earnings = (earnR.value?.earningsCalendar || [])
    .filter(e => !tickerSet.size || tickerSet.has(e.symbol));

  const dividends = {};
  tickers.forEach((t, i) => {
    const r = divRs[i];
    if (r?.status === "fulfilled" && Array.isArray(r.value) && r.value.length) {
      dividends[t] = r.value.slice(0, 6);
    }
  });

  res.status(200).json({ economic, earnings, dividends });
};
