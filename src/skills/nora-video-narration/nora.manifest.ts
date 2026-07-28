import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const noraVideoNarrationManifest: SkillManifest = {
  id: "nora-video-narration",
  name: "Nora",
  version: "0.1.0",
  description: "Especialista em Narração e Direção de Voz para vídeos do Zuno, responsável por transformar o roteiro de Bruno e a timeline de Diego em locução natural, segmentada, sincronizada e pronta para Rafa mixar no vídeo.",
  author: "Zuno",
  capabilities: ["video_narration"],
  inputs: [
    {
      name: "video_narration_request",
      description: "Solicitação de narração contendo estratégia do João, roteiro de Bruno, direção de Vanessa, timeline de Diego, cliente, público, tom de voz, idioma e duração total.",
    },
  ],
  outputs: [
    {
      name: "structured_video_narration",
      description: "Plano estruturado de narração com perfil de voz, roteiro falado, segmentos por cena, tempos, pausas, emoções, ênfases, pronúncias, instruções para provider de voz, arquivo de áudio validado e briefing para Rafa.",
    },
  ],
  dependencies: [
    { name: "ValentinaTenantPort", version: "0.1.0", optional: false },
    { name: "ClaraKnowledgePort", version: "0.1.0", optional: false },
    { name: "ArtifactDeliveryPort", version: "0.1.0", optional: false },
    { name: "NarrationProviderPort", version: "0.1.0", optional: true },
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
      "Consultar Valentina para resolver o cliente.",
      "Consultar Clara para obter tom de voz, identidade verbal, público e preferências de marca.",
      "Transformar o roteiro de Bruno em locução natural, sem repetir literalmente headlines da tela.",
      "Sincronizar a locução com a timeline de Diego.",
      "Definir ritmo, pausas, emoção, ênfase, velocidade, volume e pronúncia.",
      "Solicitar geração assistida de voz em LOCAL_PRODUCTION.",
      "Validar arquivo físico de narração antes de liberar Rafa.",
      "Entregar briefing estruturado para Rafa mixar voz, música e efeitos.",
    ],
    forbidden: [
      "Renderizar vídeo.",
      "Editar vídeo.",
      "Escolher imagens.",
      "Publicar conteúdo.",
      "Criar campanha.",
      "Alterar roteiro, direção visual ou plano de edição conceitual.",
      "Chamar Meta, Instagram, Facebook ou qualquer rede social.",
      "Conversar diretamente com providers pagos de voz.",
      "Executar Bruno, Vanessa, Diego, Rafa ou qualquer outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
