import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { IcaroAIRequest, IcaroAIResponse } from "../../application/ai/icaro.types.js";

/**
 * Provider de IA determinístico, usado EXCLUSIVAMENTE para testes automatizados e demonstração
 * local (nunca pela CLI em uso real — ver `src/interfaces/cli/run-command.ts`, que usa o Pedro em
 * modo "developer_assisted" para imagens). NÃO é uma integração real de IA — não chama OpenAI,
 * Gemini, Claude, nenhum comando externo (`child_process`) nem qualquer provider externo (ADR
 * 0003: local-first, sem infraestrutura externa nesta fase). Devolve sempre o mesmo tipo de
 * resposta estruturada para cada Especialista, na forma exata que cada Skill espera de
 * `IcaroBrainPort.request`, para que o fluxo completo (Arthur → Caio → Helena → Skills) possa ser
 * exercitado de ponta a ponta em testes sem depender de nenhum provider real configurado.
 *
 * Para `pedro-image-generation`, o conteúdo devolvido contém bytes fictícios (não uma imagem
 * real) — suficiente para os testes exercitarem o pipeline de artefatos (arquivo físico, HTML,
 * ZIP, caption, metadata), nunca para ser apresentado a um usuário final como imagem real.
 *
 * Extraído de `tests/organic-cycle.e2e.test.mjs` (antes vivia só dentro do teste) para que o
 * mesmo comportamento determinístico seja compartilhado pelos testes automatizados, em vez de
 * duas implementações divergentes.
 */
export class DeterministicFakeIcaroProvider implements IcaroBrainPort {
  readonly calls: IcaroAIRequest[] = [];

  async request(request: IcaroAIRequest): Promise<IcaroAIResponse> {
    this.calls.push(request);

    const providerId = "fake-icaro-provider";

    return {
      status: "completed",
      provider: { id: providerId, name: "Fake Icaro Provider (somente testes/demonstração)" },
      model: { id: this.modelFor(request.specialistId) },
      durationMs: 4,
      tokens: {
        input: request.prompt.length,
        output: 120,
        total: request.prompt.length + 120,
      },
      cost: { estimated: 0, actual: 0, currency: "USD" },
      content: this.contentFor(request),
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId },
      fallbackUsed: false,
    };
  }

  private modelFor(specialistId: string): string {
    const models: Record<string, string> = {
      "joao-marketing-strategy": "fake-strategy-model",
      "maria-copywriting": "fake-copy-model",
      "sofia-art-direction": "fake-art-direction-model",
      "bianca-social-media-design": "fake-design-model",
      "pedro-image-generation": "fake-image-model",
      "lucas-quality-review": "fake-review-model",
    };
    return models[specialistId] ?? "fake-generic-model";
  }

  private contentFor(request: IcaroAIRequest): string {
    const scenario = scenarioFor(request);
    if (request.specialistId === "joao-marketing-strategy") return joaoEnhancementJson(scenario);
    if (request.specialistId === "maria-copywriting") return mariaCopyJson(scenario, request);
    if (request.specialistId === "sofia-art-direction") return sofiaEnhancementJson(scenario);
    if (request.specialistId === "bianca-social-media-design") return biancaEnhancementJson(scenario);
    if (request.specialistId === "pedro-image-generation") {
      const imageCount = typeof request.context?.imageCount === "number" ? request.context.imageCount : 1;
      return pedroImagesJson(imageCount);
    }
    if (request.specialistId === "lucas-quality-review") return lucasEnhancementJson();
    throw new Error(`Especialista não mapeado no DeterministicFakeIcaroProvider: ${request.specialistId}`);
  }
}

type DemoScenario = "gift_list" | "collaborative_album";

function scenarioFor(request: IcaroAIRequest): DemoScenario {
  const haystack = [
    request.prompt,
    JSON.stringify(request.context ?? {}),
  ].join(" ").toLowerCase();

  if (
    haystack.includes("álbum colaborativo")
    || haystack.includes("album colaborativo")
    || haystack.includes("google drive")
    || haystack.includes("telão")
    || haystack.includes("telao")
    || haystack.includes("enviar fotos")
    || haystack.includes("fotos dos convidados")
    || haystack.includes("fotos lindas")
  ) {
    return "collaborative_album";
  }

  return "gift_list";
}

