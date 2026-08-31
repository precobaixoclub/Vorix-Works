import pg from "pg";
import { assertNotProduction, INBOX_RESTORE_TABLE_ORDER, runRestoreDrill } from "./lib/restore-drill.mjs";

/**
 * CLI de verificação de restore — Fase 6. Uso real (produção/staging), depois de já ter restaurado
 * um `.sql.gz` do `backup-postgres.sh` num banco Postgres DESCARTÁVEL (nunca produção):
 *
 *   RESTORE_DRILL_SOURCE_URL=postgres://.../zuno_restaurado \
 *   RESTORE_DRILL_TARGET_URL=postgres://.../zuno_verificacao \
 *   node scripts/restore-drill.mjs
 *
 * `TARGET` precisa já ter o schema aplicado (`npm run db:migrate` contra ele) antes de rodar —
 * este script só copia/verifica DADOS, nunca aplica migration. Nunca aponta para produção em
 * nenhum dos dois lados (`assertNotProduction`) — se `RESTORE_DRILL_SOURCE_URL`/
 * `RESTORE_DRILL_TARGET_URL` não forem informados, o script simplesmente explica o uso e sai sem
 * fazer nada (o teste automatizado, `tests/backup-restore-drill.test.mjs`, é quem exercita a
 * lógica de verdade contra bancos descartáveis via pglite — nunca precisa de Postgres real).
 */

const sourceUrl = process.env.RESTORE_DRILL_SOURCE_URL?.trim();
const targetUrl = process.env.RESTORE_DRILL_TARGET_URL?.trim();

if (!sourceUrl || !targetUrl) {
  console.log(
    [
      "[restore-drill] Uso: defina RESTORE_DRILL_SOURCE_URL e RESTORE_DRILL_TARGET_URL (ambos Postgres reais, nunca produção) e rode de novo.",
      "  Fluxo recomendado: restaure o .sql.gz mais recente do backup-postgres.sh num banco descartável (RESTORE_DRILL_SOURCE_URL),",
      "  aplique as migrations num segundo banco descartável vazio (RESTORE_DRILL_TARGET_URL), e rode este script para confirmar",
      "  que os dados sobrevivem ao dump+restore intactos, tabela por tabela.",
      "  O teste automatizado (tests/backup-restore-drill.test.mjs) já cobre esta lógica via pglite, sem precisar de Postgres real.",
    ].join("\n"),
  );
  process.exit(0);
}

assertNotProduction(sourceUrl, "RESTORE_DRILL_SOURCE_URL");
assertNotProduction(targetUrl, "RESTORE_DRILL_TARGET_URL");

const sourcePool = new pg.Pool({ connectionString: sourceUrl });
const targetPool = new pg.Pool({ connectionString: targetUrl });

try {
  const { ok, results } = await runRestoreDrill({ sourcePool, targetPool, tables: INBOX_RESTORE_TABLE_ORDER });
  for (const result of results) {
    console.log(`[restore-drill] ${result.ok ? "OK" : "FALHOU"} ${result.table}: origem=${result.sourceCount} restaurado=${result.restoredCount}`);
  }
  console.log(ok ? "[restore-drill] Restore validado — todos os dados sobreviveram intactos." : "[restore-drill] FALHA — dados divergem entre origem e restauração.");
  process.exitCode = ok ? 0 : 1;
} finally {
  await sourcePool.end();
  await targetPool.end();
}
