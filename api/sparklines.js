const https = require("https");

function fetchStooq(sym) {
  return new Promise((resolve) => {
    const end = new Date();
    const start = new Date(+end - 40 * 24 * 60 * 60 * 1000);
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const path = `/q/d/l/?s=${sym}&d1=${fmt(start)}&d2=${fmt(end)}&i=d`;
    const req = https.request({ hostname: "stooq.com", path, method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)", "Accept": "text/plain" },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const csv = Buffer.concat(chunks).toString("utf8");
        const lines = csv.trim().split("\n");
        if (lines.length < 2 || !lines[0].toLowerCase().includes("date")) return resolve(null);
        const rows = lines.slice(1).map(l => {
          const [date,,,,c] = l.split(",");
          const ts = new Date(date).getTime();
          return { c: parseFloat(c), ts };
        }).filter(x => x.c && !isNaN(x.c) && x.ts && !isNaN(x.ts));
        resolve(rows.length >= 2 ? rows : null);
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60");

  const tickers = (req.query?.tickers || "")
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => t && t !== "CASH" && /^[A-Z]{1,6}$/.test(t));

  if (!tickers.length) return res.status(400).json({ error: "No tickers" });

  const results = await Promise.allSettled(
    tickers.map(t => fetchStooq(t.toLowerCase() + ".us"))
  );

  const out = {};
  tickers.forEach((t, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      out[t] = {
        pts: r.value.map(x => x.c),
        timestamps: r.value.map(x => x.ts),
      };
    }
  });

  res.status(200).json(out);
};