function joaoEnhancementJson(scenario: DemoScenario): string {
  if (scenario === "collaborative_album") {
    return JSON.stringify({
      angle: "As fotos espontâneas dos convidados viram lembranças organizadas sem os noivos precisarem pedir uma por uma depois da festa.",
      centralPromise: "Registrar cada olhar, abraço e bastidor do casamento em um álbum colaborativo simples, rápido e centralizado.",
      valueProposition: "O Rumo ao Altar transforma um QR Code em uma ponte direta entre convidados, site, telão e Google Drive dos noivos.",
      keyMessages: [
        "Convidados escaneiam o QR Code e enviam fotos pelo celular, sem instalar aplicativo.",
        "Os noivos escolhem se as fotos aparecem automaticamente ou só depois de aprovação.",
        "Todas as fotos ficam salvas na pasta do Google Drive configurada pelos noivos.",
      ],
      risks: [
        "Evitar prometer curadoria automática de qualidade das fotos.",
        "Explicar aprovação como escolha dos noivos, não como regra obrigatória.",
      ],
    });
  }

  return JSON.stringify({
    angle: "Presentear por Pix sem climão, com praticidade para convidados e controle para os noivos.",
    centralPromise: "Transformar a lista de presentes em uma experiência simples, bonita e direta.",
    valueProposition: "A marca centraliza site, presentes via Pix e QR Codes em um fluxo leve para o casal.",
    keyMessages: [
      "Convidados presenteiam por Pix direto para os noivos.",
      "O casal acompanha tudo pelo painel.",
      "O link do site pode ser compartilhado antes e durante o evento.",
    ],
    risks: ["Evitar prometer aprovação instantânea de qualquer pagamento fora do provedor configurado."],
  });
}

