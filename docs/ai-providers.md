# Provedores de IA e créditos Vorix

Arquitetura de integração com múltiplos provedores de IA (texto, imagem, vídeo) + sistema de
créditos próprio, substituindo a cota antiga baseada em tokens Anthropic.

> **Aviso sobre o Google Veo**: diferente do adapter OpenAI (API estável e bem documentada), o
> adapter Google Gemini/Veo (`google-veo-provider-adapter.ts`) **não foi verificado contra um app
> registrado de verdade** — mesma ressalva de `docs/kwai-publishing.md`. A forma usada
> (`predictLongRunning` + polling de `operations/{name}`) segue a documentação pública da Gemini
> API, mas geração de vídeo é assíncrona e a API muda com frequência. Confirme os nomes de campo
> exatos contra o Google AI Studio/Vertex antes de habilitar em produção.

## Visão geral

- **Anthropic (texto)** — continua exatamente como antes (chat/extração de briefing), configurado
  em `/admin/settings`. Aparece só como card informativo em `/admin/ai-providers`.
- **OpenAI (imagem)** — `gpt-image-1`, adapter estável e verificado contra a documentação oficial.
- **Google Gemini/Veo (vídeo)** — `veo-3`, ver aviso acima.

Cada provedor é um adapter independente (`AiMediaProviderAdapterPort`) resolvido por um registro
(`AiMediaProviderRegistry`) — igual ao padrão já usado para TikTok/Instagram/Facebook/Kwai
(`PublicationProviderAdapterPort`/`PublicationProviderRegistry`). Adicionar um provedor novo =
escrever um adapter novo + registrar no `container.ts` — zero mudança na regra de negócio.

## Créditos Vorix

O cliente nunca vê o custo real em USD — só compra/consome **créditos**, uma unidade abstrata e
fixa por operação (`ai_operation_types.credits_cost`, 100% editável em `/admin/ai-providers`):

| Operação | Créditos (padrão) | Provedor padrão |
|---|---|---|
| `briefing_field_extraction` | 1 | Anthropic |
| `image_generation` | 2 | OpenAI |
| `video_generation` | 20 | Google (Veo) |

`TenantBilling.monthlyCreditsQuota` (cota do plano) + `creditsExtra` (avulso comprado) formam o
saldo disponível — checado por `CreditAccountingService` antes de qualquer chamada de IA, texto
ou mídia. Nunca cobra em caso de falha do provider.

## Auditoria financeira

Toda geração (sucesso ou falha) grava uma linha em `ai_generation_ledger`: tenant, operação,
provedor/modelo usado, créditos consumidos, custo real (`providerCostUsd`) e receita estimada
(`estimatedRevenueUsd = creditsConsumed * creditUnitValueUsd`). `creditUnitValueUsd` é um parâmetro
de referência admin-configurável (`platform_ai_settings.credit_unit_value_usd`, padrão `0.05`) —
usado só para estimar receita/lucro no painel, **não é o preço real cobrado** (ainda não existe
gateway de pagamento).

O painel `/admin/ai-providers` mostra gasto/receita/lucro por provedor no mês corrente
(`GET /v1/admin/ai-finance`).

## Variáveis de ambiente

```bash
# OpenAI (imagem)
OPENAI_IMAGE_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-1   # opcional, é o padrão

# Google Gemini/Veo (vídeo) — ver aviso acima antes de habilitar em produção
GOOGLE_VEO_ENABLED=true
GOOGLE_AI_API_KEY=...
GOOGLE_VEO_MODEL=veo-3           # opcional, é o padrão
```

A chave estática (env) só serve de bootstrap — o painel admin (`/admin/ai-providers`) grava a
chave criptografada (AES-256-GCM) no cofre genérico (`operational_secrets`, `PostgresSecretManager`)
e passa a ter prioridade em runtime, sem restart.

**Dois portões, não um**: `OPENAI_IMAGE_ENABLED`/`GOOGLE_VEO_ENABLED` são a capacidade da instalação
(o adapter existe e está registrado nesse deploy); o toggle "Habilitado" do painel
(`ai_providers.status`) é o controle operacional do admin, checado a cada chamada por
`MediaGenerationService` — igual ao que `SettingsGatedAiGateway` já faz para o texto. **Os dois
precisam estar ligados** para uma geração real acontecer; a env var sozinha não é suficiente.

**OpenAI (`gpt-image-1`) exige Object Storage habilitado**: o modelo só devolve `b64_json`, nunca
uma URL — o adapter precisa subir a imagem em algum lugar público para devolver `mediaUrl`. Sem
`OBJECT_STORAGE_ENABLED=true` (ver `docs/tiktok-publishing.md`/media upload), toda geração de
imagem falha com uma mensagem clara (`OBJECT_STORAGE_NOT_CONFIGURED`), não um erro genérico de
"falha de conexão com a OpenAI".

## Endpoints admin (`requirePlatformAdmin`)

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/v1/admin/ai-providers` | Lista provedores + modelos + health check |
| `PUT` | `/v1/admin/ai-providers/:code/status` | Liga/desliga um provedor |
| `PUT` | `/v1/admin/ai-providers/:code/api-key` | Grava/remove a API key (`apiKey: ""` remove) |
| `GET` | `/v1/admin/ai-operation-types` | Lista operações e custo em crédito |
| `PUT` | `/v1/admin/ai-operation-types/:code` | Edita `creditsCost`/`active` |
| `GET` | `/v1/admin/ai-finance?periodStart&periodEnd` | Gasto/receita/lucro por provedor |

## Migração de dados

A migração `0054_ai_provider_registry.sql` renomeia `tenant_billing.monthly_token_quota` →
`monthly_credits_quota` e `credits_extra_tokens` → `credits_extra`, recalibrando a cota mensal de
cada plano para os novos valores em crédito (FREE=50, START=500, PRO=2.500, BUSINESS=10.000). Se já
existirem tenants reais com saldo avulso relevante em produção, avalie uma conversão manual antes
de aplicar — a migração não tenta adivinhar uma taxa de conversão tokens→créditos.

## Ponte com o motor de Execução (Ícaro)

`AiProviderRegistry`/`MediaGenerationService` vivem em `src/application/ai-providers/` —
deliberadamente um terceiro módulo, não pertencente a nenhuma das duas pilhas de IA isoladas
(`scripts/check-ai-stack-isolation.mjs`: AI Gateway vs. Ícaro/Skills). Isso permite que ambas as
pilhas dependam da mesma infraestrutura de provedores sem violar o isolamento de regra de negócio
entre elas. A geração real de imagem/vídeo dentro das Skills (Pedro/Rafa, hoje fake/assistidas)
ainda precisa de uma implementação de `IcaroBrainPort`/`AIProviderPort` que chame
`MediaGenerationService` — não incluída nesta sprint.
