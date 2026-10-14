import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Pass arguments directly to Node so Windows cmd.exe's 8 KiB command limit cannot truncate CI.
const files = JSON.parse(readFileSync(new URL("./backend-test-files.json", import.meta.url), "utf8"));
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...process.argv.slice(2), ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
