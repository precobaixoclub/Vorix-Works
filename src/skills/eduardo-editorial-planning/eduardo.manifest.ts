import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const eduardoEditorialPlanningManifest: SkillManifest = {
  id: "eduardo-editorial-planning",
  name: "Eduardo",
  version: "0.1.0",
  description: "Especialista em Planejamento Editorial responsável por decidir a melhor estratégia de conteúdo (formato, quantidade de slides ou telas, duração de vídeo, emoção principal, estrutura narrativa, CTA, profundidade, complexidade e prioridade de conversão) antes do João iniciar o trabalho, entregando um Editorial Brief estruturado.",
  author: "Zuno",
  capabilities: ["editorial_planning"],
  inputs: [
    {
      name: "editorial_planning_request",
      description: "Solicitação de planejamento editorial contendo identificação do cliente (clientId ou tenantId), pedido original do usuário, canal desejado, objetivo desejado e contexto opcional do workflow.",
    },
  ],
  outputs: [
    {
      name: "structured_editorial_brief",
      description: "Editorial Brief estruturado com objetivo da campanha, formato recomendado e justificativa, quantidade recomendada de slides ou telas, duração recomendada quando for vídeo, canal recomendado, emoção principal, estrutura narrativa sugerida, CTA recomendado, nível de profundidade, complexidade do conteúdo, prioridade de conversão e recomendações para o João.",
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
    {
      name: "QualityFeedbackPort",
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
      "Consultar Clara para obter contexto de marca, público, produtos, campanhas, conteúdo e identidade.",
      "Solicitar apoio opcional ao Ícaro para aprimorar a justificativa, a estrutura narrativa, a emoção principal e as recomendações para o João.",
      "Consultar opcionalmente o histórico de Quality Feedback para acrescentar recomendações a `recommendationsForJoao` (nunca para alterar formato, quantidade, duração, canal ou CTA).",
      "Decidir o formato recomendado (imagem única, carrossel, Reels, vídeo ou Story) e a justificativa dessa escolha.",
      "Decidir a quantidade recomendada de slides ou telas e a duração recomendada quando o formato for vídeo.",
      "Decidir a emoção principal, a estrutura narrativa sugerida, o CTA recomendado, o nível de profundidade, a complexidade do conteúdo e a prioridade de conversão.",
      "Montar o Editorial Brief estruturado que orienta o João.",
    ],
    forbidden: [
      "Criar copy final.",
      "Criar imagens.",
      "Criar vídeos.",
      "Definir layout, paleta, tipografia ou identidade visual.",
      "Publicar em redes sociais.",
      "Criar campanhas na Meta.",
      "Consultar métricas.",
      "Acessar arquivos diretamente.",
      "Acessar storage diretamente.",
      "Conversar diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA.",
      "Executar o João ou qualquer outra Skill.",
      "Chamar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
