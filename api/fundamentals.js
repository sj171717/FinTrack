const https = require("https");

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)", ...headers },
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

async function fetchFromFD(ticker, apiKey) {
  const BASE = "https://api.financialdatasets.ai";
  const h = { "X-API-KEY": apiKey };
  const [incR, balR, factR] = await Promise.allSettled([
    fetchJson(`${BASE}/financials/income-statements/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchJson(`${BASE}/financials/balance-sheets/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchJson(`${BASE}/company/facts/?ticker=${ticker}`, h),
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
    sector: facts?.sector ?? null,
    industry: facts?.industry ?? null,
    exchange: facts?.exchange ?? null,
    location: facts?.location ?? null,
  };
}

async function fetchFromYahoo(ticker) {
  const yh = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" };
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData,defaultKeyStatistics,summaryProfile,incomeStatementHistory`;
  const data = await fetchJson(url, yh);
  const fin = data?.quoteSummary?.result?.[0]?.financialData;
  const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
  const profile = data?.quoteSummary?.result?.[0]?.summaryProfile;
  const inc = data?.quoteSummary?.result?.[0]?.incomeStatementHistory?.incomeStatementHistory?.[0];
  const revenue = fin?.totalRevenue?.raw ?? null;
  const netIncome = fin?.netIncomeToCommon?.raw ?? null;
  const equity = fin?.returnOnEquity?.raw != null && fin?.returnOnEquity?.raw !== 0
    ? (netIncome != null ? netIncome / fin.returnOnEquity.raw : null)
    : null;
  const totalDebt = fin?.totalDebt?.raw ?? null;
  return {
    eps: stats?.trailingEps?.raw ?? null,
    revenue,
    netIncome,
    grossProfit: inc?.grossProfit?.raw ?? null,
    operatingIncome: fin?.operatingCashflow?.raw ?? inc?.totalOperatingExpenses?.raw ?? null,
    debtToEquity: fin?.debtToEquity?.raw != null ? fin.debtToEquity.raw / 100 : null,
    roe: fin?.returnOnEquity?.raw != null ? fin.returnOnEquity.raw * 100 : null,
    sector: profile?.sector ?? null,
    industry: profile?.industry ?? null,
    exchange: null,
    location: profile?.country ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const apiKey = process.env.FD_API_KEY;

  try {
    let result = null;

    // Try financialdatasets.ai first if key is set
    if (apiKey) {
      result = await fetchFromFD(ticker, apiKey);
    }

    // Fall back to Yahoo Finance for any null financials
    const needsYahoo = !result || result.eps == null || result.revenue == null;
    if (needsYahoo) {
      const yf = await fetchFromYahoo(ticker);
      if (!result) {
        result = yf;
      } else {
        // Merge: use Yahoo values where FD returned null
        for (const k of Object.keys(result)) {
          if (result[k] == null && yf[k] != null) result[k] = yf[k];
        }
      }
    }

    res.status(200).json(result || { error: "No data found" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
