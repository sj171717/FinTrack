const https = require("https");
const http = require("http");
const { URL } = require("url");

exports.handler = async (event) => {
  const target = event.queryStringParameters?.url;
  if (!target) {
    return { statusCode: 400, body: "Missing url param" };
  }

  // Validate host without re-encoding the URL
  const hostMatch = target.match(/^https?:\/\/([^/?#]+)/);
  if (!hostMatch) return { statusCode: 400, body: "Invalid url" };
  const hostname = hostMatch[1];

  const allowed = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "stooq.com",
    "cdn.jsdelivr.net",
  ];
  if (!allowed.includes(hostname)) {
    return { statusCode: 403, body: "Host not allowed" };
  }

  // Use the raw target URL so ^ and other chars are NOT double-encoded
  const rawPath = target.replace(/^https?:\/\/[^/?#]+/, "") || "/";

  const options = {
    hostname,
    path: rawPath,
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FinTrack/1.0)",
      "Accept": "application/json, text/plain, */*",
    },
    timeout: 10000,
  };

  const lib = target.startsWith("https://") ? https : http;

  try {
    const body = await new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
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
