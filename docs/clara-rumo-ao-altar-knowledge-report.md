# Relatório — Alimentação do Centro de Conhecimento da Clara para o Rumo ao Altar

Nenhum código foi alterado nesta fase. Todo o trabalho foi feito chamando `ClaraKnowledgePort` (via
um script único de alimentação, descartado ao final) contra o repositório real
(`.zuno-data/knowledge.json`), exatamente como qualquer outro consumidor da Clara faria. Um backup
de segurança do arquivo original foi salvo em `.zuno-data/knowledge.backup-20260712-152958.json`
antes de qualquer alteração (nada foi perdido: a Clara também versiona cada registro atualizado).

## 1. Fonte da pesquisa

Como pesquisadora/analista de marketing, usei duas fontes reais em vez de inventar conteúdo:

1. **O código-fonte real do produto**, em `C:\Users\Cleverton\Desktop\Site_Casamento` — um SaaS
   Next.js/Prisma já bastante maduro por trás da marca "Rumo ao Altar". A landing page, o schema do
   banco, o painel do casal, o fluxo de RSVP/Pix/fotos e a página de preços foram lidos diretamente
   do código, não presumidos. Achado importante: o `README.md` desse projeto está desatualizado —
   ele descreve funcionalidades como "próximos passos", mas praticamente todas (edição completa do
   site, RSVP com `inviteToken`, Google Drive real, QR Codes, cobrança via Mercado Pago/Asaas) **já
   estão implementadas**. Usei o código, não o README, como fonte de verdade.
2. **Pesquisa real na web** (julho/2026) sobre concorrentes brasileiros de sites de casamento e
   listas de presentes, com taxas e posicionamento atuais de iCasei, Casar.com, Lejour, Pix do
   Casal, Wedy e Zankyou.

## 2. O que foi cadastrado (resumo por módulo)

**Módulo 1 — Identidade da Marca** (`BrandContext`, atualizado para v2): missão, visão, propósito,
valores, personalidade, arquétipos, nível de formalidade, emojis preferenciais/proibidos, estilo de
comunicação, forma de tratamento, além do posicionamento real (headline da landing page) e CTAs
reais ("Criar meu site", "Ver demonstração"). Palavras proibidas ampliadas com termos que o produto
real não sustenta ("grátis para sempre", "sem limites" — existem limites por plano).

**Módulo 2 — Produto** (`ProductContext`, 13 registros novos, um por funcionalidade): Site do
Casamento, Lista de Presentes via Pix, Taxa Zero sobre Presentes (com comparativo de 5 concorrentes
reais), RSVP/Confirmação de Presença, Cronograma e Planejamento, Álbum Colaborativo, Painel dos
Noivos, Convidados/Mesas/Check-in, Ações da Festa, Telão ao Vivo, Central de QR Codes, Programa para
Cerimonialistas e Fornecedores, e um registro de Visão Geral e Diferenciais (com preços reais dos 3
planos). Cada um com descrição (que já embute a dor resolvida, o gatilho emocional e um exemplo de
uso, já que o schema atual não tem campos próprios para essas três dimensões — ver seção 4),
benefícios, objeções e argumentos de venda.

**Módulo 3 — Personas** (`AudienceContext`, atualizado para v2): 5 personas completas — casal
recém-noivo, casal iniciando o planejamento, cerimonialista, convidado(a) e padrinho/madrinha —
cada uma com dores, medos, sonhos, objeções, gatilhos emocionais, linguagem e canais preferidos, e
estágio de funil.

**Módulo 4 — Marketing** (`MarketingContext`, novo): CTAs reais, ganchos, frameworks de
storytelling, gatilhos mentais, estilos de abertura/fechamento/legenda, formatos preferidos,
objetivos de campanha, calendário sazonal de casamento no Brasil (Dia dos Namorados, Réveillon,
temporadas abril–junho e setembro–novembro), temas já usados nos pilotos reais (taxa zero, RSVP,
álbum colaborativo, cronograma) e temas proibidos.

**Módulo 5 — Direção Criativa** (`IdentityContext`, atualizado para v2): referências visuais,
composição, iluminação, enquadramento, estilo fotográfico, diretrizes de mockup, iconografia,
estilos de fundo, padrões de layout, e os **exemplos aprovados reais** dos pilotos executados em
julho/2026 (selo "TAXA ZERO" no feed, sequência pergunta→resposta→CTA no Story).

**Módulo 6 — Aprendizado** (`LearningContext`, novo): inicializado em estado "cold start" (sem
avaliações reais de Quality Feedback ainda) com 5 recomendações de partida, extraídas de decisões já
validadas tecnicamente nesta sessão (ex.: critérios de qualidade por formato).

**Módulo 7 — Concorrência** (`CompetitionContext`, novo): 7 concorrentes reais (iCasei, Casar.com,
Lejour, Pix do Casal, Wedy, Zankyou, listas tradicionais de loja física) com pontos fortes, pontos
fracos e taxas reais pesquisadas, mais oportunidades e diferenciais do Rumo ao Altar.

**Módulo 8 — Playbook** (`PlaybookContext`, novo): regras da marca, boas práticas, exemplo de
campanha real (os pilotos de taxa zero), campanhas aprovadas reais, e decisões importantes recentes
(Eduardo como autoridade única de formato, avaliação de qualidade por perfil). Nenhuma campanha
reprovada real existe ainda — campo deixado vazio, não inventado.

