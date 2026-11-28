# Diretor Criativo Autônomo (Creative Engine)

Camada compartilhada que **cria** a campanha antes de produzir imagem, carrossel ou vídeo. Antes dela, o piloto
do Bolsão montava peças com o conceito que vinha escrito na pauta e uma composição escolhida por regra.

## Onde fica

| Peça | Arquivo |
|---|---|
| Módulo (brief, schema, seleção, uso pelos motores) | `src/application/creative-engine/creative-director.ts` |
| Piloto: brief no `select`/`video_select`, ação `creative_direction`, biblioteca da marca | `scripts/editorial/codex-social-backend.mjs` |
| Piloto de imagem: 1 chamada de texto antes da geração | `scripts/editorial/codex-social-schedule.mjs` |
| Piloto de vídeo: direção dentro da chamada do plano | `scripts/editorial/codex-social-video.mjs`, `video-director.mjs` |
| Web ("Criar conteúdo com IA"): repertório e briefing na exploração que já existia | `src/application/creative-engine/explore-creative-directions.ts` |
| Componentes conceituais do Remotion | `motion-graphics/src/templates/concept.tsx` |

## Como funciona

1. **Briefing classificado** (determinístico): obrigatório / preferência / sugestão / livre para a IA, e a
   linguagem pedida pelo cliente ("usar suspense" → todas as alternativas honram).
2. **Inventário**: o que já existe (fotos, gravações, telas, logo, referências da biblioteca com a orientação
   que o cliente escreveu), o que a Vorix produz sozinha, o que o motor de imagem gera e o que **não** existe
   (filmagem de pessoas, vídeo realista pago, conteúdo de terceiros) — para conceber só o executável.
3. **Contexto**: marca, pauta, fatos (únicos números/benefícios permitidos), conceitos recentes da marca
   (lidos do rastro das peças — `creative.direction`), aprendizado da memória criativa.
4. **Concepção**: o Codex responde as perguntas do meio (gancho em 2 s, emoção, história, revelação,
   encerramento), concebe **3 conceitos distintos** com notas (impacto, originalidade, viabilidade, marca) e
   escolhe um. Repertório aberto de 17 linguagens — não são templates.
5. **Conferência** (`selectCreativeDirection`): descarta conceito que pede filmagem inexistente, de
   viabilidade ≤ 2, quase igual a um recente da marca (Jaccard ≥ 0,5) ou que ignora a linguagem pedida.
   Mantém a escolha do Codex quando válida; senão escolhe a melhor válida e registra o porquê.
6. **Execução**: imagem — a encenação reordena só entre as composições já permitidas para a tela (a capa, no
   carrossel) e o conceito entra na instrução do gerador e na revisão da cena; vídeo — o plano executa o
   conceito (gancho, recurso visual central, revelação) com os templates existentes e os novos.
7. **Quality Gate**: vídeo ganha `conceptDelivered` (bloqueia) e `originalityScore` (registro); a revisão da
   imagem confere se a cena encena o conceito. Critérios anteriores intactos.

## Custo

- Vídeo: **0 chamada extra** (a direção vem na mesma resposta do plano). Só refaz o plano uma vez se o
  conceito escolhido for inviável.
- Imagem/carrossel: **1 chamada de texto** (~3,6 mil caracteres) antes da geração; refação não a repete.
- Web: **0 chamada extra** (enriquece a exploração de direções que já existia e já era contabilizada).
- Nada é renderizado mais de uma vez para escolher conceito.

## Componentes conceituais (Remotion)

`clock` (relógio que acelera e para), `counter` (número animado — só número presente na pauta; trava em
`dropInventedFigures` e no construtor), `versus` (comparação em tela dividida), `mask_reveal` (imagem revelada
por máscara com paralaxe). Linha do tempo compartilhada com o som (eventos de efeito sonoro nos mesmos
instantes). Prova de render: `scripts/video/concept-templates-proof.mjs`.

## Provas

- Automatizadas: `tests/creative-director.test.mjs` (cenários A–F com respostas simuladas).
- Criativas reais (Codex do piloto, pautas de teste, sem render): `scripts/video/creative-director-proof.mjs`.
  Rodada 1: B (produtividade) concebeu o relógio sem o pedido citar relógio; E honrou suspense e revelação
  nos 3 conceitos. Viés achado: o relógio aparecia também em D (comparação de preços). Correção no brief
  ("a ideia decide as ferramentas"; os 3 conceitos não podem depender do mesmo recurso; notas com rigor).
  Rodada 2: D passou a escolher comparação criativa; B manteve o relógio com 3 conceitos de recursos distintos.

## Limitações

- Notas de impacto/originalidade são autoavaliação do Codex; a seleção é trava de regras, não juiz estético.
- Humor não surge espontaneamente nas provas (o Codex tende a suspense/comparação); quando pedido, é honrado.
- Sem filmagem, o vídeo depende de motion graphics + imagens conceituais geradas; conceito com pessoas reais
  em movimento é descartado (não há vídeo realista habilitado — seria serviço pago).
- O piloto usa o Codex da conta operacional (assinatura) para as marcas próprias da Vorix; clientes pagantes
  usam o AI Gateway com cobrança por tokens. Não estender o uso da assinatura a clientes sem revisar os termos.
