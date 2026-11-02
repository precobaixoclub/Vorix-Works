import type {SubscriptionRepositoryPort,SubscriptionItemRepositoryPort,SubscriptionPendingChangeRepositoryPort} from "./subscription-repository.port.js";
import type {BillingEventRepositoryPort} from "./billing-ops-repository.port.js";
import type {WorkspaceRepositoryPort} from "./workspace-repository.port.js";
import type {EntitlementUseCaseDeps} from "../billing/entitlement-use-cases.js";
export type CapacityMutationRepositories={beginCapacityWrite:()=>Promise<void>;subscriptionRepository:SubscriptionRepositoryPort;subscriptionItemRepository:SubscriptionItemRepositoryPort;subscriptionPendingChangeRepository:SubscriptionPendingChangeRepositoryPort;billingEventRepository:BillingEventRepositoryPort;workspaceRepository?:WorkspaceRepositoryPort;entitlementCatalog?:Pick<EntitlementUseCaseDeps,"planVersionRepository"|"addonDefinitionRepository"|"platformBillingRepository">};
/** Serializa salvamentos por tenant e confirma todas as escritas locais em uma transação. */
export type CapacityMutationRepositoryPort={run<T>(tenantId:string,work:(repositories:CapacityMutationRepositories)=>Promise<T>):Promise<T>};
