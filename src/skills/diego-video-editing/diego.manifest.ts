import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const diegoVideoEditingManifest: SkillManifest = {
  id: "diego-video-editing",
  name: "Diego",
  version: "0.1.0",
  description: "Especialista em Edição de Vídeo, terceira etapa da pipeline de vídeo do Zuno, posicionado depois da Vanessa, responsável por transformar a direção audiovisual de Vanessa em um plano técnico de edição para Reels, TikTok, Shorts e vídeos verticais — timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena, textos na tela, transições, efeitos visuais, efeitos sonoros, trilha sugerida, assets necessários, instruções de edição e checklist técnico.",
  author: "Zuno",
  capabilities: ["video_editing"],
  inputs: [
    {
      name: "video_editing_request",
      description: "Solicitação de plano de edição contendo identificação do cliente (clientId ou tenantId), pedido original, estratégia do João, roteiro estruturado de Bruno, direção audiovisual estruturada de Vanessa, canal, formato e objetivo do vídeo.",
    },
  ],
  outputs: [
    {
      name: "structured_editing_plan",
      description: "Plano técnico de edição estruturado com timeline (ordem das cenas, cortes, duração de cada trecho, legenda por cena, texto na tela, transição, efeitos visuais e sonoros), plano de trilha, assets necessários, instruções de edição, checklist técnico, riscos, observações, próximos passos e briefing estruturado para a futura Skill Rafa.",
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
      "Consultar Clara para obter identidade visual, marca, público, conteúdo e publicação.",
      "Solicitar apoio opcional ao Ícaro para aprimorar o plano de edição.",
      "Funcionar totalmente sem Ícaro, apenas com heurística, o roteiro de Bruno, a direção de Vanessa e o contexto da Clara.",
      "Transformar o roteiro de Bruno e a direção audiovisual de Vanessa em um plano técnico de edição: timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena, textos na tela, transições, efeitos visuais, efeitos sonoros, trilha sugerida, assets necessários.",
      "Registrar instruções de edição e checklist técnico.",
      "Registrar riscos e observações.",
      "Montar o briefing estruturado que será enviado para a futura Skill Rafa.",
    ],
    forbidden: [
      "Criar roteiro.",
      "Dirigir vídeo (definir enquadramento, composição visual, movimento de câmera, luz ou cor).",
      "Redefinir cenas, tempo por cena, texto falado, texto na tela, enquadramento ou composição visual definidos por Bruno ou Vanessa.",
      "Renderizar vídeo.",
      "Publicar vídeo.",
      "Gerar vídeo final.",
      "Criar imagens finais.",
      "Definir layout, grid, paleta ou tipografia de peças visuais estáticas.",
      "Publicar em redes sociais.",
      "Criar campanhas.",
      "Consultar métricas.",
      "Chamar Meta.",
      "Chamar Instagram.",
      "Chamar Facebook.",
      "Acessar storage diretamente.",
      "Conversar diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA.",
      "Executar o Rafa ou qualquer outra Skill futura da pipeline de vídeo.",
      "Chamar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
