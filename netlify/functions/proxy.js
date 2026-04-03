const https = require("https");
const http = require("http");

exports.handler = async (event) => {
  const target = event.queryStringParameters?.url;
  if (!target) return { statusCode: 400, body: "Missing url param" };

  const hostMatch = target.match(/^https?:\/\/([^/?#]+)/);
  if (!hostMatch) return { statusCode: 400, body: "Invalid url" };
  const hostname = hostMatch[1];

  const allowed = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "stooq.com",
    "cdn.jsdelivr.net",
  ];
  if (!allowed.includes(hostname)) return { statusCode: 403, body: "Host not allowed" };

  // Netlify auto-decodes query params, so ^ arrives as literal ^.
  // Node's http module needs ^ percent-encoded in the request path.
  const rawPath = target.replace(/^https?:\/\/[^/?#]+/, "") || "/";
  const path = rawPath.replace(/\^/g, "%5E");

  const isYahoo = hostname.includes("yahoo.com");
  const headers = isYahoo ? {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  } : {
    "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)",
    "Accept": "text/plain, */*",
  };

  const lib = target.startsWith("https://") ? https : http;

  try {
    const body = await new Promise((resolve, reject) => {
      const req = lib.request({ hostname, path, method: "GET", headers, timeout: 12000 }, (res) => {
        // Follow one redirect
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          const loc = res.headers.location;
          const rh = loc.includes("yahoo.com") ? headers : { "User-Agent": headers["User-Agent"] };
          const req2 = https.request(loc, { method: "GET", headers: rh }, (res2) => {
            const chunks = [];
            res2.on("data", c => chunks.push(c));
            res2.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res2.on("error", reject);
          });
          req2.on("error", reject);
          req2.end();
          return;
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
      },
      body,
    };
  } catch (err) {
    return { statusCode: 502, body: "Upstream error: " + err.message };
  }
};
