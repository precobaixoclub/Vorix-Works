import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
const files = (await fs.readdir("db/migrations")).filter((f) => f.endsWith(".sql")).sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let resets = 0;
for (const f of files) {
  const id = f.replace(/\.sql$/, "");
  const content = await fs.readFile(path.join("db/migrations", f), "utf8");
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  const r = await pool.query(
    "UPDATE schema_migrations SET checksum=$1 WHERE id=$2 AND checksum<>$1",
    [checksum, id],
  );
  if (r.rowCount > 0) {
    console.log("reset " + id);
    resets++;
  }
}
console.log("total resets: " + resets);
await pool.end();
