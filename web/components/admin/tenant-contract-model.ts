import type { CapacityState } from "@/features/billing/types";

/** Tipos e rótulos compartilhados pela gestão de contrato da conta (admin da plataforma). */
export const features = { crm: "CRM e oportunidades", proposals: "Propostas comerciais", automation: "Automações comerciais", ai_auto_reply: "Respostas automáticas com IA", advanced_analytics: "Relatórios avançados" } as const;
export const resources = { users: "Usuários", workspaces: "Espaços ativos", messaging_connections: "Conexões de mensagens", contacts: "Contatos", ai_credits: "Créditos de IA por mês", automations: "Automações" } as const;
export type Feature = keyof typeof features;
export type Resource = keyof typeof resources;
export type AccessMode = "inherit" | "enabled" | "blocked";
export type Controls = { tenantId: string; displayName?: string; accessMode: AccessMode; capabilities: Partial<Record<Feature, boolean>>; limits: Partial<Record<Resource, number | null>>; version: number };
export type Entitlements = { planCode: string; planVersionId: string; virtual: boolean; readOnly: boolean; capabilities: Record<Feature, boolean>; limits: Record<Resource, number | null> };
export type Contract = {
  controls: Controls; contract: Entitlements; effective: Entitlements; usage: Record<Resource, number>; planName: string; capacity: CapacityState;
  subscription: { status: string; interval: string; provider: string; currentPeriodEnd?: string; trialEnd?: string; cancelAtPeriodEnd: boolean; linkedToProvider: boolean } | null;
  addons: { code: string; name: string; resource?: string; quantity: number; unitPrice: number }[];
  plans: { code: string; name: string; monthlyPrice: number; yearlyPrice: number; currency: string }[];
  history: { id: string; actorUserId?: string; reason: string; occurredAt: string; before: Controls; after: Controls }[];
};
export type TenantSolution = {
  key: string; name: string; enabled: boolean; internal: boolean; commercialAvailability: "public" | "internal";
  entitlement?: { enabled: boolean; source: string; reason?: string; updatedAt: string; limits?: Record<string, number> };
};

export const selectClass = "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground";
export const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
export const quota = (value: number | null | undefined) => value === null ? "Ilimitado" : (value ?? 0).toLocaleString("pt-BR");
export const date = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
export const accessLabels: Record<AccessMode, string> = { inherit: "Seguir situação da assinatura", enabled: "Liberar acesso manualmente", blocked: "Bloquear acesso à conta" };

export function describeChange(before: Controls, after: Controls) {
  const lines: string[] = [];
  if ((before.displayName ?? "") !== (after.displayName ?? "")) lines.push(`Nome: ${before.displayName || "sem nome"} → ${after.displayName || "sem nome"}`);
  if (before.accessMode !== after.accessMode) lines.push(`Acesso: ${accessLabels[before.accessMode]} → ${accessLabels[after.accessMode]}`);
  const featureValue = (value?: boolean) => value === undefined ? "seguir contrato" : value ? "liberado" : "bloqueado";
  for (const [key, label] of Object.entries(features) as [Feature, string][]) if (before.capabilities[key] !== after.capabilities[key]) lines.push(`${label}: ${featureValue(before.capabilities[key])} → ${featureValue(after.capabilities[key])}`);
  for (const [key, label] of Object.entries(resources) as [Resource, string][]) if (before.limits[key] !== after.limits[key]) lines.push(`${label}: ${before.limits[key] === undefined ? "seguir contrato" : quota(before.limits[key])} → ${after.limits[key] === undefined ? "seguir contrato" : quota(after.limits[key])}`);
  return lines;
}
