const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const dest = path.join(root, "desktop/staged");
const standalone = path.join(root, "frontend/.next/standalone");
const api = path.join(root, "desktop/build-api/studio-api");
if (!fs.existsSync(path.join(standalone, "server.js")))
  throw new Error("Esegui prima la build standalone frontend");
if (
  !fs.existsSync(
    path.join(
      api,
      process.platform === "win32" ? "studio-api.exe" : "studio-api",
    ),
  )
)
  throw new Error("Compila prima il backend sul sistema di destinazione");
// Dereference Next's junctions/symlinks: the staged payload must be relocatable.
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(standalone, path.join(dest, "web"), {
  recursive: true,
  dereference: true,
});
fs.cpSync(
  path.join(root, "frontend/.next/static"),
  path.join(dest, "web/.next/static"),
  { recursive: true },
);
if (fs.existsSync(path.join(root, "frontend/public")))
  fs.cpSync(path.join(root, "frontend/public"), path.join(dest, "web/public"), {
    recursive: true,
  });
fs.cpSync(api, path.join(dest, "api"), { recursive: true, dereference: true });
console.log("Payload desktop pronto: " + dest);
