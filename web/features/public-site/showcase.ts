export const MODULE_KEYS = ["conversations", "marketing", "site", "meetings"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ProductShot = { asset: string; title: string; description: string; alt: string };
type ModuleShowcase = {
  name: string;
  slug: string;
  title: string;
  description: string;
  benefits: readonly string[];
  shots: readonly [ProductShot, ...ProductShot[]];
  availability: string;
  capacity: string;
  faq: readonly (readonly [string, string])[];
};

export const MODULE_SHOWCASE: Record<ModuleKey, ModuleShowcase> = {
  conversations: {
    name: "Conversas", slug: "conversas",
    title: "Transforme conversas em oportunidades de negócio.",
    description: "Atenda pelo WhatsApp, organize sua equipe, acompanhe oportunidades e prepare propostas sem perder o histórico dos clientes.",
    benefits: ["Atendimento em equipe", "Histórico centralizado", "Funil de oportunidades", "Propostas comerciais", "Tarefas e acompanhamento", "Indicadores operacionais"],
    shots: [
      { asset: "inbox", title: "Caixa de entrada da equipe", description: "Acompanhe a fila, veja quem está atendendo e consulte o contexto do cliente na própria conversa.", alt: "Caixa de entrada da Vorix com fila, conversa selecionada e painel do cliente demonstrativo" },
      { asset: "pipeline", title: "Funil comercial", description: "Acompanhe oportunidades por etapa e mantenha a responsabilidade por cada negociação visível para a equipe.", alt: "Kanban real de oportunidades da Vorix com colunas de negociação e responsáveis" },
      { asset: "proposal", title: "Propostas comerciais", description: "Monte propostas na mesma operação e acompanhe o aceite e o próximo passo da negociação.", alt: "Proposta comercial aberta na Vorix com cliente, itens e valores fictícios" },
    ],
    availability: "O WhatsApp é conectado à conta da empresa. Permissões e capacidade seguem o plano.",
    capacity: "Os planos incluem usuários, conexões WhatsApp e créditos. O configurador compara o valor para a equipe inteira e cobra adicionais somente acima da capacidade incluída.",
    faq: [
      ["O CRM faz parte de Conversas?", "Sim. Conversas inclui atendimento, oportunidades, tarefas e propostas no fluxo comercial compartilhado."],
      ["Posso adicionar usuários ou WhatsApps depois?", "Sim. O responsável pela conta pode consultar a capacidade e simular alterações em Conta e assinatura, conforme o contrato."],
    ],
  },
  marketing: {
    name: "Marketing", slug: "marketing",
    title: "Sua marca criando conteúdos com inteligência artificial.",
    description: "Organize ideias, produza artes e legendas com IA, revise materiais e planeje suas publicações em um único ambiente.",
    benefits: ["Bolsão de ideias", "Artes e legendas com IA", "Identidade visual da marca", "Revisão de conteúdos", "Calendário editorial", "Publicações nas integrações liberadas"],
    shots: [
      { asset: "ideas", title: "Bolsão de ideias", description: "Organize pautas da equipe por formato e acompanhe o status de cada ideia.", alt: "Bolsão de ideias real da Vorix com pautas demonstrativas, formatos e status" },
      { asset: "create", title: "Criação com IA", description: "Parta de uma ideia e oriente a criação de arte e legenda com referências da marca.", alt: "Tela real Criar conteúdo da Vorix com opções de formato, briefing e referências" },
      { asset: "review", title: "Revisão da peça", description: "Veja a arte e a legenda juntas para decidir se a peça está pronta.", alt: "Tela de Revisão da Vorix com arte demonstrativa e legenda correspondente" },
      { asset: "calendar", title: "Calendário editorial", description: "Planeje a semana distinguindo as ideias previstas das publicações da equipe.", alt: "Calendário unificado real da Vorix com ideias e publicações demonstrativas" },
    ],
    availability: "Criação e revisão seguem o acesso e os créditos da conta. A publicação depende das redes habilitadas.",
    capacity: "Marcas, redes e consumo de IA são avaliados com o time comercial. A criação, a revisão, a aprovação e a administração usam as permissões já existentes da conta.",
    faq: [
      ["A IA publica a peça automaticamente?", "A equipe pode revisar a arte e a legenda antes do envio. A publicação depende das permissões, da configuração de aprovação e da rede habilitada."],
      ["Como contratar Marketing?", "O time comercial pode confirmar acesso, marcas e consumo de IA para sua operação."],
    ],
  },
  site: {
    name: "Site", slug: "site",
    title: "Crie um site profissional para apresentar e vender.",
    description: "Escolha um modelo, personalize a identidade da sua empresa, organize produtos e publique sua presença digital com facilidade.",
    benefits: ["Modelos e personalização", "Site responsivo", "Catálogo e variações", "Prévia antes da publicação", "Domínio próprio", "Pedidos conforme a configuração"],
    shots: [
      { asset: "site-editor", title: "Editor visual", description: "Configure modelo, aparência, conteúdo, vendas, publicação e domínio no editor da Vorix.", alt: "Editor real da Vorix com as áreas do site e a prévia da loja demonstrativa" },
      { asset: "storefront", title: "Site pronto", description: "Veja como um modelo da Vorix apresenta uma marca, da abertura à navegação pelo site.", alt: "Vitrine demonstrativa renderizada pelo editor de sites da Vorix" },
      { asset: "store-catalog", title: "Catálogo e loja", description: "Apresente fotos, preços e variações e escolha como o visitante entra em contato ou compra.", alt: "Catálogo demonstrativo da Vorix com fotografias, preços e variações de produtos" },
    ],
    availability: "Pagamentos, frete e marketplaces dependem da modalidade de venda e da disponibilidade das integrações.",
    capacity: "O acesso para editar e publicar é dado aos colaboradores autorizados. Condições de domínio, sites adicionais e recursos comerciais são confirmadas para a conta.",
    faq: [
      ["Posso usar um domínio próprio?", "Sim. O editor tem configuração e verificação de domínio para publicação."],
      ["Como a loja recebe pedidos?", "Você configura o canal de venda. WhatsApp, carrinho, checkout online com Mercado Pago e frete dependem dos recursos habilitados para sua operação."],
    ],
  },
  meetings: {
    name: "Meetings", slug: "meetings",
    title: "Grave suas reuniões. A IA organiza o que importa.",
    description: "Grave reuniões, consulte transcrições, receba resumos inteligentes e acompanhe decisões e próximos passos.",
    benefits: ["Agenda e gravação", "Transcrição automática", "Resumos com IA", "Decisões e próximos passos", "Histórico organizado"],
    shots: [
      { asset: "recording", title: "Como gravar", description: "Envie um arquivo, grave o áudio presencial pelo microfone ou use o robô no Meet quando habilitado.", alt: "Interface real de gravação da Vorix com opções de robô no Meet, microfone e envio de arquivo" },
      { asset: "transcript", title: "Transcrição", description: "Consulte o registro por trecho, com marcações de tempo e identificação de falantes quando disponível.", alt: "Transcrição demonstrativa no Meetings com falantes e marcações de tempo" },
      { asset: "meeting-ai", title: "Análise por IA", description: "Revise o resumo e os principais assuntos tratados na reunião.", alt: "Análise real do Meetings com resumo e assuntos de uma reunião fictícia" },
      { asset: "recording-library", title: "Histórico de gravações", description: "Encontre reuniões anteriores e acompanhe o estado de processamento de cada gravação.", alt: "Biblioteca real de gravações do Meetings com estados de processamento" },
      { asset: "meeting-actions", title: "Decisões e próximos passos", description: "Consulte as decisões, as tarefas e os responsáveis que saíram da reunião.", alt: "Painel real de decisões e tarefas com responsáveis demonstrativos no Meetings" },
    ],
    availability: "O robô do Meet e a conexão Google dependem de liberação e configuração. O microfone grava o áudio presencial.",
    capacity: "Gravações simultâneas medem quantas reuniões podem ser gravadas ao mesmo tempo. Contas Google conectadas são infraestrutura operacional. Minutos e retenção seguem a oferta habilitada.",
    faq: [
      ["O que é uma gravação simultânea?", "É a capacidade de gravar uma reunião ao mesmo tempo. Para gravar duas juntas, a conta precisa de duas simultâneas e da infraestrutura disponível."],
      ["Consigo gravar uma reunião presencial?", "O modo presencial usa o microfone. A disponibilidade de gravação por robô, envio e transcrição depende do ambiente e do plano."],
    ],
  },
};

export const productHref = (key: ModuleKey) => `/produtos/${MODULE_SHOWCASE[key].slug}`;
