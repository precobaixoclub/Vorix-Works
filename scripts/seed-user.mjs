import { registerUser } from "../dist/application/identity/index.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { buildIdentityRepositories } from "../dist/infrastructure/storage/build-identity-repositories.js";

/**
 * Bootstrap local — Sprint 05. Não existe endpoint HTTP público de registro nesta sprint (ver
 * `register-user.usecase.ts`), então esta é a forma de criar o primeiro usuário/tenant membership
 * para testar o login de verdade.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/seed-user.mjs <email> <senha> <nome> <tenantId> [role]
 *
 * `role` é opcional (padrão "owner") — um dos: owner, admin, editor, viewer.
 */
async function main() {
  const [email, password, name, tenantId, role = "owner"] = process.argv.slice(2);

  if (!email || !password || !name || !tenantId) {
    console.error("Uso: node scripts/seed-user.mjs <email> <senha> <nome> <tenantId> [role=owner]");
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[seed-user] DATABASE_URL não definido.");
    process.exitCode = 1;
    return;
  }

  const { userRepository, membershipRepository, pool } = buildIdentityRepositories({ databaseUrl });

  try {
    const { user, membership } = await registerUser(
      {
        userRepository,
        membershipRepository,
        // Não usados por registerUser, mas exigidos pela assinatura de IdentityUseCaseDeps.
        sessionRepository: undefined,
        refreshTokenRepository: undefined,
        auditLog: { record: async () => {} },
        passwordHasher: new BcryptPasswordHasher(),
        jwt: undefined,
        accessTokenTtlSeconds: 0,
        refreshTokenTtlSeconds: 0,
      },
      { email, password, name, tenantId, role },
    );

    console.log(`[seed-user] Usuário criado: ${user.email} (id=${user.id})`);
    console.log(`[seed-user] Membership: tenant=${membership.tenantId} role=${membership.role}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[seed-user] Falha ao criar usuário.", error);
  process.exitCode = 1;
});
