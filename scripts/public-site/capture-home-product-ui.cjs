const { chromium } = require("../../web/node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.resolve(
  process.cwd(),
  "artifacts/vorix-home-redesign-audit/fresh",
);
const BASE_URL = process.env.VORIX_CAPTURE_BASE_URL || "http://localhost:3401";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE_URL).hostname)) {
  throw new Error("Use only a local preview when capturing demonstration data");
}
const WORKSPACE_ID = "ws-demo-atlas";
const TENANT_ID = "tenant-demo-atlas";

fs.mkdirSync(OUT, { recursive: true });

const now = new Date("2026-11-03T13:30:00-03:00");
const iso = (minutes) =>
  new Date(now.getTime() + minutes * 60_000).toISOString();

const members = [
  {
    userId: "user-ana",
    email: "ana@demonstracao.invalid",
    name: "Ana Costa",
    role: "owner",
  },
  {
    userId: "user-rafa",
    email: "rafa@demonstracao.invalid",
    name: "Rafael Lima",
    role: "editor",
  },
  {
    userId: "user-bia",
    email: "bia@demonstracao.invalid",
    name: "Bianca Nunes",
    role: "editor",
  },
];

const teams = [
  {
    id: "team-vendas",
    workspaceId: WORKSPACE_ID,
    name: "Vendas consultivas",
    roundRobinEnabled: true,
    timezone: "America/Sao_Paulo",
    createdAt: iso(-5000),
    updatedAt: iso(-120),
  },
  {
    id: "team-atendimento",
    workspaceId: WORKSPACE_ID,
    name: "Atendimento",
    roundRobinEnabled: true,
    timezone: "America/Sao_Paulo",
    createdAt: iso(-5000),
    updatedAt: iso(-120),
  },
];

const contacts = [
  {
    id: "contact-mariana",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Mariana Souza",
    company: "Empresa demonstração",
    origin: "whatsapp",
    ownerUserId: "user-ana",
    teamId: "team-vendas",
    tags: ["VIP", "Proposta"],
    customFields: {},
    notes: "Procura implantação comercial com atendimento integrado.",
    createdAt: iso(-7600),
    updatedAt: iso(-35),
    lastInteractionAt: iso(-18),
  },
  {
    id: "contact-lucas",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Lucas Mendes",
    company: "Mendes Arquitetura",
    origin: "indicação",
    ownerUserId: "user-rafa",
    teamId: "team-vendas",
    tags: ["Demonstração"],
    customFields: {},
    createdAt: iso(-6200),
    updatedAt: iso(-420),
    lastInteractionAt: iso(-70),
  },
  {
    id: "contact-gabriel",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Gabriel Martins",
    company: "Martins & Co.",
    origin: "instagram",
    ownerUserId: "user-bia",
    teamId: "team-atendimento",
    tags: ["Novo lead"],
    customFields: {},
    createdAt: iso(-3000),
    updatedAt: iso(-90),
    lastInteractionAt: iso(-30),
  },
  {
    id: "contact-helena",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Helena Prado",
    company: "Prado Eventos",
    origin: "whatsapp",
    ownerUserId: "user-ana",
    teamId: "team-vendas",
    tags: ["Follow-up"],
    customFields: {},
    createdAt: iso(-4200),
    updatedAt: iso(-250),
    lastInteractionAt: iso(-140),
  },
];

const pipeline = {
  id: "pipe-sales",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  name: "Comercial",
  isDefault: true,
  createdAt: iso(-7000),
  updatedAt: iso(-300),
};
const stages = [
  {
    id: "stage-novo",
    pipelineId: pipeline.id,
    name: "Novo",
    position: 1,
    isWon: false,
    isLost: false,
    createdAt: iso(-7000),
  },
  {
    id: "stage-qualificacao",
    pipelineId: pipeline.id,
    name: "Qualificação",
    position: 2,
    isWon: false,
    isLost: false,
    createdAt: iso(-7000),
  },
  {
    id: "stage-proposta",
    pipelineId: pipeline.id,
    name: "Proposta",
    position: 3,
    isWon: false,
    isLost: false,
    createdAt: iso(-7000),
  },
  {
    id: "stage-ganho",
    pipelineId: pipeline.id,
    name: "Ganho",
    position: 4,
    isWon: true,
    isLost: false,
    createdAt: iso(-7000),
  },
];

const deals = [
  {
    id: "deal-mariana",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    pipelineId: pipeline.id,
    stageId: "stage-proposta",
    contactId: "contact-mariana",
    title: "Implantação Comercial",
    valueCents: 840000,
    currency: "BRL",
    ownerUserId: "user-ana",
    teamId: "team-vendas",
    origin: "whatsapp",
    expectedCloseDate: "2026-09-30",
    createdAt: iso(-3800),
    updatedAt: iso(-18),
    lastStageChangedAt: iso(-160),
  },
  {
    id: "deal-lucas",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    pipelineId: pipeline.id,
    stageId: "stage-qualificacao",
    contactId: "contact-lucas",
    title: "Plano Enterprise",
    valueCents: 1820000,
    currency: "BRL",
    ownerUserId: "user-rafa",
    teamId: "team-vendas",
    origin: "indicação",
    expectedCloseDate: "2026-10-04",
    createdAt: iso(-3200),
    updatedAt: iso(-70),
    lastStageChangedAt: iso(-700),
  },
  {
    id: "deal-gabriel",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    pipelineId: pipeline.id,
    stageId: "stage-novo",
    contactId: "contact-gabriel",
    title: "Consultoria Comercial",
    valueCents: 560000,
    currency: "BRL",
    ownerUserId: "user-bia",
    teamId: "team-atendimento",
    origin: "instagram",
    expectedCloseDate: "2026-10-07",
    createdAt: iso(-1900),
    updatedAt: iso(-55),
    lastStageChangedAt: iso(-55),
  },
  {
    id: "deal-helena",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    pipelineId: pipeline.id,
    stageId: "stage-ganho",
    contactId: "contact-helena",
    title: "Pacote Eventos Premium",
    valueCents: 1240000,
    currency: "BRL",
    ownerUserId: "user-ana",
    teamId: "team-vendas",
    origin: "whatsapp",
    wonAt: iso(-240),
    expectedCloseDate: "2026-09-24",
    createdAt: iso(-5000),
    updatedAt: iso(-230),
    lastStageChangedAt: iso(-240),
  },
  {
    id: "deal-retail",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    pipelineId: pipeline.id,
    stageId: "stage-proposta",
    contactId: "contact-lucas",
    title: "Expansão multiunidade",
    valueCents: 960000,
    currency: "BRL",
    ownerUserId: "user-rafa",
    teamId: "team-vendas",
    origin: "whatsapp",
    expectedCloseDate: "2026-10-02",
    createdAt: iso(-2500),
    updatedAt: iso(-210),
    lastStageChangedAt: iso(-210),
  },
];

