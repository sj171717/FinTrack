const https = require("https");

function fetchDirect(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0" },
      timeout: 10000,
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
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const fhKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FMP_API_KEY;
  if (!fhKey) return res.status(503).json({ error: "No API key configured" });

  const fh = `token=${fhKey}`;
  const now = new Date();
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];
  const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [earningsR, nextEarningsR, newsR, filingsR] = await Promise.allSettled([
    fetchDirect(`https://finnhub.io/api/v1/stock/earnings?symbol=${ticker}&limit=8&${fh}`),
    fetchDirect(`https://finnhub.io/api/v1/calendar/earnings?symbol=${ticker}&from=${to}&to=${future}&${fh}`),
    fetchDirect(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&${fh}`),
    fetchDirect(`https://finnhub.io/api/v1/stock/filings?symbol=${ticker}&${fh}`),
  ]);

  const earnings = earningsR.status === "fulfilled" && Array.isArray(earningsR.value) ? earningsR.value : [];
  const nextEarnings = nextEarningsR.status === "fulfilled" ? nextEarningsR.value?.earningsCalendar?.[0] : null;
  const news = newsR.status === "fulfilled" && Array.isArray(newsR.value) ? newsR.value.slice(0, 20) : [];
  const filings = filingsR.status === "fulfilled" ? (filingsR.value?.data || []).slice(0, 10) : [];

  // Get description + CEO/employees from FMP profile
  let description = null, ceo = null, employees = null, website = null, ipo = null;
  if (fmpKey) {
    try {
      const fmpR = await fetchDirect(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${fmpKey}`);
      const p = Array.isArray(fmpR) ? fmpR[0] : null;
      if (p) {
        description = p.description || null;
        ceo = p.ceo || null;
        employees = p.fullTimeEmployees || null;
        website = p.website || null;
        ipo = p.ipoDate || null;
      }
    } catch {}
  }

  res.status(200).json({ earnings, nextEarnings, news, filings, description, ceo, employees, website, ipo });
};
