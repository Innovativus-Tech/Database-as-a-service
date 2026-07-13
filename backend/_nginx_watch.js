const tls = require("tls");
function probe() {
  return new Promise((resolve) => {
    let secured = false;
    const s = tls.connect({ host: "dbaas.innovativus.tech", port: 27017,
      servername: "m-812bc07560ea686c.mongo.dbaas.innovativus.tech",
      rejectUnauthorized: false, timeout: 6000 });
    s.on("secureConnect", () => { secured = true; s.destroy(); resolve(true); });
    s.on("close", () => resolve(secured));
    s.on("error", () => resolve(false));
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}
(async () => {
  for (let i = 0; i < 120; i++) {           // up to ~20 min
    if (await probe()) { console.log("NGINX BACK UP — TLS handshake completes on :27017. Routing restored."); process.exit(0); }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log("still down after 20 min");
})();
