const path = require("node:path");
const dir = process.argv[2];
if (!dir) throw new Error("Directory web mancante");
if (process.env.STUDIO_PARENT_PIPE === "1") {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
}
process.chdir(dir);
require(path.join(dir, "server.js"));