const tasks = [
  {
    id: "task-mariana",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    contactId: "contact-mariana",
    dealId: "deal-mariana",
    type: "follow_up",
    title: "Retornar amanhã às 10h",
    dueAt: iso(1230),
    status: "pending",
    ownerUserId: "user-ana",
    teamId: "team-vendas",
    createdAt: iso(-300),
    updatedAt: iso(-40),
  },
  {
    id: "task-lucas",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    contactId: "contact-lucas",
    dealId: "deal-lucas",
    type: "reuniao",
    title: "Demonstração com diretoria",
    dueAt: iso(2880),
    status: "pending",
    ownerUserId: "user-rafa",
    teamId: "team-vendas",
    createdAt: iso(-1200),
    updatedAt: iso(-90),
  },
  {
    id: "task-overdue",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    contactId: "contact-gabriel",
    dealId: "deal-gabriel",
    type: "whatsapp",
    title: "Responder dúvidas do contrato",
    dueAt: iso(-90),
    status: "pending",
    ownerUserId: "user-bia",
    teamId: "team-atendimento",
    createdAt: iso(-800),
    updatedAt: iso(-95),
  },
];

const proposals = [
  {
    id: "proposal-mariana",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal-mariana",
    contactId: "contact-mariana",
    title: "Proposta Comercial - Implantação",
    items: [
      {
        name: "Setup comercial",
        quantity: 1,
        unitPriceCents: 840000,
        subtotalCents: 840000,
      },
    ],
    discountCents: 0,
    totalCents: 840000,
    currency: "BRL",
    validUntil: "2026-10-01",
    conditions: "Entrada + implantação em 30 dias",
    status: "viewed",
    sentAt: iso(-120),
    viewedAt: iso(-18),
    lastViewedAt: iso(-18),
    viewCount: 3,
    customerName: "Mariana Souza",
    customerCompany: "Empresa demonstração",
    issuerName: "Ana Costa",
    createdAt: iso(-150),
    updatedAt: iso(-18),
  },
  {
    id: "proposal-lucas",
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal-lucas",
    contactId: "contact-lucas",
    title: "Plano Enterprise - 12 meses",
    items: [
      {
        name: "Plano Enterprise",
        quantity: 12,
        unitPriceCents: 151667,
        subtotalCents: 1820000,
      },
    ],
    discountCents: 0,
    totalCents: 1820000,
    currency: "BRL",
    validUntil: "2026-10-05",
    conditions: "Pagamento mensal",
    status: "sent",
    sentAt: iso(-500),
    viewCount: 0,
    customerName: "Lucas Mendes",
    customerCompany: "Mendes Arquitetura",
    issuerName: "Rafael Lima",
    createdAt: iso(-520),
    updatedAt: iso(-500),
  },
];

const conversations = [
  {
    id: "conv-mariana",
    connectionId: "conn-wpp",
    connectionProvider: "wuzapi",
    chatType: "direct",
    contactId: "wa-mariana",
    crmContactId: "contact-mariana",
    status: "open",
    assignedUserId: "user-ana",
    currentTeamId: "team-vendas",
    currentPhaseId: "phase-negociacao",
    lastMessageAt: iso(-18),
    unreadCount: 2,
    isUrgent: true,
    isPinned: true,
    aiEnabled: true,
    automationEnabled: false,
    contactName: "Mariana Souza",
    contactPhone: "+00 00 00000-0000",
    lastMessagePreview: {
      type: "text",
      direction: "inbound",
      body: "Consegui ver a proposta. Podemos ajustar implantação?",
    },
    tags: [
      {
        id: "tag-proposta",
        workspaceId: WORKSPACE_ID,
        name: "Proposta",
        color: "emerald",
        createdAt: iso(-4000),
        updatedAt: iso(-300),
      },
    ],
  },
  {
    id: "conv-lucas",
    connectionId: "conn-wpp",
    connectionProvider: "wuzapi",
    chatType: "direct",
    contactId: "wa-lucas",
    crmContactId: "contact-lucas",
    status: "pending",
    assignedUserId: "user-rafa",
    currentTeamId: "team-vendas",
    currentPhaseId: "phase-qualificacao",
    lastMessageAt: iso(-70),
    unreadCount: 0,
    isUrgent: false,
    isPinned: false,
    aiEnabled: false,
    aiPausedReason: "human_takeover",
    automationEnabled: false,
    contactName: "Lucas Mendes",
    contactPhone: "+00 00 00000-0000",
    lastMessagePreview: {
      type: "text",
      direction: "outbound",
      body: "Perfeito, agendei a demonstração para amanhã.",
    },
    tags: [],
  },
  {
    id: "conv-gabriel",
    connectionId: "conn-ig",
    connectionProvider: "instagram",
    chatType: "direct",
    contactId: "ig-gabriel",
    crmContactId: "contact-gabriel",
    status: "open",
    assignedUserId: "user-bia",
    currentTeamId: "team-atendimento",
    currentPhaseId: "phase-novo",
    lastMessageAt: iso(-30),
    unreadCount: 1,
    isUrgent: false,
    isPinned: false,
    aiEnabled: true,
    automationEnabled: true,
    contactName: "Gabriel Martins",
    contactPhone: "@perfil.demonstracao",
    lastMessagePreview: {
      type: "text",
      direction: "inbound",
      body: "Vocês integram atendimento e CRM?",
    },
    tags: [
      {
        id: "tag-lead",
        workspaceId: WORKSPACE_ID,
        name: "Novo lead",
        color: "sky",
        createdAt: iso(-2000),
        updatedAt: iso(-2000),
      },
    ],
  },
];

