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

async function fetchFromFinnhub(ticker, apiKey) {
  const h = { "X-Finnhub-Token": apiKey };
  const [metricR, profileR] = await Promise.allSettled([
    fetchDirect(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${apiKey}`, {}),
    fetchDirect(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${apiKey}`, {}),
  ]);
  const m = metricR.status === "fulfilled" ? metricR.value?.metric : null;
  const p = profileR.status === "fulfilled" ? profileR.value : null;
  if (!m && !p) return null;

  const mcap = m?.marketCapitalization != null ? m.marketCapitalization * 1e6 : null;
  return {
    marketCap: mcap,
    beta: m?.beta ?? null,
    pe: m?.peExclExtraTTM ?? m?.peBasicExclExtraTTM ?? null,
    eps: m?.epsBasicExclExtraItemsTTM ?? null,
    grossMargin: m?.grossMarginTTM ?? null,
    netMargin: m?.netProfitMarginTTM ?? null,
    roe: m?.roeTTM ?? null,
    debtToEquity: m?.["totalDebt/totalEquityAnnual"] ?? null,
    dividendYield: m?.currentDividendYieldTTM ?? m?.dividendYieldIndicatedAnnual ?? null,
    revenue: null,  // Finnhub metric doesn't have raw revenue — filled by FD
    netIncome: null,
    grossProfit: null,
    operatingIncome: null,
    sector: p?.finnhubIndustry ?? null,
    industry: null,
    location: p?.country ?? null,
  };
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
  return {
    revenue: inc?.revenue ?? null,
    grossProfit: inc?.gross_profit ?? null,
    netIncome: inc?.net_income ?? null,
    operatingIncome: inc?.operating_income ?? null,
    sector: facts?.sector ?? null,
    industry: facts?.industry ?? null,
    location: facts?.location ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fdKey = process.env.FD_API_KEY;

  try {
    let result = null;

    // Finnhub is primary — covers all US stocks
    if (finnhubKey) {
      result = await fetchFromFinnhub(ticker, finnhubKey);
    }

    // FD supplements with raw income statement data
    if (fdKey) {
      const fd = await fetchFromFD(ticker, fdKey);
      if (fd) {
        result = result
          ? Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v ?? fd[k]]))
          : fd;
      }
    }

    res.status(200).json(result || { error: "No data available" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
