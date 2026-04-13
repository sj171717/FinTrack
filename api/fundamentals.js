const https = require("https");

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", "Referer": "https://finance.yahoo.com/", "Origin": "https://finance.yahoo.com", ...headers },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ _rawText: raw.slice(0, 500) }); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function fetchYahooQuote(ticker) {
  // Use same approach as proxy.js — Yahoo blocks direct server calls without proper headers
  const yh = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
    "Cookie": "GUC=AQEBAQFn; A1=d=AQABBCd; A3=d=AQABBCd",
  };
  const modules = "financialData,defaultKeyStatistics,summaryDetail,assetProfile,calendarEvents";
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`;
  const data = await fetchJson(url, yh);
  const r = data?.quoteSummary?.result?.[0];
  if (!r) return null;
  const fin = r.financialData || {};
  const stats = r.defaultKeyStatistics || {};
  const detail = r.summaryDetail || {};
  const profile = r.assetProfile || {};
  const cal = r.calendarEvents || {};
  const earningsTs = cal.earnings?.earningsDate?.[0]?.raw ?? null;
  const exDivTs = detail.exDividendDate?.raw ?? null;
  return {
    marketCap: detail.marketCap?.raw ?? null,
    pe: detail.trailingPE?.raw ?? null,
    eps: stats.trailingEps?.raw ?? null,
    beta: stats.beta?.raw ?? null,
    dividendRate: detail.dividendRate?.raw ?? null,
    dividendYield: detail.dividendYield?.raw ?? null,
    exDivDate: exDivTs ? new Date(exDivTs * 1000).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : null,
    earningsDate: earningsTs ? new Date(earningsTs * 1000).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : null,
    targetPrice: fin.targetMeanPrice?.raw ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    exchange: null,
    location: profile.country ?? null,
    roe: fin.returnOnEquity?.raw != null ? fin.returnOnEquity.raw * 100 : null,
    debtToEquity: fin.debtToEquity?.raw != null ? fin.debtToEquity.raw / 100 : null,
  };
}

async function fetchFD(ticker, apiKey) {
  const BASE = "https://api.financialdatasets.ai";
  const h = { "X-API-KEY": apiKey };
  const [incR, balR] = await Promise.allSettled([
    fetchJson(`${BASE}/financials/income-statements/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchJson(`${BASE}/financials/balance-sheets/?ticker=${ticker}&period=ttm&limit=1`, h),
  ]);
  const inc = incR.status === "fulfilled" ? incR.value?.income_statements?.[0] : null;
  const bal = balR.status === "fulfilled" ? balR.value?.balance_sheets?.[0] : null;
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
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = req.query?.ticker?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const apiKey = process.env.FD_API_KEY;

  try {
    // Always fetch Yahoo quote for market-level data
    const [q, fd] = await Promise.allSettled([
      fetchYahooQuote(ticker),
      apiKey ? fetchFD(ticker, apiKey) : Promise.resolve(null),
    ]);

    const yq = q.status === "fulfilled" ? q.value : null;
    const fdData = fd.status === "fulfilled" ? fd.value : null;

    // Format earnings date
    const earningsTs = yq?.earningsTimestamp ?? yq?.earningsTimestampStart ?? null;
    const earningsDate = earningsTs ? new Date(earningsTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

    // Format ex-dividend date
    const exDivTs = yq?.exDividendDate ?? null;
    const exDivDate = exDivTs ? new Date(exDivTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

    const result = {
      // From Yahoo quote
      marketCap: yq?.marketCap ?? null,
      pe: yq?.trailingPE ?? null,
      eps: yq?.epsTrailingTwelveMonths ?? null,
      beta: yq?.beta ?? null,
      dividendRate: yq?.dividendRate ?? null,
      dividendYield: yq?.dividendYield ?? null,
      exDivDate,
      earningsDate,
      targetPrice: yq?.targetMeanPrice ?? null,
      sector: yq?.sector ?? null,
      industry: yq?.industry ?? null,
      exchange: yq?.fullExchangeName ?? yq?.exchange ?? null,
      location: yq?.region ?? null,
      // From FD (override Yahoo EPS if FD has it)
      revenue: fdData?.revenue ?? null,
      netIncome: fdData?.netIncome ?? null,
      grossProfit: fdData?.grossProfit ?? null,
      operatingIncome: fdData?.operatingIncome ?? null,
      debtToEquity: fdData?.debtToEquity ?? (yq?.debtToEquity != null ? yq.debtToEquity / 100 : null),
      roe: fdData?.roe ?? (yq?.returnOnEquity != null ? yq.returnOnEquity * 100 : null),
    };
    // Prefer FD eps if available
    if (fdData?.eps != null) result.eps = fdData.eps;

    res.status(200).json({...result, _yqDebug: yq});
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