const messages = {
  "conv-mariana": [
    {
      id: "m-mar-1",
      conversationId: "conv-mariana",
      direction: "inbound",
      type: "text",
      status: "read",
      body: "Oi Ana, recebi a proposta para a Empresa demonstração.",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-58),
    },
    {
      id: "m-mar-2",
      conversationId: "conv-mariana",
      direction: "outbound",
      type: "text",
      status: "delivered",
      body: "Perfeito, Mariana. Deixei setup, treinamento e acompanhamento dos primeiros 30 dias no escopo.",
      sentByUserId: "user-ana",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-42),
      sentAt: iso(-42),
    },
    {
      id: "m-mar-3",
      conversationId: "conv-mariana",
      direction: "inbound",
      type: "text",
      status: "read",
      body: "Consegui ver a proposta. Podemos ajustar implantação para começar na segunda?",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [
        { reactorId: "user-ana", reactorName: "Ana Costa", emoji: "✅" },
      ],
      createdAt: iso(-18),
    },
    {
      id: "m-mar-4",
      conversationId: "conv-mariana",
      direction: "outbound",
      type: "text",
      status: "sent",
      body: "Sim. Vou ajustar agora e te retorno amanhã às 10h com a versão final.",
      sentByUserId: "user-ana",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-12),
      sentAt: iso(-12),
    },
  ],
  "conv-lucas": [
    {
      id: "m-luc-1",
      conversationId: "conv-lucas",
      direction: "inbound",
      type: "text",
      status: "read",
      body: "Quero entender o plano Enterprise para nossa operação.",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-110),
    },
    {
      id: "m-luc-2",
      conversationId: "conv-lucas",
      direction: "outbound",
      type: "text",
      status: "read",
      body: "Claro. Separei uma demonstração com foco em atendimento e funil comercial.",
      sentByUserId: "user-rafa",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-70),
      sentAt: iso(-70),
    },
  ],
  "conv-gabriel": [
    {
      id: "m-gab-1",
      conversationId: "conv-gabriel",
      direction: "inbound",
      type: "text",
      status: "read",
      body: "Vocês integram atendimento e CRM?",
      sentByAi: false,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-36),
    },
    {
      id: "m-gab-2",
      conversationId: "conv-gabriel",
      direction: "outbound",
      type: "text",
      status: "delivered",
      body: "Sim. A conversa pode virar negócio, tarefa e proposta sem sair do Vorix.",
      sentByAi: true,
      sentByAutomation: false,
      reactions: [],
      createdAt: iso(-30),
      sentAt: iso(-30),
    },
  ],
};

const publications = [
  {
    publicationId: "pub-1",
    target: "instagram",
    placement: "feed",
    caption: "Como transformar atendimento em vendas sem perder contexto.",
    media: [],
    state: "published",
    createdAt: iso(-2500),
    publishedAt: iso(-2100),
  },
  {
    publicationId: "pub-2",
    target: "facebook",
    placement: "feed",
    caption: "Checklist para organizar follow-ups da semana.",
    media: [],
    state: "scheduled",
    createdAt: iso(-1200),
    scheduledAt: iso(1440),
    timezone: "America/Sao_Paulo",
  },
  {
    publicationId: "pub-3",
    target: "instagram",
    placement: "stories",
    caption: "Demonstração: conversa vira proposta.",
    media: [],
    state: "scheduled",
    createdAt: iso(-800),
    scheduledAt: iso(2160),
    timezone: "America/Sao_Paulo",
  },
];

const productionConfig = {
  blueprints: [
    {
      id: "blueprint-1",
      name: "Carrossel integração comercial",
      format: "carousel",
      ideaText:
        "Mostrar como uma conversa da Mariana vira negócio, tarefa e proposta em poucos minutos.",
      objective: "Educar leads sobre operação integrada",
      theme: "Atendimento conectado ao CRM",
      captionDirection: "Clara, consultiva e orientada a resultado.",
      creativeDirection: "Cards limpos com print do fluxo e destaque em verde.",
      mediaCount: 3,
      channels: ["instagram"],
      approvalMode: "manual",
      sourceLinks: [],
      referenceImages: [],
      status: "available",
      productionMode: "routine",
      aspectRatio: "4:5",
    },
    {
      id: "blueprint-2",
      name: "Story proposta visualizada",
      format: "single_image",
      ideaText:
        "Story mostrando alerta de proposta visualizada há 18 minutos e próxima ação sugerida.",
      objective: "Gerar desejo por visibilidade comercial",
      theme: "Follow-up no tempo certo",
      captionDirection: "Direta e com CTA para testar.",
      creativeDirection: "Interface real em primeiro plano.",
      mediaCount: 1,
      channels: ["instagram"],
      approvalMode: "manual",
      sourceLinks: [],
      referenceImages: [],
      status: "used",
      productionMode: "routine",
      usedAt: iso(-400),
      aspectRatio: "9:16",
    },
    {
      id: "blueprint-3",
      name: "Post atendimento sem perder contexto",
      format: "single_image",
      ideaText:
        "Publicação explicando atendimento estilo WhatsApp Web com CRM ao lado.",
      objective: "Converter visitantes em teste grátis",
      theme: "Atendimento + contexto",
      captionDirection: "Benefício claro em uma frase.",
      creativeDirection: "Tela de Conversas do Vorix com highlight discreto.",
      mediaCount: 1,
      channels: ["instagram", "facebook"],
      approvalMode: "manual",
      sourceLinks: [],
      referenceImages: [],
      status: "available",
      productionMode: "routine",
      aspectRatio: "4:5",
    },
  ],
  postingRules: [
    {
      id: "rule-1",
      channel: "instagram",
      enabled: true,
      timezone: "America/Sao_Paulo",
      times: ["09:00", "18:30"],
      weeklyMix: [
        {
          id: "mix-1",
          format: "single_image",
          quantity: 2,
          weekdays: ["mon", "wed"],
          times: ["09:00"],
        },
        {
          id: "mix-2",
          format: "carousel",
          quantity: 1,
          weekdays: ["fri"],
          times: ["18:30"],
        },
      ],
    },
    {
      id: "rule-2",
      channel: "facebook",
      enabled: true,
      timezone: "America/Sao_Paulo",
      times: ["11:00"],
      weeklyMix: [
        {
          id: "mix-3",
          format: "single_image",
          quantity: 1,
          weekdays: ["thu"],
          times: ["11:00"],
        },
      ],
    },
  ],
};

