import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pass arguments directly to Node so Windows cmd.exe's 8 KiB command limit cannot truncate CI.
const listed = JSON.parse(readFileSync(new URL("./backend-test-files.json", import.meta.url), "utf8"));
// Include new suites automatically: a manually maintained registry had silently omitted 22 files.
const discovered = readdirSync(new URL("../tests/", import.meta.url)).filter(name => name.endsWith(".test.mjs")).sort().map(name => `tests/${name}`);
const files = [...new Set([...listed, ...discovered])];
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...process.argv.slice(2), ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
