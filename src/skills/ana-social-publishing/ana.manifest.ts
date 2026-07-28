import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const anaSocialPublishingManifest: SkillManifest = {
  id: "ana-social-publishing",
  name: "Ana",
  version: "0.1.0",
  description: "Especialista em Publicação Social responsável por validar o pacote de publicação já produzido e revisado e solicitar a publicação orgânica no Instagram e no Facebook através de uma porta abstrata de publicação social, incluindo imagem, carrossel e vídeo.",
  author: "Zuno",
  capabilities: ["social_publishing"],
  inputs: [
    {
      name: "social_publishing_request",
      description: "Solicitação de publicação contendo identificação do cliente (clientId ou tenantId), pedido original, estratégia do João, copy da Maria, direção visual da Sofia, imagens do Pedro ou vídeo do Rafa, revisão do Lucas, aprovação humana, canais, modo de publicação e data de agendamento quando houver.",
    },
  ],
  outputs: [
    {
      name: "structured_social_publishing_result",
      description: "Resultado estruturado com status da publicação, canais solicitados, publicados e com erro, modo de publicação, data agendada, resultados por canal, IDs e URLs externas, payload enviado ao publisher, warnings, observações e próximos passos.",
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
      name: "SocialPublisherPort",
      version: "0.1.0",
      optional: false,
    },
    {
      name: "ArtifactHostingPort",
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
      "Consultar Valentina para identificar o cliente e verificar integrações conectadas.",
      "Consultar Clara para obter regras de publicação do cliente.",
      "Validar se o pacote de publicação pode ser publicado (cliente, integração, copy, imagem/carrossel/vídeo, revisão do Lucas, aprovação humana, plano, provider e regras da Clara).",
      "Aceitar artefatos de vídeo do Rafa sem importar a Skill Rafa diretamente.",
      "Solicitar hospedagem pública de artefatos locais por ArtifactHostingPort antes de publicação real.",
      "Solicitar publicação imediata ou agendada através de SocialPublisherPort.",
      "Simular publicação em modo dry_run sem chamar SocialPublisherPort.",
      "Devolver status estruturado por canal, incluindo IDs e URLs externas.",
    ],
    forbidden: [
      "Criar estratégia.",
      "Criar copy.",
      "Criar imagens.",
      "Fazer revisão de qualidade.",
      "Criar campanhas pagas.",
      "Consultar métricas.",
      "Usar Inteligência Artificial.",
      "Conversar com o Ícaro.",
      "Acessar storage diretamente.",
      "Enviar caminhos locais, file:// ou artifacts/ diretamente para providers reais.",
      "Conversar diretamente com a API da Meta ou qualquer provider concreto de publicação.",
      "Chamar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
