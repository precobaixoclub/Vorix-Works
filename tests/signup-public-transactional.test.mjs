import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { signupPublicTransactional } from "../dist/infrastructure/storage/postgres/signup-public-transactional.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { JsonWebTokenJwtAdapter } from "../dist/infrastructure/auth/jsonwebtoken-jwt-adapter.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

function makeDeps() {
  return {
    passwordHasher: new BcryptPasswordHasher(),
    jwt: new JsonWebTokenJwtAdapter("test-secret"),
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    idGenerator: (prefix) => nextId(prefix),
    now: () => new Date("2026-08-01T10:00:00Z"),
  };
}

before(async () => {
  db = await startTestPostgres({ port: 55442 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

test("signupPublicTransactional: cria User + Membership + Workspace + tenant_billing FREE numa única transação", async () => {
  const result = await signupPublicTransactional(db.pool, makeDeps(), {
    email: "tx-novo@example.com",
    password: "senha-forte-1234",
    name: "Novo Usuário Tx",
    workspaceName: "Workspace Transacional",
  });

  assert.ok(result.accessToken, "access token retornado");
  assert.equal(result.user.email, "tx-novo@example.com");
  assert.equal(result.role, "admin");

  const userRow = await db.pool.query("select id from users where email = 'tx-novo@example.com'");
  assert.equal(userRow.rows.length, 1);

  const membership = await db.pool.query("select role from tenant_members where user_id = $1", [userRow.rows[0].id]);
  assert.equal(membership.rows.length, 1);

  const workspaces = await db.pool.query("select name from workspaces where tenant_id = $1", [result.tenantId]);
  assert.equal(workspaces.rows.length, 1);
  assert.equal(workspaces.rows[0].name, "Workspace Transacional");

  const billing = await db.pool.query("select plan_code from tenant_billing where tenant_id = $1", [result.tenantId]);
  assert.equal(billing.rows.length, 1);

  // Fase 5 (Onboarding) — todo tenant novo já abre o CRM com um pipeline de vendas pronto.
  const pipelines = await db.pool.query("select id, name, is_default from pipelines where tenant_id = $1", [result.tenantId]);
  assert.equal(pipelines.rows.length, 1);
  assert.equal(pipelines.rows[0].is_default, true);
  const stages = await db.pool.query("select name, is_won, is_lost from pipeline_stages where pipeline_id = $1 order by position asc", [pipelines.rows[0].id]);
  assert.equal(stages.rows.length, 6, "6 etapas padrão (Novo, Contato Feito, Proposta Enviada, Negociação, Ganho, Perdido)");
  assert.equal(stages.rows.at(-2).is_won, true);
  assert.equal(stages.rows.at(-1).is_lost, true);
});

test("signupPublicTransactional: falha depois de User/Membership/Workspace gravados desfaz TUDO (não deixa tenant órfão)", async () => {
  // Força o INSERT em tenant_billing (o último passo antes do login) a falhar, simulando uma
  // quebra no meio do fluxo — exatamente o cenário que motivou envolver `signupPublic` numa
  // transação real.
  await db.pool.query(
    "alter table tenant_billing add constraint test_force_billing_failure check (monthly_credits_quota < 0) not valid",
  );

  await assert.rejects(
    () =>
      signupPublicTransactional(db.pool, makeDeps(), {
        email: "tx-rollback@example.com",
        password: "senha-forte-1234",
        name: "Deveria Desaparecer",
        workspaceName: "Workspace Que Não Deveria Sobreviver",
      }),
    /monthly_credits_quota|check/i,
  );

  const userRow = await db.pool.query("select count(*)::int as c from users where email = 'tx-rollback@example.com'");
  assert.equal(userRow.rows[0].c, 0, "User não deveria ter sido persistido");

  const workspaceRow = await db.pool.query("select count(*)::int as c from workspaces where name = 'Workspace Que Não Deveria Sobreviver'");
  assert.equal(workspaceRow.rows[0].c, 0, "Workspace não deveria ter sido persistido");

  await db.pool.query("alter table tenant_billing drop constraint test_force_billing_failure");
});

test("signupPublicTransactional: sempre libera a conexão do pool (sucesso e falha)", async () => {
  const before = db.pool.totalCount - db.pool.idleCount;

  await signupPublicTransactional(db.pool, makeDeps(), {
    email: "tx-release-ok@example.com",
    password: "senha-forte-1234",
    name: "Libera Conexão",
  });

  await assert.rejects(() =>
    signupPublicTransactional(db.pool, makeDeps(), {
      email: "tx-release-ok@example.com",
      password: "outra-senha-1234",
      name: "Duplicado",
    }),
  );

  const after = db.pool.totalCount - db.pool.idleCount;
  assert.equal(after, before, "nenhuma conexão deveria ficar presa fora do pool");
});
