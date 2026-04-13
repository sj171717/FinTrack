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

    const inc = incR.status === "fulfilled" ? incR.value?.income_statements?.[0] : null;
    const bal = balR.status === "fulfilled" ? balR.value?.balance_sheets?.[0] : null;
    const facts = factR.status === "fulfilled" ? factR.value?.company_facts : null;

    const totalDebt = (bal?.long_term_debt ?? 0) + (bal?.short_term_debt ?? 0);
    const equity = bal?.shareholders_equity ?? null;

    res.status(200).json({
      pe: facts?.pe_ratio ?? null,
      eps: inc?.earnings_per_share_basic ?? null,
      revenue: inc?.revenue ?? null,
      netIncome: inc?.net_income ?? null,
      marketCap: facts?.market_cap ?? null,
      debtToEquity: equity && equity > 0 ? totalDebt / equity : null,
      roe: equity && equity > 0 && inc?.net_income != null ? inc.net_income / equity * 100 : null,
      sector: facts?.sector ?? null,
      industry: facts?.industry ?? null,
      employees: facts?.employees ?? null,
      description: facts?.description ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
