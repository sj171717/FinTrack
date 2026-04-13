const https = require("https");

// Call our own proxy (which has working Yahoo headers) to fetch JSON
function fetchViaProxy(host, url) {
  return new Promise((resolve, reject) => {
    const path = `/api/proxy?url=${encodeURIComponent(url)}`;
    const req = https.request({
      hostname: host,
      path,
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "FinTrack/1.0" },
      timeout: 12000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); }
        catch { resolve(null); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

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
        try { resolve(JSON.parse(raw)); }
        catch { resolve(null); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function fetchYahooSummary(ticker, host) {
  // Use v7 quote — same endpoint that works for price fetching in the app
  const fields = "regularMarketPrice,trailingPE,epsTrailingTwelveMonths,marketCap,beta,trailingAnnualDividendRate,trailingAnnualDividendYield,exDividendDate,earningsTimestamp,targetMeanPrice,fullExchangeName,sector,industry,country,returnOnEquity,debtToEquity";
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=${fields}`;
  const data = await fetchViaProxy(host, url);
  const q = data?.quoteResponse?.result?.[0];
  if (!q) return null;
  const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : null;
  return {
    marketCap: q.marketCap ?? null,
    pe: q.trailingPE ?? null,
    eps: q.epsTrailingTwelveMonths ?? null,
    beta: q.beta ?? null,
    dividendRate: q.trailingAnnualDividendRate ?? null,
    dividendYield: q.trailingAnnualDividendYield ?? null,
    exDivDate: fmtDate(q.exDividendDate),
    earningsDate: fmtDate(q.earningsTimestamp),
    targetPrice: q.targetMeanPrice ?? null,
    sector: q.sector ?? null,
    industry: q.industry ?? null,
    location: q.country ?? null,
    roe: q.returnOnEquity != null ? q.returnOnEquity * 100 : null,
    debtToEquity: q.debtToEquity != null ? q.debtToEquity / 100 : null,
  };
}

async function fetchFD(ticker, apiKey) {
  const BASE = "https://api.financialdatasets.ai";
  const h = { "X-API-KEY": apiKey };
  const [incR, balR] = await Promise.allSettled([
    fetchDirect(`${BASE}/financials/income-statements/?ticker=${ticker}&period=ttm&limit=1`, h),
    fetchDirect(`${BASE}/financials/balance-sheets/?ticker=${ticker}&period=ttm&limit=1`, h),
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
  const host = req.headers.host; // e.g. fin-track-six-sage.vercel.app

  try {
    const [yqR, fdR] = await Promise.allSettled([
      fetchYahooSummary(ticker, host),
      apiKey ? fetchFD(ticker, apiKey) : Promise.resolve(null),
    ]);

    const yq = yqR.status === "fulfilled" ? yqR.value : null;
    const fd = fdR.status === "fulfilled" ? fdR.value : null;

    const result = {
      marketCap: yq?.marketCap ?? null,
      pe: yq?.pe ?? null,
      eps: fd?.eps ?? yq?.eps ?? null,
      beta: yq?.beta ?? null,
      dividendRate: yq?.dividendRate ?? null,
      dividendYield: yq?.dividendYield ?? null,
      exDivDate: yq?.exDivDate ?? null,
      earningsDate: yq?.earningsDate ?? null,
      targetPrice: yq?.targetPrice ?? null,
      sector: yq?.sector ?? null,
      industry: yq?.industry ?? null,
      location: yq?.location ?? null,
      revenue: fd?.revenue ?? null,
      netIncome: fd?.netIncome ?? null,
      grossProfit: fd?.grossProfit ?? null,
      operatingIncome: fd?.operatingIncome ?? null,
      debtToEquity: fd?.debtToEquity ?? yq?.debtToEquity ?? null,
      roe: fd?.roe ?? yq?.roe ?? null,
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
