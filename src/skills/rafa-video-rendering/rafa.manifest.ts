import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const rafaVideoRenderingManifest: SkillManifest = {
  id: "rafa-video-rendering",
  name: "Rafa",
  version: "0.1.0",
  description: "Especialista em Renderização/Geração de Vídeo, quarta etapa da pipeline de vídeo do Zuno, posicionado depois do Diego, responsável por transformar o plano técnico de edição de Diego em um pacote de vídeo pronto para renderização — vídeo vertical 9:16 para Reels, TikTok e Shorts. Nesta primeira versão, Rafa opera exclusivamente em Developer Assisted Mode (igual ao Pedro): não existe provider real de vídeo nem chamada a API externa — Rafa monta o prompt técnico final e o caminho exato onde o vídeo deve ser salvo, e aguarda a IA desenvolvedora criar o arquivo real em disco antes de continuar.",
  author: "Zuno",
  capabilities: ["video_rendering"],
  inputs: [
    {
      name: "video_rendering_request",
      description: "Solicitação de renderização de vídeo contendo identificação do cliente (clientId ou tenantId), pedido original, estratégia do João, roteiro estruturado de Bruno, direção audiovisual estruturada de Vanessa, plano técnico de edição estruturado de Diego, canal, formato e objetivo do vídeo.",
    },
  ],
  outputs: [
    {
      name: "structured_video_rendering",
      description: "Pacote de renderização estruturado com prompt técnico final, caminho esperado do arquivo final, especificações técnicas (formato, resolução, duração, proporção, fps, codecs), assets necessários, instruções finais de renderização, artefato de vídeo registrado após validação do arquivo real, observações e próximos passos.",
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
      name: "ArtifactDeliveryPort",
      version: "0.1.0",
      optional: false,
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
      "Consultar Clara para obter identidade visual, marca e publicação.",
      "Montar o prompt técnico final de renderização a partir da estratégia do João, do roteiro de Bruno, da direção de Vanessa e do plano de edição de Diego.",
      "Definir especificações técnicas do vídeo: formato, resolução, duração, proporção, fps e codecs esperados.",
      "Informar o caminho exato onde o vídeo final deve ser salvo.",
      "Verificar, via ArtifactDeliveryPort, se o vídeo esperado já existe em disco.",
      "Validar extensão, tamanho e metadados básicos do arquivo de vídeo salvo.",
      "Pausar o workflow (status needs_assisted_generation) enquanto o vídeo esperado não existir ou não for válido.",
      "Registrar o artefato de vídeo somente depois que o arquivo real for validado.",
      "Registrar riscos, observações e próximos passos.",
    ],
    forbidden: [
      "Criar roteiro.",
      "Dirigir vídeo (definir enquadramento, composição visual, movimento de câmera, luz ou cor).",
      "Editar o conteúdo conceitualmente (redefinir timeline, cortes, legendas, textos na tela, transições ou efeitos definidos por Diego).",
      "Publicar vídeo em qualquer rede social.",
      "Chamar qualquer API externa de geração ou renderização de vídeo.",
      "Gerar vídeo fake ou criar um placeholder fingindo ser um vídeo real.",
      "Criar imagens finais.",
      "Definir layout, grid, paleta ou tipografia de peças visuais estáticas.",
      "Criar campanhas.",
      "Consultar métricas.",
      "Chamar Meta.",
      "Chamar Instagram.",
      "Chamar Facebook.",
      "Acessar storage ou o sistema de arquivos diretamente (apenas via ArtifactDeliveryPort).",
      "Conversar diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA.",
      "Executar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