function envelope(data) {
  return { ok: true, data };
}

async function fulfill(route, data, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(envelope(data)),
  });
}

function filterByParams(list, url) {
  let result = [...list];
  const contactId = url.searchParams.get("contactId");
  const dealId = url.searchParams.get("dealId");
  const status = url.searchParams.get("status");
  const pipelineId = url.searchParams.get("pipelineId");
  if (contactId) result = result.filter((item) => item.contactId === contactId);
  if (dealId) result = result.filter((item) => item.dealId === dealId);
  if (status) result = result.filter((item) => item.status === status);
  if (pipelineId)
    result = result.filter((item) => item.pipelineId === pipelineId);
  return result;
}

function analyticsResult(metricValues = {}) {
  return {
    period: { from: "2026-08-26", to: "2026-09-24" },
    rows: [
      {
        key: "instagram",
        dimensions: { provider: "instagram", network: "instagram" },
        values: {
          publication_completed_total: 8,
          publication_requested_total: 12,
          publication_failed_total: 1,
          ...metricValues,
        },
      },
      {
        key: "facebook",
        dimensions: { provider: "facebook", network: "facebook" },
        values: {
          publication_completed_total: 4,
          publication_requested_total: 5,
          publication_failed_total: 0,
        },
      },
    ],
    series: {
      points: [
        {
          from: "2026-09-18",
          to: "2026-09-18",
          values: { publication_completed_total: 2 },
        },
        {
          from: "2026-09-19",
          to: "2026-09-19",
          values: { publication_completed_total: 1 },
        },
        {
          from: "2026-09-20",
          to: "2026-09-20",
          values: { publication_completed_total: 3 },
        },
        {
          from: "2026-09-21",
          to: "2026-09-21",
          values: { publication_completed_total: 2 },
        },
        {
          from: "2026-09-22",
          to: "2026-09-22",
          values: { publication_completed_total: 4 },
        },
      ],
    },
  };
}