function mariaCopyJson(scenario: DemoScenario, request?: IcaroAIRequest): string {
  if (scenario === "collaborative_album") {
    const caption = [
      "Sabe aquelas fotos lindas do casamento que ficam perdidas no celular dos convidados? 📸",
      "A madrinha registra a entrada. Um amigo pega uma risada espontânea. Alguém filma aquele abraço que os noivos nem viram na hora.",
      "O problema é que, depois da festa, começa a missão: “me manda as fotos?”, “você gravou aquele momento?”, “onde ficou aquela imagem?”. E muita lembrança acaba espalhada em conversas, grupos e celulares diferentes.",
      "Com o álbum colaborativo do Rumo ao Altar, os convidados apontam a câmera para um QR Code e enviam as fotos direto do celular — sem instalar aplicativo, sem complicação e quantas vezes quiserem. ✨",
      "Os noivos ainda escolhem como querem exibir tudo: com aprovação antes de aparecer no site e no telão, ou de forma automática. E, independentemente dessa escolha, as fotos ficam salvas na pasta do Google Drive configurada pelo casal.",
      "No fim, as lembranças ficam centralizadas, organizadas e prontas para reviver o grande dia sem precisar correr atrás de ninguém. 💌",
      "Você também iria querer receber as fotos dos convidados assim? Comenta aqui. 👇",
      "Salva este post para lembrar dessa ideia e compartilha com um casal que está preparando o casamento.",
    ].join("\n");
    const cta = "Conheça o Rumo ao Altar em rumoaoaltar.com.br e crie seu álbum colaborativo.";
    const hashtags = [
      "#RumoAoAltar",
      "#AlbumColaborativo",
      "#FotosDoCasamento",
      "#QRCodeNoCasamento",
      "#SiteDeCasamento",
      "#CasamentoDigital",
      "#Noivos",
      "#Noivas",
      "#Noivos2026",
      "#OrganizacaoDeCasamento",
      "#PlanejamentoDeCasamento",
      "#DicasParaNoivos",
      "#Cerimonialista",
      "#CasamentoBrasil",
      "#WeddingPlanning",
      "#CasamentoSemStress",
      "#MemoriasDoCasamento",
      "#FotografiaDeCasamento",
      "#GoogleDrive",
      "#TelãoDeCasamento",
    ];
    return JSON.stringify({
      title: "As fotos dos convidados, todas em um só lugar",
      caption,
      cta,
      hashtags,
      publication: [caption, cta, hashtags.join(" ")].join("\n\n"),
      keywords: ["casamento", "noivos", "álbum colaborativo", "qr code", "google drive"],
      summary: "Copy orgânica com história real, dor pós-festa, solução por QR Code e CTA para cadastro no Rumo ao Altar.",
      objective: "Mostrar aos noivos como centralizar fotos dos convidados em um álbum colaborativo simples.",
      toneUsed: "leve moderno emocional persuasivo",
      identifiedAudience: "Noivos que querem organizar as lembranças do casamento sem depender de pedidos manuais aos convidados",
      futureSuggestions: [
        "Criar Stories com demonstração visual do convidado escaneando o QR Code.",
        "Criar um Reels mostrando o antes e depois: fotos espalhadas vs. álbum centralizado.",
      ],
      observations: ["CTA e palavra obrigatória alinhados ao contexto da Clara."],
    });
  }

  const isStory = request ? isStoryCopyRequest(request) : false;

  if (isStory) {
    const caption = [
      "Pix enviado, presente recebido — sem pedacinho ficando pelo caminho. 💌",
      "No Rumo ao Altar, a lista de presentes com taxa zero deixa tudo mais simples: o convidado presenteia por Pix e o valor cai direto na conta dos noivos.",
      "Sem intermediários. Sem desconto na lista. Só o carinho chegando inteiro para o casal. ✨",
      "Responde esse Story: você também preferiria presentear assim? Salva e compartilha com quem está montando o site do casamento.",
    ].join("\n");
    const cta = "Conheça o Rumo ao Altar no link da bio.";
    const hashtags = [
      "#RumoAoAltar",
      "#TaxaZero",
      "#ListaDePresentes",
      "#ListaDeCasamento",
      "#PixParaNoivos",
      "#CasamentoComPix",
      "#SiteDeCasamento",
      "#CasamentoDigital",
      "#Noivos",
      "#Noivas",
      "#Noivos2026",
      "#OrganizacaoDeCasamento",
      "#PlanejamentoDeCasamento",
      "#CasamentoSemStress",
      "#DicasParaNoivos",
      "#WeddingPlanning",
    ];
    return JSON.stringify({
      title: "Pix direto para os noivos",
      caption,
      cta,
      hashtags,
      publication: [caption, cta, hashtags.join(" ")].join("\n\n"),
      keywords: ["casamento", "noivos", "presentes", "pix"],
      summary: "Copy curta de Story com curiosidade, benefício de taxa zero e chamada para link da bio.",
      objective: "Gerar curiosidade rápida sobre lista de presentes com taxa zero e levar ao link da bio.",
      toneUsed: "leve divertido persuasivo",
      identifiedAudience: "Noivos que querem uma lista de presentes simples, direta e sem taxas",
      futureSuggestions: ["Criar sequência de Stories com enquete sobre preferência por Pix."],
      observations: ["CTA adaptado para Story mantendo a marca Rumo ao Altar."],
    });
  }

  const caption = [
    "E se a lista de presentes do casamento não comesse um pedacinho do presente dos noivos? 💌",
    "",
    "Essa é uma daquelas dores pequenas que viram incômodo grande: o convidado quer presentear com carinho, os noivos querem receber com organização… e, no meio do caminho, aparecem taxas, dúvidas e aquela bagunça de comprovantes.",
    "",
    "Com o Rumo ao Altar, a lista de presentes fica simples, bonita e direta: o convidado presenteia por Pix e todo valor arrecadado cai direto na conta dos noivos. Sem taxa na lista. Sem climão. Sem o casal precisar virar central de atendimento no meio dos preparativos. ✨",
    "",
    "O melhor: tudo fica organizado no painel, pronto para acompanhar antes, durante e depois do grande dia.",
    "",
    "Você acha que os convidados preferem presentear por Pix quando o processo é fácil assim? Comenta aqui. 👇",
    "",
    "Salva este post para lembrar dessa ideia e compartilha com aquele casal que está montando o site do casamento agora.",
  ].join("\n");
  const cta = "Conheça o Rumo ao Altar e crie uma lista de presentes com taxa zero.";
  const hashtags = [
    "#RumoAoAltar",
    "#TaxaZero",
    "#ListaDePresentes",
    "#ListaDeCasamento",
    "#PresentesDeCasamento",
    "#PixParaNoivos",
    "#CasamentoComPix",
    "#SiteDeCasamento",
    "#CasamentoDigital",
    "#Noivos",
    "#Noivas",
    "#Noivos2026",
    "#OrganizacaoDeCasamento",
    "#PlanejamentoDeCasamento",
    "#CasamentoSemStress",
    "#CasamentoBrasil",
    "#DicasParaNoivos",
    "#Cerimonialista",
    "#ConviteDigital",
    "#WeddingPlanning",
  ];
  return JSON.stringify({
    title: "Presentear ficou fácil — e sem climão",
    caption,
    cta,
    hashtags,
    publication: [caption, cta, hashtags.join(" ")].join("\n\n"),
    keywords: ["casamento", "noivos", "presentes", "pix"],
    summary: "Copy orgânica com hook, dor, benefício, solução, CTA e hashtags para explicar lista de presentes com taxa zero.",
    objective: "Explicar presentes via Pix e gerar interesse pela plataforma.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: ["Criar uma versão em stories mostrando o QR Code da lista de presentes."],
    observations: ["CTA e palavra obrigatória alinhados ao contexto da Clara."],
  });
}

