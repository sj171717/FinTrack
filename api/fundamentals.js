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
  const modules = "financialData,defaultKeyStatistics,summaryDetail,assetProfile,calendarEvents";
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`;
  const data = await fetchViaProxy(host, url);
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
    location: profile.country ?? null,
    roe: fin.returnOnEquity?.raw != null ? fin.returnOnEquity.raw * 100 : null,
    debtToEquity: fin.debtToEquity?.raw != null ? fin.debtToEquity.raw / 100 : null,
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