async function mockApi(page) {
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();

    if (p === "/v1/auth/refresh" && method === "POST")
      return fulfill(route, {
        accessToken: "demo-access-token",
        expiresIn: 3600,
        tenantId: TENANT_ID,
        role: "owner",
      });
    if (p === "/v1/auth/me")
      return fulfill(route, {
        user: {
          id: "user-ana",
          email: "ana@demonstracao.invalid",
          name: "Ana Costa",
          isPlatformAdmin: false,
        },
        tenantId: TENANT_ID,
        role: "owner",
      });
    if (p === "/v1/workspaces")
      return fulfill(route, [
        {
          id: WORKSPACE_ID,
          tenantId: TENANT_ID,
          name: "Empresa demonstração",
          status: "active",
          createdAt: iso(-9000),
          updatedAt: iso(-20),
          campaignIds: [],
          integrations: [],
          members: [],
          settings: {},
        },
      ]);
    if (p === `/v1/workspaces/${WORKSPACE_ID}`)
      return fulfill(route, {
        id: WORKSPACE_ID,
        tenantId: TENANT_ID,
        name: "Empresa demonstração",
        status: "active",
        createdAt: iso(-9000),
        updatedAt: iso(-20),
        campaignIds: [],
        integrations: [],
        members: [],
        settings: {},
      });
    if (p === "/v1/workspaces/credits")
      return fulfill(route, {
        monthlyCreditsQuota: 220,
        creditsConsumedThisMonth: 36,
        creditsExtra: 0,
        remainingCredits: 184,
      });
    if (p === "/v1/billing/overview") return fulfill(route, null);
    if (p === "/v1/onboarding")
      return fulfill(route, {
        workspaceId: WORKSPACE_ID,
        status: "completed",
        completedSteps: ["company", "commercial", "team", "channel", "brand"],
        updatedAt: iso(-1000),
      });

    if (p === "/v1/inbox/status") return fulfill(route, { enabled: true });
    if (p === "/v1/inbox/members") return fulfill(route, { members });
    if (p === "/v1/inbox/connections")
      return fulfill(route, {
        connections: [
          {
            id: "conn-wpp",
            displayName: "WhatsApp Comercial",
            phoneNumber: "+00 00 00000-0000",
            status: "connected",
            connectionHealth: "healthy",
            lastConnectedAt: iso(-4000),
          },
          {
            id: "conn-ig",
            displayName: "Instagram Direct",
            status: "connected",
            connectionHealth: "healthy",
            lastConnectedAt: iso(-3800),
          },
        ],
      });
    if (p === "/v1/inbox/conversations")
      return fulfill(route, { conversations });
    if (/\/v1\/inbox\/conversations\/[^/]+\/messages$/.test(p))
      return fulfill(route, { messages: messages[p.split("/")[4]] || [] });
    if (/\/v1\/inbox\/conversations\/[^/]+\/events$/.test(p))
      return fulfill(route, { events: [] });
    if (p === "/v1/inbox/metrics")
      return fulfill(route, {
        receivedCount: 42,
        openCount: 9,
        pendingCount: 6,
        resolvedCount: 31,
        backlogCount: 7,
        avgFirstResponseSeconds: 248,
        avgHandleTimeSeconds: 3120,
        aiResolvedMessageCount: 16,
        humanResolvedMessageCount: 26,
        volumeByAgent: [
          { userId: "user-ana", messageCount: 38 },
          { userId: "user-rafa", messageCount: 24 },
          { userId: "user-bia", messageCount: 19 },
        ],
      });
    if (/\/v1\/inbox\/teams\/[^/]+\/kanban-phases$/.test(p))
      return fulfill(route, {
        phases: [
          {
            id: "phase-novo",
            teamId: "team-vendas",
            name: "Novo atendimento",
            orderIndex: 1,
            isDefaultFirst: true,
            phaseType: "RUNNING",
            naoContabilizaOperacional: false,
            createdAt: iso(-2000),
            updatedAt: iso(-1000),
          },
          {
            id: "phase-qualificacao",
            teamId: "team-vendas",
            name: "Qualificação",
            orderIndex: 2,
            isDefaultFirst: false,
            phaseType: "RUNNING",
            naoContabilizaOperacional: false,
            createdAt: iso(-2000),
            updatedAt: iso(-1000),
          },
          {
            id: "phase-negociacao",
            teamId: "team-vendas",
            name: "Negociação",
            orderIndex: 3,
            isDefaultFirst: false,
            phaseType: "RUNNING",
            naoContabilizaOperacional: false,
            createdAt: iso(-2000),
            updatedAt: iso(-1000),
          },
        ],
      });
    if (/\/v1\/inbox\/teams\/[^/]+\/conversations\/service-time$/.test(p))
      return fulfill(route, {
        serviceTime: conversations.map((item, index) => ({
          conversationId: item.id,
          totalSeconds: 900 + index * 800,
          currentPhaseStartedAt: iso(-45 - index * 20),
          isRunning: true,
        })),
      });
    if (
      /\/v1\/inbox\/teams\/[^/]+\/conversations\/ensure-phase-states$/.test(p)
    )
      return fulfill(route, { ensured: true });

    if (p === "/v1/teams") return fulfill(route, teams);
    if (p === "/v1/contacts")
      return fulfill(route, filterByParams(contacts, url));
    if (/\/v1\/contacts\/[^/]+$/.test(p))
      return fulfill(
        route,
        contacts.find((item) => item.id === p.split("/")[3]),
      );
    if (/\/v1\/contacts\/[^/]+\/lead-score$/.test(p))
      return fulfill(route, {
        score: 84,
        temperature: "quente",
        factors: [
          { label: "Proposta visualizada", points: 28 },
          { label: "Respondeu em até 1h", points: 16 },
          { label: "Negócio em Proposta", points: 24 },
        ],
      });
    if (/\/v1\/contacts\/[^/]+\/activity$/.test(p))
      return fulfill(route, [
        {
          id: "act-1",
          type: "proposal.viewed",
          category: "proposal",
          occurredAt: iso(-18),
          actor: { type: "contact" },
          title: "Proposta visualizada",
          description: "Mariana abriu a proposta pela terceira vez.",
        },
      ]);
    if (p === "/v1/commercial-suggestions")
      return fulfill(route, [
        {
          id: "sug-1",
          contactId: "contact-mariana",
          dealId: "deal-mariana",
          title: "Retomar enquanto a proposta está quente",
          rationale:
            "A proposta foi visualizada há 18 min e há pergunta sobre implantação.",
          evidence: "3 visualizações recentes",
          confidence: 0.91,
          suggestedAction: "follow_up_task",
          status: "pending",
          createdAt: iso(-16),
        },
      ]);
    if (p === "/v1/pipelines") return fulfill(route, [pipeline]);
    if (/\/v1\/pipelines\/[^/]+\/stages$/.test(p))
      return fulfill(route, stages);
    if (p === "/v1/deals") return fulfill(route, filterByParams(deals, url));
    if (/\/v1\/deals\/[^/]+\/timeline$/.test(p)) return fulfill(route, []);
    if (p === "/v1/tasks") return fulfill(route, filterByParams(tasks, url));
    if (p === "/v1/proposals")
      return fulfill(route, filterByParams(proposals, url));
    if (/\/v1\/proposals\/[^/]+\/timeline$/.test(p)) return fulfill(route, []);
    if (p === "/v1/products")
      return fulfill(route, [
        {
          id: "prod-setup",
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          name: "Setup comercial",
          priceCents: 840000,
          currency: "BRL",
          active: true,
          createdAt: iso(-2000),
          updatedAt: iso(-400),
        },
      ]);
    if (p === "/v1/proposal-templates") return fulfill(route, []);
    if (p === "/v1/commercial-metrics")
      return fulfill(route, {
        dealsCreatedCount: 12,
        openPipelineValueCents: 3800000,
        wonCount: 4,
        wonValueCents: 2460000,
        lostCount: 1,
        conversionRate: 0.31,
        avgTicketCents: 820000,
        avgCycleDays: 9.4,
        proposalsSentCount: 7,
        proposalsAcceptedCount: 3,
        proposalAcceptRate: 0.42,
        dealsWithoutNextActionCount: 1,
        stageAging: [
          {
            stageId: "stage-novo",
            stageName: "Novo",
            openCount: 3,
            avgDaysInStage: 1.7,
          },
          {
            stageId: "stage-qualificacao",
            stageName: "Qualificação",
            openCount: 4,
            avgDaysInStage: 3.2,
          },
          {
            stageId: "stage-proposta",
            stageName: "Proposta",
            openCount: 2,
            avgDaysInStage: 2.1,
          },
        ],
        lossReasons: [{ reason: "Sem orçamento", count: 1 }],
        revenueByOrigin: [
          { origin: "whatsapp", wonCount: 3, wonValueCents: 1840000 },
          { origin: "indicação", wonCount: 1, wonValueCents: 620000 },
        ],
      });

    if (p === "/v1/production-settings")
      return fulfill(route, {
        workspaceId: WORKSPACE_ID,
        productionPrompt:
          "Tom consultivo, direto e premium. Priorizar clareza operacional e provas do produto real.",
        updatedAt: iso(-1200),
      });
    if (p === "/v1/assets") return fulfill(route, []);
    if (p === "/v1/execution-runs")
      return fulfill(route, [
        {
          id: "run-story",
          runtimePlanId: "plan-story",
          planningId: "planning-story",
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          state: "waiting_for_approval",
          mode: "real",
          idempotencyKey: "demo-run-1",
          sourceGraphFingerprint: "demo",
          runtimeFingerprint: "demo",
          correlationId: "corr-1",
          traceId: "trace-1",
          createdAt: iso(-50),
          updatedAt: iso(-30),
          version: 1,
        },
      ]);
    if (/\/v1\/execution-runs\/[^/]+$/.test(p))
      return fulfill(route, {
        run: {
          id: p.split("/")[3],
          runtimePlanId: "plan-story",
          planningId: "planning-story",
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          state: "waiting_for_approval",
          mode: "real",
          idempotencyKey: "demo-run-1",
          sourceGraphFingerprint: "demo",
          runtimeFingerprint: "demo",
          correlationId: "corr-1",
          traceId: "trace-1",
          createdAt: iso(-50),
          updatedAt: iso(-30),
          version: 1,
        },
        tasks: [],
        events: [],
        traces: [],
      });

    if (p === "/v1/instagram/posts") return fulfill(route, publications);
    if (p === "/v1/tiktok/posts") return fulfill(route, []);
    if (p === "/v1/youtube/posts") return fulfill(route, []);
    if (p.startsWith("/v1/analytics/")) {
      if (p === "/v1/analytics/alerts")
        return fulfill(route, [
          {
            id: "alert-proposal",
            workspaceId: WORKSPACE_ID,
            title: "Proposta visualizada sem resposta",
            description:
              "Mariana visualizou 3 vezes e ainda não respondeu ao ajuste.",
            severity: "warning",
            status: "active",
            metricId: "proposal_viewed",
            occurredAt: iso(-18),
            createdAt: iso(-18),
            updatedAt: iso(-18),
          },
        ]);
      return fulfill(route, analyticsResult());
    }

    return fulfill(route, method === "GET" ? [] : {});
  });
}

