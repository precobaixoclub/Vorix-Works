import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const joaoMarketingStrategyManifest: SkillManifest = {
  id: "joao-marketing-strategy",
  name: "João",
  version: "0.1.0",
  description: "Especialista em Estratégia de Marketing responsável por transformar uma solicitação em uma estratégia estruturada que orienta as próximas Skills, principalmente o briefing enviado para Maria.",
  author: "Zuno",
  capabilities: ["marketing_strategy", "strategy"],
  inputs: [
    {
      name: "marketing_strategy_request",
      description: "Solicitação de estratégia contendo identificação do cliente (clientId ou tenantId), pedido original do usuário, canal desejado, formato desejado, objetivo desejado e contexto opcional do workflow.",
    },
  ],
  outputs: [
    {
      name: "structured_marketing_strategy",
      description: "Estratégia estruturada com objetivo, público-alvo, canal, formato, tom de voz, ângulo, promessa central, proposta de valor, mensagens principais, CTA recomendado, briefing estruturado para Maria (incluindo termos proibidos, palavras obrigatórias e hashtags preferidas da marca, quando disponíveis em Clara), briefing preliminar para Sofia, observações, riscos e próximos passos.",
    },
  ],
  dependencies: [
    {
      name: "ValentinaTenantPort",
      version: "0.1.0",
      optional: false,
    },
    {
      name: "ClaraKnowledgePort",
      version: "0.1.0",
      optional: false,
    },
    {
      name: "IcaroBrainPort",
      version: "0.1.0",
      optional: true,
    },
  ],
  status: "experimental",
  enabled: true,
  compatibility: {
    zuno: "^0.1.0",
  },
  runtime: {
    entrypoint: "./index.js",
  },
  responsibilityBoundary: {
    allowed: [
      "Consultar Valentina para identificar e resolver o cliente.",
      "Consultar Clara para obter contexto de marca, público, produtos, serviços, campanhas, conteúdo, identidade e publicação.",
      "Solicitar apoio opcional ao Ícaro para aprimorar a estratégia.",
      "Definir objetivo, público-alvo, ângulo de comunicação, promessa central, proposta de valor, canal, formato, tom de voz, CTA recomendado e mensagens principais.",
      "Registrar riscos de comunicação e observações.",
      "Montar o briefing estruturado que será enviado para Maria.",
      "Montar um briefing preliminar para a futura Especialista Sofia.",
    ],
    forbidden: [
      "Criar imagens.",
      "Criar vídeos.",
      "Publicar em redes sociais.",
      "Criar campanhas na Meta.",
      "Consultar métricas.",
      "Acessar arquivos diretamente.",
      "Acessar storage diretamente.",
      "Conversar diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA.",
      "Criar a copy final.",
      "Executar a Maria.",
      "Chamar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
