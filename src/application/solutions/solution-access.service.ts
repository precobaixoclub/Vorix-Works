import {
  assertGrantSourceAllowed,
  resolveSolutionAccess,
  SOLUTION_KEYS,
  SOLUTIONS,
  type SolutionAccess,
  type SolutionEntitlement,
  type SolutionEntitlementSource,
  type SolutionKey,
} from "../../domain/solutions/solution.model.js";
import type { SolutionEntitlementRepositoryPort } from "../ports/solution-entitlement-repository.port.js";

export type SolutionAccessServiceDeps = {
  includedCapabilities?: (tenantId:string)=>Promise<Partial<Record<"site"|"commerce",boolean>>>;
  repository: SolutionEntitlementRepositoryPort;
  /** Kill switches de ambiente — soluções desligadas para TODOS, inclusive acesso interno. */
  killSwitches?: ReadonlySet<SolutionKey>;
  /** TTL do cache por tenant. O guarda da API roda em toda requisição de Marketing; sem cache
   * seria uma query por requisição. `0` desliga (testes). */
  cacheTtlMs?: number;
  now?: () => number;
};

const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Serviço do Core que responde "este tenant tem acesso a esta solução?". Único lugar que junta
 * kill switch + entitlement; RBAC e feature flags continuam sendo checados onde sempre foram.
 */
export class SolutionAccessService {
  private readonly capabilitiesCache=new Map<string,{at:number;value:Partial<Record<"site"|"commerce",boolean>>}>();
  private readonly cache = new Map<string, { at: number; entitlements: SolutionEntitlement[] }>();

  constructor(private readonly deps: SolutionAccessServiceDeps) {}

  private async entitlementsOf(tenantId: string): Promise<SolutionEntitlement[]> {
    const ttl = this.deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const now = this.deps.now ? this.deps.now() : Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && ttl > 0 && now - cached.at < ttl) return cached.entitlements;
    const entitlements = await this.deps.repository.listByTenant(tenantId);
    if (ttl > 0) this.cache.set(tenantId, { at: now, entitlements });
    return entitlements;
  }

  /** Todas as soluções conhecidas, com o acesso efetivo deste tenant. */
  async listAccess(tenantId: string): Promise<SolutionAccess[]> {
    const entitlements = await this.entitlementsOf(tenantId);
    const now=this.deps.now?.()??Date.now(),cached=this.capabilitiesCache.get(tenantId),ttl=this.deps.cacheTtlMs??DEFAULT_CACHE_TTL_MS;
    const included=cached&&now-cached.at<ttl?cached.value:await this.deps.includedCapabilities?.(tenantId)??{};
    if(ttl>0)this.capabilitiesCache.set(tenantId,{at:now,value:included});
    return SOLUTION_KEYS.map((key) =>
      resolveSolutionAccess({
        solution: SOLUTIONS[key],
        entitlement: entitlements.find((entry) => entry.solutionKey === key) ?? ((key==="site"||key==="commerce")&&included[key]?{enabled:true,source:"subscription"}:undefined),
        killSwitchOn: this.deps.killSwitches?.has(key) ?? false,
      }),
    );
  }

  /** Linha explícita do tenant para a solução (com os limites comerciais), se existir. */
  async getEntitlement(tenantId: string, solutionKey: SolutionKey): Promise<SolutionEntitlement | undefined> {
    return (await this.entitlementsOf(tenantId)).find((entry) => entry.solutionKey === solutionKey);
  }

  async hasAccess(tenantId: string, solutionKey: SolutionKey): Promise<boolean> {
    return (await this.listAccess(tenantId)).some((access) => access.key === solutionKey && access.enabled);
  }

  /**
   * Concede/revoga uma solução para um tenant (ação de administrador da plataforma). Uma solução
   * que não é comercialmente pública só aceita `source: "internal"`.
   */
  async setEntitlement(input: { tenantId: string; solutionKey: SolutionKey; enabled: boolean; source: SolutionEntitlementSource; limits?: Record<string, number>; reason?: string; actorUserId?: string }): Promise<SolutionEntitlement> {
    assertGrantSourceAllowed(SOLUTIONS[input.solutionKey], input.source);
    const saved = await this.deps.repository.set(input);
    this.cache.delete(input.tenantId);
    this.capabilitiesCache.delete(input.tenantId);
    return saved;
  }
}
