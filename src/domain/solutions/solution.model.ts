/**
 * Vorix como PLATAFORMA de soluções independentes sobre um Core compartilhado.
 *
 *   VORIX CORE (auth, tenant, workspace, usuários, RBAC, cobrança, créditos, auditoria)
 *      ├── conversations  — Vorix Conversas (atendimento, CRM comercial, propostas, automações)
 *      ├── marketing      — Vorix Marketing (Creative Engine, produção, publicação, anúncios)
 *      └── futuras soluções (entram aqui, sem nova reorganização)
 *
 * Uma solução NÃO é um workspace nem uma conta: a mesma empresa/workspace pode ter várias.
 *
 * Cinco conceitos que nunca se misturam num único booleano:
 *   1. DISPONIBILIDADE COMERCIAL — a solução é vendida publicamente? (`commercialAvailability`,
 *      definida aqui, no código: é decisão de produto, não de cliente).
 *   2. ENTITLEMENT — este tenant tem direito à solução? (`solution_entitlements`, por tenant).
 *   3. RBAC — este usuário pode fazer esta ação? (`identity.model.ts`, inalterado).
 *   4. FEATURE FLAG — este recurso específico está ligado? (flags existentes, ex.: Creative
 *      Engine; inalteradas).
 *   5. KILL SWITCH — desliga a solução inteira no ambiente (`SOLUTION_KILL_SWITCHES`,
 *      `CONVERSATIONS_MODULE_ENABLED`).
 *
 * Acesso efetivo = kill switch desligado E entitlement habilitado. RBAC e feature flags
 * continuam valendo por cima, cada um no seu lugar.
 */

export const SOLUTION_KEYS = ["conversations", "marketing"] as const;
export type SolutionKey = (typeof SOLUTION_KEYS)[number];

/**
 * `public`   — vendida no site, contratável, entra no onboarding.
 * `internal` — existe tecnicamente, mas fora da oferta: sem site, sem preço, sem contratação.
 *              Só é acessível por concessão interna explícita (desenvolvimento/homologação).
 */
export type SolutionCommercialAvailability = "public" | "internal";

export type SolutionDefinition = {
  key: SolutionKey;
  name: string;
  commercialAvailability: SolutionCommercialAvailability;
  /** Entitlement de um tenant SEM linha explícita em `solution_entitlements`. Soluções públicas
   * já em uso nascem habilitadas (nenhum cliente perde acesso por falta de linha); soluções
   * internas nascem desabilitadas (fail-closed). */
  defaultEntitlement: boolean;
};

export const SOLUTIONS: Readonly<Record<SolutionKey, SolutionDefinition>> = Object.freeze({
  conversations: { key: "conversations", name: "Vorix Conversas", commercialAvailability: "public", defaultEntitlement: true },
  marketing: { key: "marketing", name: "Vorix Marketing", commercialAvailability: "internal", defaultEntitlement: false },
});

export function isSolutionKey(value: unknown): value is SolutionKey {
  return typeof value === "string" && (SOLUTION_KEYS as readonly string[]).includes(value);
}

/** Soluções que podem aparecer no site, em preços e em contratação. */
export function listPublicSolutions(): SolutionDefinition[] {
  return SOLUTION_KEYS.map((key) => SOLUTIONS[key]).filter((solution) => solution.commercialAvailability === "public");
}

/** Origem de uma concessão. `internal` = desenvolvimento/homologação/testes — nunca é uma venda,
 * e é o único tipo aceito para uma solução que não é comercialmente pública. */
export const SOLUTION_ENTITLEMENT_SOURCES = ["subscription", "internal", "manual"] as const;
export type SolutionEntitlementSource = (typeof SOLUTION_ENTITLEMENT_SOURCES)[number];

export type SolutionEntitlement = {
  tenantId: string;
  solutionKey: SolutionKey;
  enabled: boolean;
  source: SolutionEntitlementSource;
  reason?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type SolutionAccess = {
  key: SolutionKey;
  name: string;
  enabled: boolean;
  /** `true` quando o acesso vem de concessão interna a uma solução ainda não comercial. */
  internal: boolean;
};

/**
 * Regra única de acesso. `entitlement` é a linha explícita do tenant (ou `undefined`).
 * Kill switch vence tudo; depois a linha explícita; por fim o default da solução.
 */
export function resolveSolutionAccess(input: { solution: SolutionDefinition; entitlement?: Pick<SolutionEntitlement, "enabled" | "source">; killSwitchOn: boolean }): SolutionAccess {
  const { solution, entitlement, killSwitchOn } = input;
  const entitled = entitlement ? entitlement.enabled : solution.defaultEntitlement;
  return {
    key: solution.key,
    name: solution.name,
    enabled: !killSwitchOn && entitled,
    internal: solution.commercialAvailability === "internal",
  };
}

/** Uma solução que não é pública só aceita concessão `internal` — é o que impede o mecanismo de
 * acesso interno de virar disponibilidade comercial por engano. */
export function assertGrantSourceAllowed(solution: SolutionDefinition, source: SolutionEntitlementSource): void {
  if (solution.commercialAvailability === "internal" && source !== "internal") {
    throw new Error(`SOLUTION_NOT_CONTRACTABLE: "${solution.name}" não está disponível comercialmente — só aceita concessão interna.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Classificação das rotas da API por solução
// ---------------------------------------------------------------------------------------------

/**
 * Prefixos de rota (`/v1/<prefixo>`) que pertencem ao Vorix Marketing. Tudo que não está aqui é
 * Core ou Conversas e não é barrado por este guarda (Conversas é a solução pública padrão; seu
 * próprio kill switch é `CONVERSATIONS_MODULE_ENABLED`).
 *
 * Fora desta lista DE PROPÓSITO, por serem integração COMPARTILHADA: `publication-providers/meta*`
 * e `instagram` (exceto `instagram/posts`) — o login Meta também é o que conecta o canal
 * Instagram Direct do Conversas.
 */
export const MARKETING_ROUTE_PREFIXES: readonly string[] = [
  "assets",
  "brand-identity",
  "brand-profile",
  "briefings",
  // Chat do assistente de criação (Arthur) — NÃO é o inbox de atendimento (`/v1/inbox`).
  "conversations",
  "planning",
  "runtime",
  "execution-runs",
  "execution",
  "production",
  "production-settings",
  "publications",
  "publication-media",
  "publication-sync",
  "publication-providers/tiktok",
  "publication-providers/youtube",
  "publication-providers/kwai",
  "schedules",
  "scheduling",
  "schedule-occurrences",
  "calendar",
  "analytics",
  "instagram/posts",
  "tiktok",
  "kwai",
  "youtube",
  "meta-ads",
  "providers",
  "credentials",
  "compliance",
];

/**
 * Solução dona de um caminho `/v1/...`. `undefined` = Core/Conversas (não barrado aqui).
 * Casa por segmento inteiro: `/v1/assets` e `/v1/assets/upload` são Marketing, `/v1/assetsx` não.
 */
export function solutionForApiPath(path: string): SolutionKey | undefined {
  const clean = path.split("?")[0].replace(/^\/+/, "");
  const withoutVersion = clean.startsWith("v1/") ? clean.slice(3) : clean === "v1" ? "" : clean;
  for (const prefix of MARKETING_ROUTE_PREFIXES) {
    if (withoutVersion === prefix || withoutVersion.startsWith(`${prefix}/`)) return "marketing";
  }
  return undefined;
}