**Total: 21 registros ativos para `client-rumo`** (4 já existiam e foram enriquecidos; 17 são
novos). Verificado por simulação de `requestContext` do João: as Skills que já existiam continuam
recebendo exatamente os mesmos módulos de antes (nenhum dos 4 módulos novos aparece para quem não os
pede), e `ProductContext` — antes vazio — agora entrega 13 registros reais.

## 3. Lacunas de conhecimento identificadas

- **Nenhuma avaliação real de Quality Feedback existe ainda** — o Módulo 6 (Aprendizado) está em
  estado inicial. Ele vai se popular sozinho conforme execuções reais forem avaliadas com `--rate`.
- **Nenhum exemplo reprovado real** (`rejectedExamples` do Módulo 5, `rejectedCampaigns` do Módulo
  8) — nenhuma peça real do Rumo ao Altar foi reprovada até hoje; os campos foram deixados vazios em
  vez de preenchidos com exemplos inventados.
- **Múltiplos templates visuais**: o painel cita rótulos `classic`, `modern`, `minimalist`, mas só
  `classic` foi confirmado como realmente renderizado nos dados de demonstração — registrado como
  limitação em "Visão Geral e Diferenciais" para não prometer variedade de template sem certeza.
- **Sem depoimentos, página "sobre", termos de uso ou política de privacidade** encontrados no
  código do produto — path relevante para prova social e para peças institucionais/legais.
- **Notificação via WhatsApp** aparece como funcionalidade ainda não implementada (só notificação
  in-app/e-mail) — registrado como limitação.
- **Concorrência**: taxas e posicionamento são de julho/2026 e mudam com frequência nesse mercado —
  recomendo revalidar a cada poucos meses, não tratar como estático.
- **Missão/visão/propósito/arquétipos (Módulo 1)** foram **inferidos** por mim a partir do
  posicionamento e da FAQ reais do produto — nunca foram declarados explicitamente em nenhum lugar
  do código ou de material de marca. É a lacuna mais importante para validar com o dono da marca.

## 4. Decisão de mapeamento (transparência técnica)

O pedido original tinha 7 dimensões por funcionalidade do Módulo 2 (descrição, benefício, dor,
objeções, argumentos, gatilhos emocionais, exemplos de uso), mas `ProductContext` — que eu não podia
alterar — só tem campos dedicados para 4 delas (`description`, `benefits`, `objections`,
`salesArguments`). "Dor que resolve", "gatilho emocional" e "exemplo de uso" foram escritos como
frases claramente rotuladas dentro do próprio campo `description` (texto livre), em vez de
inventados campos novos. Da mesma forma, "diferenciais" (Módulo 1, que não tem esse campo em
`BrandContext`) foi registrado no campo `differentiators` de `ProductContext`, no registro "Visão
Geral e Diferenciais". Isso preserva 100% da informação pedida sem tocar em nenhum tipo/schema.

## 5. Sugestões de informações a levantar diretamente com o dono da marca

1. Missão, visão e propósito declarados oficialmente (hoje são inferência minha, não fonte oficial).
2. Número real de casais/casamentos atendidos até hoje (prova social real — a landing page não
   expõe métrica real, só um mockup ilustrativo).
3. Depoimentos reais de casais e de cerimonialistas.
4. Confirmação de quais templates visuais além de "classic" estão realmente disponíveis hoje.
5. Política de privacidade e termos de uso (não encontrados no código — provavelmente necessários
   antes de qualquer campanha paga ou de captação de leads em maior escala).
6. Casos reais de objeção/dúvida vindos do suporte ao cliente, para enriquecer as objeções hoje
   escritas por inferência de mercado.
7. Exemplos reais de peças já aprovadas ou reprovadas pelo time de marketing (fora dos pilotos
   técnicos desta sessão), para dar mais substância aos Módulos 5 e 8.

## 6. Relatório de maturidade da base de conhecimento

| Módulo | Registros | Preenchimento | Maturidade |
|---|---|---|---|
| 1. Identidade da Marca | 1 | Alto — todos os campos pedidos preenchidos | 🟢 Madura (com ressalva: missão/visão/arquétipos são inferência, a validar) |
| 2. Produto | 13 | Alto — 12 funcionalidades + visão geral, todas com 4-6 dimensões preenchidas | 🟢 Madura |
| 3. Personas | 1 (5 personas) | Alto — todos os campos pedidos, para as 5 personas solicitadas | 🟢 Madura |
| 4. Marketing | 1 | Alto — todos os campos preenchidos com dados reais (CTAs, calendário) | 🟢 Madura |
| 5. Direção Criativa | 1 | Alto, exceto exemplos reprovados (vazio por falta de dado real) | 🟡 Madura com lacuna conhecida |
| 6. Aprendizado | 1 | Estrutural apenas — sem dado histórico real ainda | 🔴 Inicial (cold start, por design) |
| 7. Concorrência | 1 (7 concorrentes) | Alto — dados reais de mercado, mas com validade temporal curta | 🟡 Madura, requer revalidação periódica |
| 8. Playbook | 1 | Alto para o que já existe; sem exemplos reprovados reais | 🟡 Madura com lacuna conhecida |

**Maturidade geral da base: madura para uso imediato em 6 dos 8 módulos**, com duas lacunas
estruturais e conhecidas (Aprendizado ainda sem histórico real; nenhum exemplo reprovado real em
Direção Criativa/Playbook) que se resolvem sozinhas com o uso contínuo do Zuno — não exigem nenhuma
ação adicional além de rodar campanhas reais e avaliá-las.
