const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function inside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
async function filesIn(root, relative = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Il backup non accetta collegamenti simbolici nei dati.");
    if (entry.isDirectory()) files.push(...(await filesIn(root, name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error("Tipo di file non supportato nel backup.");
  }
  return files;
}
async function backupData(dataDir, parent) {
  dataDir = await fs.realpath(dataDir);
  parent = await fs.realpath(parent);
  if (inside(dataDir, parent))
    throw new Error("Scegli una cartella esterna ai dati dell’applicazione.");
  const folder = path.join(
    parent,
    "Albertelli-backup-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomUUID().slice(0, 8),
  );
  const staging = folder + ".partial";
  await fs.mkdir(staging, { recursive: false });
  try {
    const manifest = {
      version: 1,
      created: new Date().toISOString(),
      files: [],
    };
    for (const name of await filesIn(dataDir)) {
      const destination = path.join(staging, name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(dataDir, name), destination);
      await fs.chmod(destination, 0o600);
      const hash = crypto.createHash("sha256");
      for await (const chunk of createReadStream(destination))
        hash.update(chunk);
      manifest.files.push({
        path: name.split(path.sep).join("/"),
        bytes: (await fs.stat(destination)).size,
        sha256: hash.digest("hex"),
      });
    }
    if (!manifest.files.some((f) => f.path === "studio.db"))
      throw new Error("Database non trovato: backup annullato.");
    await fs.writeFile(
      path.join(staging, "backup-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await fs.rename(staging, folder);
    return folder;
  } catch (e) {
    await fs.rm(staging, { recursive: true, force: true });
    throw e;
  }
}
module.exports = { backupData, filesIn, inside };
