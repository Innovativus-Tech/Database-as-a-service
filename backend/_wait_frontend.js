const https = require("https");
function probe() {
  return new Promise((res) => {
    const req = https.get("https://dbaas.innovativus.tech/api/healthz", { timeout: 8000 }, (r) => {
      r.resume(); res(r.statusCode);
    });
    req.on("timeout", () => { req.destroy(); res(0); });
    req.on("error", () => res(0));
  });
}
(async () => {
  for (let i = 0; i < 90; i++) {   // up to ~15 min
    const c = await probe();
    if (c === 200) { console.log("FRONTEND RECOVERED — dbaas.innovativus.tech returns 200. Dashboard is back."); process.exit(0); }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log("still down after 15 min — proxy restart likely still needed");
})();