async function prepare(page) {
  await page.context().addCookies([
    {
      name: "zuno_refresh_token",
      value: "demo-refresh-token",
      url: BASE_URL,
    },
  ]);
  await mockApi(page);
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: `vorix.production-line.${WORKSPACE_ID}`,
      value: productionConfig,
    },
  );
}

async function capture(page, name, url, options = {}) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: "networkidle" });
  for (const text of options.clickTexts || []) {
    await page.getByText(text, { exact: false }).first().click();
    await page.waitForTimeout(500);
  }
  if (options.clickText) {
    await page.getByText(options.clickText, { exact: false }).first().click();
    await page.waitForTimeout(500);
  }
  for (const clickRole of options.clickRoles || []) {
    await page
      .getByRole(clickRole.role, { name: clickRole.name })
      .first()
      .click();
    await page.waitForTimeout(500);
  }
  if (options.clickRole) {
    await page
      .getByRole(options.clickRole.role, { name: options.clickRole.name })
      .first()
      .click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(options.wait || 900);
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: options.fullPage ?? false,
  });
}

// Author-created fixtures only. Actual application components render every screenshot.
const meetingId = "demo-meeting";
const stamp = "2026-11-03T13:00:00.000Z";
const analysis = {
  id: "analysis-demo",
  status: "completed",
  creditsCharged: 1,
  createdAt: stamp,
  result: {
    executiveSummary:
      "A equipe alinhou as prioridades da próxima entrega e definiu os responsáveis pelo acompanhamento. O atendimento e o comercial vão compartilhar o contexto antes de preparar a proposta.",
    topics: [
      "Prioridades da próxima entrega",
      "Contexto do atendimento e proposta comercial",
      "Responsáveis e acompanhamento",
    ],
    decisions: [
      "Priorizar a primeira entrega",
      "Compartilhar o contexto com o comercial",
    ],
    actionItems: [
      {
        description: "Preparar o cronograma da primeira entrega",
        owner: "Ana Costa",
        dueDate: "2026-11-06",
      },
      {
        description: "Revisar o escopo da proposta",
        owner: "Rafael Lima",
        dueDate: "2026-11-05",
      },
    ],
    nextSteps: ["Revisar o cronograma na próxima reunião"],
    risks: [],
    objections: [],
    openQuestions: [],
  },
  actionItems: [
    {
      id: "action-demo",
      type: "task",
      description: "Preparar o cronograma da primeira entrega",
      assigneeName: "Ana Costa",
      dueDate: "2026-11-06",
      status: "suggested",
      confidence: 0.9,
    },
  ],
};
const meeting = {
  id: meetingId,
  workspaceId: WORKSPACE_ID,
  ownerUserId: "user-ana",
  ownerName: "Ana Costa",
  createdByUserId: "user-ana",
  title: "Alinhamento da próxima entrega — demonstração",
  description:
    "Reunião de exemplo com dados fictícios para demonstração da interface.",
  source: "manual",
  status: "completed",
  timezone: "America/Sao_Paulo",
  scheduledStartAt: stamp,
  scheduledEndAt: "2026-11-03T13:30:00.000Z",
  durationSeconds: 1800,
  statusChangedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
  participants: [
    {
      id: "p1",
      name: "Ana Costa",
      email: "ana@demonstracao.invalid",
      role: "organizer",
    },
    {
      id: "p2",
      name: "Rafael Lima",
      email: "rafael@demonstracao.invalid",
      role: "attendee",
    },
  ],
  recordings: [],
  transcript: {
    id: "transcript-demo",
    status: "completed",
    language: "pt",
    segmentCount: 4,
    completedAt: stamp,
  },
  latestAnalysis: analysis,
  lastCompletedAnalysis: analysis,
};
const insights = {
  summaryTemplate: "general",
  templates: [
    { key: "general", label: "Geral", description: "Resumo geral da reunião" },
  ],
  speakers: [
    { key: "s1", displayName: "Ana Costa", renamed: false },
    { key: "s2", displayName: "Rafael Lima", renamed: false },
  ],
  talk: {
    hasSpeakers: true,
    totalTalkMs: 180000,
    speakers: [],
    speakerSwitches: 3,
    questions: 1,
  },
  keywordHits: [],
  clips: [],
  comments: [],
  shares: [],
  crm: { available: true, suggestions: [] },
  crmTasks: {},
  questions: [],
  whatsAppAvailable: false,
  aiAvailable: true,
};
const capacity = {
  planCapacity: 2,
  tenantHealthyCapacity: 2,
  tenantAvailableCapacity: 2,
  planLimit: 2,
  connectedAccounts: 2,
  healthyAccounts: 2,
  busyAccounts: 0,
  invalidAccounts: 0,
  tenantEffectiveRecordingCapacity: 2,
  activeRecordings: 0,
  availableNow: 2,
  reserveAccounts: 0,
  missingAccountsForPlan: 0,
  canManage: true,
  knownHumanEmails: ["ana@demonstracao.invalid"],
};
const segments = [
  {
    seq: 0,
    startMs: 0,
    endMs: 12000,
    speaker: "Ana Costa",
    text: "Vamos alinhar as prioridades da próxima entrega e sair com os responsáveis definidos.",
  },
  {
    seq: 1,
    startMs: 13000,
    endMs: 28000,
    speaker: "Rafael Lima",
    text: "Podemos começar pelo contexto do atendimento. A proposta precisa refletir o que foi combinado com o cliente.",
  },
  {
    seq: 2,
    startMs: 29000,
    endMs: 44000,
    speaker: "Ana Costa",
    text: "Combinado. Eu preparo o cronograma até sexta-feira e compartilho com a equipe.",
  },
  {
    seq: 3,
    startMs: 45000,
    endMs: 60000,
    speaker: "Rafael Lima",
    text: "Eu reviso o escopo da proposta. Na próxima reunião, conferimos o cronograma e os próximos passos.",
  },
];
async function addCurrentFixtures(page) {
  await page.route("**/v1/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/v1/auth/me")
      return fulfill(route, {
        user: {
          id: "user-ana",
          email: "ana@demonstracao.invalid",
          name: "Ana Costa",
          isPlatformAdmin: false,
        },
        tenantId: TENANT_ID,
        role: "owner",
        isAccountOwner: true,
        teams: [],
        permissions: [
          "order:read",
          "site:manage",
          "site:publish",
          "product:read",
          "product:manage",
        ],
      });
    if (p === "/v1/dashboard") return fulfill(route, dashboardFixture);
    if (p === "/v1/commerce/orders")
      return fulfill(route, {
        orders: orderFixtures,
        total: orderFixtures.length,
      });
    if (p === "/v1/sites")
      return fulfill(route, {
        sites: [siteFixture],
        publicBaseDomain: "demonstracao.invalid",
      });
    if (p === "/v1/sites/site-demo/preview")
      return fulfill(route, {
        ...siteFixture.draft,
        id: "site-demo",
        slug: "loja-demonstracao",
        products: [],
        categories: [],
        brands: [],
        commerceEnabled: false,
      });
    if (p === "/v1/solutions")
      return fulfill(route, {
        solutions: [
          { key: "conversations", name: "Vorix Conversas", internal: false },
          { key: "meetings", name: "Vorix Meetings", internal: false },
          { key: "marketing", name: "Vorix Marketing", internal: true },
          { key: "site", name: "Vorix Site", internal: false },
        ],
      });
    if (p === "/v1/billing/overview") return fulfill(route, null);
    if (p === "/v1/meetings/recording-capacity")
      return fulfill(route, capacity);
    if (p === "/v1/meetings/dashboard")
      return fulfill(route, {
        meetingsToday: 2,
        meetingsThisWeek: 6,
        recordingNow: 0,
        processing: 0,
        recordedSeconds: 10800,
        transcriptsAvailable: 6,
        limits: {
          maxConcurrentRecordings: 2,
          monthlyRecordingMinutes: 600,
          meetingRetentionDays: 90,
          maxStorageBytes: 1000000000,
        },
        realRecordingEnabled: false,
      });
    if (p === "/v1/meetings")
      return fulfill(route, {
        items: [
          {
            ...meeting,
            participantCount: 2,
            hasRecording: false,
            recordingBytes: 0,
            transcriptStatus: "completed",
            hasAnalysis: true,
          },
        ],
        total: 1,
      });
    if (p === `/v1/meetings/${meetingId}`) return fulfill(route, meeting);
    if (p === `/v1/meetings/${meetingId}/insights`)
      return fulfill(route, insights);
    if (p === `/v1/meetings/${meetingId}/transcript`)
      return fulfill(route, { segments });
    if (p === "/v1/notifications")
      return fulfill(route, { items: [], unreadCount: 0 });
    return route.fallback();
  });
}
const avg = (value, sample) => ({ value, sample });
const dashboardFixture = {
  viewing: "me",
  period: {
    period: "this_month",
    from: "2026-11-01",
    to: "2026-11-03",
    timeZone: "America/Sao_Paulo",
    monthStart: "2026-11-01",
  },
  options: {
    viewings: [{ value: "me", label: "Eu" }],
    userIds: ["user-ana"],
    teams: [{ id: "team-vendas", name: "Vendas consultivas" }],
  },
  attendance: {
    available: true,
    volume: { opened: 42, finalized: 31, reopened: 2, reopenRateBp: 645 },
    frt: avg(248, 38),
    frtAttendance: avg(260, 38),
    tmr: avg(3120, 31),
    holding: avg(1800, 38),
    transfers: {
      count: 3,
      attendancesWithTransfer: 3,
      rateBp: 968,
      averagePerAttendance: 0.1,
    },
    sla: {
      configured: true,
      firstResponse: { met: 35, breached: 3, rateBp: 9211 },
      resolution: { met: 29, breached: 2, rateBp: 9355 },
      openNear: 1,
      openBreached: 0,
    },
    backlog: {
      total: 7,
      queue: 2,
      awaitingFirstResponse: 2,
      awaitingAgent: 3,
      awaitingCustomer: 2,
      slaBreached: 0,
    },
    csat: {
      average: avg(4.7, 12),
      sent: 15,
      answered: 12,
      responseRateBp: 8000,
      waived: 0,
      disabledByChannel: 0,
      notApplicable: 0,
      failed: 0,
    },
    closures: [
      { typeName: "Resolvido", count: 25, shareBp: 8065 },
      { typeName: "Encaminhado ao comercial", count: 6, shareBp: 1935 },
    ],
    phases: [
      { phaseName: "Novo atendimento", average: avg(240, 20) },
      { phaseName: "Qualificação", average: avg(900, 15) },
      { phaseName: "Negociação", average: avg(1800, 10) },
    ],
    agents: [],
    teams: [],
  },
  commercial: {
    available: true,
    open: { count: 4, valueCents: 4180000 },
    pipelineByStage: [
      {
        pipelineId: "pipe-sales",
        stageId: "stage-novo",
        name: "Novo",
        count: 1,
        valueCents: 560000,
      },
      {
        pipelineId: "pipe-sales",
        stageId: "stage-qualificacao",
        name: "Qualificação",
        count: 1,
        valueCents: 1820000,
      },
      {
        pipelineId: "pipe-sales",
        stageId: "stage-proposta",
        name: "Proposta",
        count: 2,
        valueCents: 1800000,
      },
    ],
    won: { count: 1, valueCents: 1240000 },
    lost: { count: 0, valueCents: 0, reasons: [] },
    conversionBp: 2000,
    averageTicketCents: 1240000,
    proposals: {
      created: 2,
      sent: 2,
      accepted: 1,
      declined: 0,
      acceptanceRateBp: 5000,
      convertedToSale: 1,
      saleConversionBp: 5000,
    },
    sellers: [],
  },
  goals: { available: false },
};
const orderFixtures = [
  [
    "order-demo-a",
    1003,
    "Cliente demonstração A",
    "SITE",
    "PROCESSING",
    49900,
    "PENDING",
  ],
  [
    "order-demo-b",
    1002,
    "Cliente demonstração B",
    "SITE",
    "SHIPPED",
    12900,
    "SHIPPED",
  ],
  [
    "order-demo-c",
    1001,
    "Cliente demonstração C",
    "SITE",
    "DELIVERED",
    18000,
    "DELIVERED",
  ],
].map(([id, number, name, source, status, totalCents, shippingStatus]) => ({
  id,
  number,
  source,
  status,
  totalCents,
  shippingStatus,
  paymentStatus: "APPROVED",
  stockState: "COMMITTED",
  currency: "BRL",
  customer: { name, email: `${id}@demonstracao.invalid`, phone: "" },
  subtotalCents: totalCents,
  discountCents: 0,
  shippingCents: 0,
  utm: {},
  createdAt: stamp,
  items: [],
}));
const registry = require("../../dist/domain/sites/template-registry.json");
const theme = registry.find((t) => t.id === "aura").defaultTheme;
const block = (id, type, title, text, extra = {}) => ({
  id,
  type,
  title,
  text,
  imageAlt: "",
  productIds: [],
  items: [],
  enabled: true,
  ...extra,
});
const snapshot = {
  theme,
  activeTemplateId: "aura",
  content: {
    name: "Loja demonstração",
    description: "Um exemplo para conhecer o editor do Vorix.",
    email: "contato@demonstracao.invalid",
    footer: "Loja fictícia para demonstração do produto.",
    socials: [],
    seo: {
      title: "Loja demonstração",
      description: "Ambiente de demonstração.",
    },
    header: {
      navigation: [
        { id: "home", label: "Início", url: "/", enabled: true, newTab: false },
        {
          id: "catalog",
          label: "Coleção",
          url: "#catalogo",
          enabled: true,
          newTab: false,
        },
      ],
      showSearch: true,
      sticky: false,
      announcement: { enabled: true, text: "DEMONSTRAÇÃO · Dados fictícios" },
    },
    footerColumns: [],
    footerNote: "Nenhuma compra real.",
    blocks: [
      block(
        "hero",
        "hero",
        "Design que faz parte do seu dia.",
        "Conheça as possibilidades do seu site com este exemplo.",
        {
          eyebrow: "LOJA DEMONSTRAÇÃO",
          imageUrl: "/site-assets/templates/aura-hero.webp",
          buttonLabel: "Conhecer coleção",
          buttonUrl: "#catalogo",
        },
      ),
      block("features", "features", "Escolhas com significado", "", {
        items: [
          {
            title: "Sua marca",
            text: "Cores e fontes com a sua personalidade.",
            icon: "heart",
          },
          {
            title: "Seu catálogo",
            text: "Produtos organizados em um só lugar.",
            icon: "sparkles",
          },
        ],
      }),
      block(
        "contact",
        "contact",
        "Vamos conversar?",
        "Entre em contato com a nossa equipe.",
      ),
    ],
    pages: [],
    contactForm: true,
  },
};
const siteFixture = {
  id: "site-demo",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  slug: "loja-demonstracao",
  draft: snapshot,
  published: snapshot,
  revision: 1,
  publishedAt: stamp,
  updatedAt: stamp,
};
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "zuno_refresh_token", value: "demo-refresh-token", url: BASE_URL },
  ]);
  await mockApi(page);
  await addCurrentFixtures(page);
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: `vorix.production-line.${WORKSPACE_ID}`, value: productionConfig },
  );
  await capture(
    page,
    "meetings-overview",
    `/workspaces/${WORKSPACE_ID}/meetings`,
    { wait: 1800 },
  );
  await capture(
    page,
    "meetings-summary",
    `/workspaces/${WORKSPACE_ID}/meetings/central/${meetingId}`,
    { clickText: "Resumo IA", wait: 1800 },
  );
  await page.screenshot({
    path: path.join(OUT, "meetings-summary-full.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Transcrição", exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(OUT, "meetings-transcript.png"),
    fullPage: false,
  });
  const targets = [
    [
      "conversas",
      `/workspaces/${WORKSPACE_ID}/conversas`,
      { clickText: "Mariana Souza" },
    ],
    ["crm-kanban", `/workspaces/${WORKSPACE_ID}/deals`, {}],
    [
      "marketing",
      `/workspaces/${WORKSPACE_ID}/create?draft=Crie%20um%20carrossel%20sobre%20atendimento%20integrado`,
      {},
    ],
    ["results", `/workspaces/${WORKSPACE_ID}/results`, {}],
    ["dashboard", `/workspaces/${WORKSPACE_ID}`, {}],
    ["commerce-orders", `/workspaces/${WORKSPACE_ID}/site/pedidos`, {}],
    ["site-editor", `/workspaces/${WORKSPACE_ID}/site?section=aparencia`, {}],
  ];
  for (const [name, url, opt] of targets) {
    try {
      await capture(page, name, url, { ...opt, wait: 1000 });
    } catch (e) {
      errors.push(name + ": " + e.message);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(
    page,
    "mobile-conversas",
    `/workspaces/${WORKSPACE_ID}/conversas`,
    { clickText: "Mariana Souza" },
  );
  fs.writeFileSync(
    path.join(OUT, "capture-errors.json"),
    JSON.stringify(errors, null, 2),
  );
  console.log(JSON.stringify({ files: fs.readdirSync(OUT), errors }));
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