function isStoryCopyRequest(request: IcaroAIRequest): boolean {
  const haystack = [request.prompt, JSON.stringify(request.context ?? {})].join(" ").toLowerCase();
  return /\bstory\b/.test(haystack) || /\bstories\b/.test(haystack);
}

function sofiaEnhancementJson(scenario: DemoScenario): string {
  if (scenario === "collaborative_album") {
    return JSON.stringify({
      visualConcept: "Casamento real em clima espontâneo, convidados fotografando pelo celular e um QR Code elegante como portal para o álbum colaborativo.",
      recommendedStyle: "Editorial romântico moderno, tecnológico com delicadeza, luz suave e composição limpa.",
      emotionalTone: "Nostalgia feliz e alívio: a sensação de não perder nenhuma lembrança importante.",
      moodboard: [
        "Convidados sorrindo com celulares durante a festa",
        "QR Code em placa elegante sobre mesa de casamento",
        "Mosaico de fotos afetivas indo para uma nuvem/Drive",
        "Telão discreto exibindo memórias aprovadas",
      ],
      designReferences: [
        "Campanhas premium de wedding tech com fotografia documental.",
        "Layouts editoriais com cards translúcidos, QR Code e microinterações visuais.",
      ],
    });
  }

  return JSON.stringify({
    visualConcept: "Carrossel editorial com casal sorrindo, QR Code estilizado e elementos de Pix tratados como detalhe elegante.",
    recommendedStyle: "Editorial romântico moderno com humor sutil e composição limpa.",
    emotionalTone: "Leveza e confiança, sem soar comercial demais.",
    moodboard: ["Casal em clima espontâneo", "QR Code decorativo", "Envelope de presente"],
    designReferences: ["Carrosséis editoriais de casamento com humor sutil."],
  });
}

function biancaEnhancementJson(scenario: DemoScenario): string {
  if (scenario === "collaborative_album") {
    return JSON.stringify({
      gridSystem: "Grid vertical de 12 colunas com margem lateral de 8%, cards arredondados e área segura reforçada para Stories e feed mobile.",
      visualHierarchyStrategy: "Foto emocional ou QR Code em destaque, depois promessa curta sobre guardar lembranças, depois CTA para cadastro no Rumo ao Altar.",
      colorApplication: "Usar rosa da marca como acento emocional, preto para hierarquia textual e branco/off-white como base respirável.",
      componentStyle: [
        "QR Code em card branco com borda rosa suave e sombra editorial leve.",
        "Mini cards de fotos empilhadas para representar lembranças centralizadas.",
        "Ícones lineares discretos para câmera, nuvem/Drive, aprovação e telão.",
      ],
      illustrationStyle: "Fotografia editorial de casamento combinada com elementos gráficos limpos de QR Code, galeria e nuvem.",
      mockupStyle: "Mockup de celular opcional mostrando envio de foto, sempre secundário ao momento emocional do casamento.",
    });
  }

  return JSON.stringify({
    gridSystem: "Grid de 12 colunas por slide, com margem lateral de 8% e grade repetida em todos os slides.",
    visualHierarchyStrategy: "Casal e presente em destaque, depois promessa do post, depois CTA para conhecer a plataforma.",
    colorApplication: "Aplicar a cor de marca como dominante e o neutro registrado na identidade como contraste de texto.",
    componentStyle: ["Cards com cantos levemente arredondados para o QR Code.", "Ícone Pix com traço fino e consistente."],
    illustrationStyle: "Fotografia espontânea do casal com tratamento de cor consistente entre slides.",
    mockupStyle: "Nenhum mockup obrigatório para este carrossel.",
  });
}

function pedroImagesJson(count: number): string {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 1;
  return JSON.stringify({
    images: Array.from({ length: safeCount }, (_value, index) => ({
      altText: `Slide ${index + 1} gerado pelo Pedro (demonstração)`,
      mimeType: "image/png",
      width: 1080,
      height: 1350,
      data: Buffer.from(`fake-image-bytes-slide-${index + 1}`).toString("base64"),
    })),
  });
}

function lucasEnhancementJson(): string {
  return JSON.stringify({
    additionalObservations: ["O pacote está coerente com o objetivo orgânico e pronto para dry run."],
    additionalSuggestions: ["Testar uma segunda variação com foco em QR Code para evento presencial."],
  });
}
