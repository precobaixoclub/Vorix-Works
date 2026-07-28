import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { successEnvelope } from "../http/response-envelope.js";

let cachedPackageVersion: string | undefined;

async function readPackageVersion(): Promise<string> {
  if (cachedPackageVersion) return cachedPackageVersion;
  const here = dirname(fileURLToPath(import.meta.url));
  // Este arquivo compila para dist/interfaces/api/routes/version.route.js — 4 níveis acima é a raiz do projeto.
  const packageJsonPath = join(here, "..", "..", "..", "..", "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  cachedPackageVersion = (JSON.parse(raw) as { version: string }).version;
  return cachedPackageVersion;
}

/**
 * `GET /version` — sem prefixo `/v1` de propósito (é um endpoint de infraestrutura, não de
 * negócio, mesmo espírito do `GET /health` cru registrado em `app.ts`). Devolve a versão do
 * `package.json` (versão do próprio Zuno) separada da versão da API HTTP (`apiVersion`, hoje
 * sempre `"v1"`, mesmo vocabulário de `health.route.ts`) — são dois conceitos diferentes que só
 * coincidem por acaso hoje.
 */
export async function registerVersionRoute(app: FastifyInstance): Promise<void> {
  app.get("/version", async (request, _reply) => {
    const packageVersion = await readPackageVersion();
    return successEnvelope({ apiVersion: "v1" as const, packageVersion }, request.id);
  });
}
