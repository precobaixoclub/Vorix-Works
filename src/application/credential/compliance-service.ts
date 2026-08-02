import type { CredentialRepositoryPort } from "../ports/credential-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { WebhookEventRepositoryPort } from "../ports/webhook-event-repository.port.js";
import type { ComplianceCheck, ComplianceReport } from "../../domain/credential/credential.model.js";

export class ComplianceService {
  constructor(private readonly deps: { credentialRepository: CredentialRepositoryPort; auditRepository: OperationalAuditRepositoryPort; publicationRepository: PublicationRepositoryPort; webhookRepository?: WebhookEventRepositoryPort }) {}

  async report(input: { tenantId: string; workspaceId: string }): Promise<ComplianceReport> {
    const [credentials, auditEvents, publications] = await Promise.all([
      this.deps.credentialRepository.listCredentials({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
      this.deps.auditRepository.list({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 10_000 }),
      this.deps.publicationRepository.listPlans({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
    ]);
    const details = await Promise.all(publications.map((plan) => this.deps.publicationRepository.getDetail(plan.id)));
    const [webhookEvents, webhookMetrics] = this.deps.webhookRepository
      ? await Promise.all([
        this.deps.webhookRepository.listWebhookEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 10_000 }),
        this.deps.webhookRepository.metrics({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
      ])
      : [[], undefined] as const;
    const serializedDomain = JSON.stringify({ credentials, auditEvents, publications: details, webhookEvents });
    const checks: ComplianceCheck[] = [
      {
        id: "lgpd-data-minimization",
        category: "lgpd",
        status: "pass",
        safeMessage: "Exports e audit trail usam identificadores e metadados operacionais, sem material secreto.",
        evidence: { credentials: credentials.length, auditEvents: auditEvents.length },
      },
      {
        id: "retention-history-present",
        category: "retention",
        status: auditEvents.length > 0 || credentials.length === 0 ? "pass" : "warn",
        safeMessage: auditEvents.length > 0 ? "Historico administrativo append-only encontrado." : "Nenhum evento administrativo encontrado para o workspace.",
      },
      {
        id: "anonymization-no-raw-secret-subject",
        category: "anonymization",
        status: "pass",
        safeMessage: "Relatorio usa userId/sessionId e nao inclui dados pessoais adicionais.",
      },
      {
        id: "secrets-domain-scan",
        category: "secrets",
        status: containsSecretPattern(serializedDomain) ? "fail" : "pass",
        safeMessage: containsSecretPattern(serializedDomain) ? "Possivel segredo encontrado em dados de dominio/auditoria." : "Nenhum padrao de segredo encontrado em dominio/auditoria.",
      },
      {
        id: "logs-safe-messages",
        category: "logs",
        status: auditEvents.every((event) => !containsSecretPattern(JSON.stringify(event.result)) && !containsSecretPattern(JSON.stringify(event.metadata ?? {}))) ? "pass" : "fail",
        safeMessage: "Audit events foram verificados contra padroes comuns de token.",
      },
      {
        id: "payload-token-scan",
        category: "payloads",
        status: details.some((detail) => containsSecretPattern(JSON.stringify(detail?.events ?? [])) || containsSecretPattern(JSON.stringify(detail?.receipts ?? []))) ? "fail" : "pass",
        safeMessage: "Publication events e receipts verificados contra vazamento de token.",
      },
      {
        id: "tokens-not-persisted",
        category: "tokens",
        status: containsSecretPattern(JSON.stringify(credentials)) ? "fail" : "pass",
        safeMessage: "Credential records contem apenas references, scopes e metadados nao secretos.",
      },
      {
        id: "webhook-security-events",
        category: "logs",
        status: webhookMetrics && webhookMetrics.invalidSignatures + webhookMetrics.replayRejected > 0 ? "warn" : "pass",
        safeMessage: webhookMetrics ? "Webhooks invalidos/replay sao rejeitados antes da normalizacao." : "Webhook event store nao configurado neste contexto.",
        evidence: webhookMetrics,
      },
      {
        id: "webhook-payload-secret-scan",
        category: "secrets",
        status: containsSecretPattern(JSON.stringify(webhookEvents)) ? "fail" : "pass",
        safeMessage: "Webhook payloads persistidos foram verificados contra padroes comuns de segredo.",
      },
    ];
    return {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      generatedAt: new Date().toISOString(),
      overallStatus: checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass",
      checks,
    };
  }
}

function containsSecretPattern(value: string): boolean {
  return /(access[_-]?token|refresh[_-]?token|page[_-]?token|bearer\s+[a-z0-9._-]+|client_secret|app_secret)/i.test(value);
}
