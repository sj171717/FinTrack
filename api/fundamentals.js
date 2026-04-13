const https = require("https");

function fetchDirect(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0", ...headers },
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

async function fetchFromFD(ticker, apiKey) {
  const BASE = "https://api.financialdatasets.ai";
  const h = { "X-API-KEY": apiKey };
  const [incR, balR, factR] = await Promise.allSettled([
    fetchDirect(`${BASE}/financials/income-statements/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchDirect(`${BASE}/financials/balance-sheets/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchDirect(`${BASE}/company/facts/?ticker=${ticker}`, h),
  ]);
  const inc = incR.status === "fulfilled" ? incR.value?.income_statements?.[0] : null;
  const bal = balR.status === "fulfilled" ? balR.value?.balance_sheets?.[0] : null;
  const facts = factR.status === "fulfilled" ? factR.value?.company_facts : null;
  const equity = bal?.shareholders_equity ?? null;
  const totalDebt = bal?.total_debt ?? 0;
  const netIncome = inc?.net_income ?? null;
  return {
    eps: inc?.earnings_per_share ?? null,
    revenue: inc?.revenue ?? null,
    netIncome,
    grossProfit: inc?.gross_profit ?? null,
    operatingIncome: inc?.operating_income ?? null,
    debtToEquity: equity && equity > 0 ? totalDebt / equity : null,
    roe: equity && equity > 0 && netIncome != null ? netIncome / equity * 100 : null,
    marketCap: null,
    beta: null,
    sector: facts?.sector ?? null,
    industry: facts?.industry ?? null,
    location: facts?.location ?? null,
  };
}

async function fetchFromFMP(ticker, apiKey) {
  const BASE = "https://financialmodelingprep.com/stable";
  const [profR, incR, balR] = await Promise.allSettled([
    fetchDirect(`${BASE}/profile?symbol=${ticker}&apikey=${apiKey}`, {}),
    fetchDirect(`${BASE}/income-statement?symbol=${ticker}&period=annual&limit=1&apikey=${apiKey}`, {}),
    fetchDirect(`${BASE}/balance-sheet-statement?symbol=${ticker}&period=annual&limit=1&apikey=${apiKey}`, {}),
  ]);
  const prof = profR.status === "fulfilled" && Array.isArray(profR.value) ? profR.value[0] : null;
  const inc = incR.status === "fulfilled" && Array.isArray(incR.value) ? incR.value[0] : null;
  const bal = balR.status === "fulfilled" && Array.isArray(balR.value) ? balR.value[0] : null;
  if (!prof && !inc) return null;
  const equity = bal?.totalStockholdersEquity ?? null;
  const totalDebt = bal?.totalDebt ?? 0;
  const netIncome = inc?.netIncome ?? null;
  return {
    eps: inc?.eps ?? prof?.eps ?? null,
    revenue: inc?.revenue ?? null,
    netIncome,
    grossProfit: inc?.grossProfit ?? null,
    operatingIncome: inc?.operatingIncome ?? null,
    debtToEquity: equity && equity > 0 ? totalDebt / equity : null,
    roe: equity && equity > 0 && netIncome != null ? netIncome / equity * 100 : null,
    marketCap: prof?.marketCap ?? null,
    beta: prof?.beta ?? null,
    sector: prof?.sector ?? null,
    industry: prof?.industry ?? null,
    location: prof?.country ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const fdKey = process.env.FD_API_KEY;
  const fmpKey = process.env.FMP_API_KEY;

  try {
    let result = null;

    // Try FD first
    if (fdKey) {
      result = await fetchFromFD(ticker, fdKey);
    }

    // Always try FMP to fill in gaps (market cap, beta, and financials for stocks FD doesn't cover)
    if (fmpKey) {
      const fmp = await fetchFromFMP(ticker, fmpKey);
      if (fmp) {
        result = result
          ? Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v ?? fmp[k]]))
          : fmp;
      }
    }

    res.status(200).json(result || { error: "No data available" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
