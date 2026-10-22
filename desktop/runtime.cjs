const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
async function waitFor(url, headers, children, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (children.some((p) => !p.pid || p.exitCode !== null || p.signalCode))
      throw new Error("Un componente si è arrestato. Consulta i log locali.");
    try {
      const r = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.status === "ok") return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    "Avvio non riuscito entro 60 secondi. Consulta i log locali.",
  );
}
async function secretAt(file) {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const secret = crypto.randomBytes(32).toString("hex");
    await fs.writeFile(file, secret, { flag: "wx", mode: 0o600 });
    return secret;
  }
}
class Runtime {
  constructor({
    resources,
    dataDir,
    logsDir,
    nodePath = process.execPath,
    electronNode = false,
    runner = path.join(__dirname, "web-runner.cjs"),
  }) {
    Object.assign(this, {
      resources,
      dataDir,
      logsDir,
      nodePath,
      electronNode,
      runner,
    });
    this.children = [];
    this.logs = [];
    this.stopping = false;
  }
  async start() {
    this.stopping = false;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
    const password = await secretAt(path.join(this.dataDir, "desktop-key"));
    if (!/^[a-f0-9]{64}$/.test(password))
      throw new Error(
        "Chiave locale non valida: conserva i dati e contatta il supporto.",
      );
    this.apiToken = crypto.randomBytes(32).toString("hex");
    this.uiToken = crypto.randomBytes(32).toString("hex");
    const apiPort = await freePort();
    let webPort = await freePort();
    while (webPort === apiPort) webPort = await freePort();
    this.apiUrl = `http://127.0.0.1:${apiPort}`;
    this.webUrl = `http://127.0.0.1:${webPort}`;
    // SQLite URI uses an absolute path; assets and DB never live inside the installer.
    const db = path.join(this.dataDir, "studio.db").replaceAll("\\", "/");
    const base = {
      ...process.env,
      STUDIO_PARENT_PIPE: "1",
      DESKTOP_API_TOKEN: this.apiToken,
      DEMO_PASSWORD: password,
      COOKIE_SECURE: "0",
      DATABASE_URL: "sqlite:///" + db,
      ASSET_DIR: path.join(this.dataDir, "assets"),
      NEXT_TELEMETRY_DISABLED: "1",
    };
    const api = path.join(
      this.resources,
      "api",
      process.platform === "win32" ? "studio-api.exe" : "studio-api",
    );
    const launch = async (command, args, env, name) => {
      const log = await fs.open(
        path.join(this.logsDir, name + ".log"),
        "a",
        0o600,
      );
      this.logs.push(log);
      const child = spawn(command, args, {
        cwd: this.dataDir,
        env,
        windowsHide: true,
        stdio: ["pipe", log.fd, log.fd],
      });
      child.on("error", (e) => {
        this.lastError = e;
      });
      child.stdin.on("error", () => {});
      this.children.push(child);
      return child;
    };
    try {
      await launch(
        api,
        [],
        { ...base, STUDIO_API_PORT: String(apiPort) },
        "api",
      );
      await waitFor(
        this.apiUrl + "/api/health",
        { "x-studio-desktop-token": this.apiToken },
        this.children,
      );
      await launch(
        this.nodePath,
        [this.runner, path.join(this.resources, "web")],
        {
          ...base,
          ...(this.electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          DESKTOP_UI_TOKEN: this.uiToken,
          API_URL: this.apiUrl,
          PORT: String(webPort),
          HOSTNAME: "127.0.0.1",
          NODE_ENV: "production",
        },
        "web",
      );
      await waitFor(
        this.webUrl + "/api/health",
        { "x-studio-desktop-ui": this.uiToken },
        this.children,
      );
      return this.webUrl;
    } catch (e) {
      await this.stop();
      throw e;
    }
  }
  async stop() {
    this.stopping = true;
    const children = this.children.splice(0);
    await Promise.all(
      children.map(
        (p) =>
          new Promise((resolve) => {
            if (!p.pid || p.exitCode !== null || p.signalCode) return resolve();
            let timer;
            p.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            p.stdin.end();
            timer = setTimeout(() => {
              p.kill();
              resolve();
            }, 3000);
            timer.unref();
          }),
      ),
    );
    await Promise.all(this.logs.splice(0).map((log) => log.close()));
  }
}
module.exports = { Runtime, freePort, secretAt };
