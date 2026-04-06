const https = require("https");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const body = req.body;
  if (!body) return res.status(400).send("Missing body");

  const payload = JSON.stringify(body);

  try {
    const result = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 55000,
      }, (r) => {
        const chunks = [];
        r.on("data", c => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        r.on("error", reject);
      });
      req2.on("error", reject);
      req2.on("timeout", () => { req2.destroy(); reject(new Error("timeout")); });
      req2.write(payload);
      req2.end();
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(result.status).send(result.body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
