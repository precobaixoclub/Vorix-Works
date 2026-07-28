import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";

export const pedroImageGenerationManifest: SkillManifest = {
  id: "pedro-image-generation",
  name: "Pedro",
  version: "0.2.0",
  description: "Especialista em Geração de Imagens responsável por transformar o briefing de design detalhado da Bianca em uma imagem ou conjunto de imagens em padrão profissional, gerando via IcaroBrainPort (modo ai_provider) ou via intervenção assistida da IA desenvolvedora (modo developer_assisted, oficial na CLI local — não existe geração de imagem nativa no Claude Code), e montando uma página local de entrega dos artefatos.",
  author: "Zuno",
  capabilities: ["image_generation"],
  inputs: [
    {
      name: "image_generation_request",
      description: "Solicitação de geração de imagem contendo identificação do cliente (clientId ou tenantId), pedido original, especificação de design completa da Bianca (grid, hierarquia, tipografia, posição/destaque de CTA, composição de capa de Reels quando aplicável, regras de contraste, diretrizes de acessibilidade visual e regras de padronização visual), briefing estruturado que a Bianca preparou para Pedro, canal, formato, quantidade de imagens e proporção desejada. Pedro nunca decide nenhum desses aspectos — apenas executa fielmente o que a Bianca já definiu.",
    },
  ],
  outputs: [
    {
      name: "structured_image_generation",
      description: "Quando completo: resumo da geração, prompt final utilizado, relatório de prontidão visual, modo de geração (ai_provider ou developer_assisted), quantidade de imagens geradas, imagens geradas, artefatos, caminhos da página HTML de entrega (com preview em zoom/navegação entre slides, resumo de execução com tempo e consumo estimado, relatório das Skills anteriores e comandos para regenerar e publicar), imagens locais, caption.txt, metadata.json, ZIP quando houver carrossel, provider e modelo utilizados, custo estimado e real, tempo de execução, warnings, observações e próximos passos. Quando aguardando geração assistida (status needs_assisted_generation): instrução, prompt técnico e caminho exato esperado por imagem, e comando para retomar o workflow depois que o arquivo existir.",
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
      optional: false,
    },
    {
      name: "StoragePort",
      version: "0.1.0",
      optional: true,
    },
    {
      name: "ArtifactDeliveryPort",
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
      "Consultar Clara para obter identidade visual, marca e publicação.",
      "Validar se o briefing de produção da Bianca possui informações suficientes para uma peça em padrão profissional.",
      "Montar o prompt final de geração de imagem a partir do briefing de design da Bianca.",
      "Solicitar geração de imagem ao Ícaro usando IcaroBrainPort.",
      "Persistir os arquivos gerados usando StoragePort, somente quando essa porta estiver configurada.",
      "Salvar imagens base64 em arquivos físicos por meio de ArtifactDeliveryPort, quando configurada.",
      "Gerar página HTML local de entrega com preview em zoom e navegação entre slides, download real, abertura em nova aba, cópia de legenda, hashtags e CTA, resumo de execução (tempo e consumo estimado), relatório das Skills anteriores, comandos para regenerar e publicar, metadata e ZIP de carrossel.",
      "Criar artefatos estruturados de imagem única ou carrossel.",
      "Em modo developer_assisted: montar prompt técnico e caminho esperado por imagem, verificar via ArtifactDeliveryPort se o arquivo já existe em disco, validar que é um PNG real e plausível, e sinalizar needs_assisted_generation enquanto o arquivo não existir.",
    ],
    forbidden: [
      "Criar estratégia de marketing.",
      "Criar copy.",
      "Criar direção de arte.",
      "Tomar decisões de layout, grid, hierarquia visual, espaçamento ou posicionamento de elementos — isso é responsabilidade exclusiva da Bianca.",
      "Publicar em redes sociais.",
      "Criar campanhas.",
      "Consultar métricas.",
      "Acessar storage diretamente sem usar StoragePort ou ArtifactDeliveryPort.",
      "Conversar diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA concreto.",
      "Executar comandos externos, processos (child_process) ou scripts arbitrários para gerar imagem.",
      "Apresentar um arquivo fake, vazio ou de resolução implausível como se fosse uma imagem real gerada.",
      "Chamar Ana.",
      "Chamar outra Skill diretamente.",
    ],
  },
  owner: "helena-managed",
};
