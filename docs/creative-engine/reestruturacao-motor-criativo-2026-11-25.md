# Motor criativo — fidelidade, referências e qualidade visual (25/11/2026)

Intervenção na lógica de produção criativa do Marketing. Reaproveita o motor existente (renderizador
editorial do piloto, Quality Gate, Biblioteca da marca, Bolsão, motor GPT da Produção) — não há um
segundo motor. Nada foi publicado, nenhuma IA paga foi acionada nos testes e não houve push/deploy.

## 1. Auditoria do caminho de geração

Há dois caminhos reais:

- **Piloto automático (o que publica todo dia, 12h/19h):** `scripts/editorial/codex-social-*` no servidor
  (`/opt/vorix-editorial`). Bolsão → `backend.mjs select` → Codex (ferramenta nativa de imagem, plano
  ChatGPT) → `render.mjs` (texto + logo) → `backend.mjs schedule` → publicação IG+FB.
- **Produção pela interface:** `POST /v1/production/ideas/generate` → briefing sintético → motor GPT
  (`run-gpt-creative-engine.ts`) → `OpenAiCreativeImageProvider` → `/v1/images/generations|edits`.

| Pergunta | Resposta (antes da correção) |
|---|---|
| O motor recebe a foto original ou só texto? | Piloto: recebia os **bytes** das imagens da pauta (`--image`), mas a Vorix não tinha nenhuma e a CMKV automática **nem passava por IA** (colagem do catálogo). Produção: 1 imagem (bytes) via `/edits`; as demais viravam **texto descritivo**. |
| Bytes, URL, id ou metadados? | Piloto: bytes (PNG redimensionado). Produção: bytes da 1ª URL, baixada no provider. |
| Sabe qual é o produto principal? | Não. Toda imagem era "referência da pauta", sem papel. A Produção usava `primaryImageIndex` só quando a Reference Intelligence respondia. |
| Fallback troca a foto por captura do site? | Na CMKV, a pauta automática compunha as fotos do catálogo lado a lado sobre fundo chapado (`catalogBase`) — o resultado **parece a vitrine do site**. Na Produção, falha ao baixar a referência caía **em silêncio** para geração só por texto. |
| A referência chega ao modelo? | Piloto: sim, quando existia. Produção: só a primeira; as outras, não. |
| Gera do zero quando deveria editar? | Vorix: sempre do zero, e o prompt **proibia letras** — por isso os monitores saíam vazios/genéricos. CMKV (pautas refinadas sem foto): do zero — cabides vazios e camiseta lisa inventada. |
| O modelo suporta a operação? | Sim (`gpt-image-2.6-sunburst/flare` com `/edits`; Codex com `--image`). O problema não era o modelo. |
| As instruções de preservação chegam intactas? | Piloto: prompt genérico único, com a pauta em JSON solto; sem lista do que é imutável. |
| O renderizador altera o resultado? | Não altera o produto; só texto/logo/véu. Mas não sabia onde estava o produto quando o gerador não informava. |
| O Quality Gate aprova imagem que não corresponde? | Sim. Media contraste do texto, rosto coberto e logo. Produto errado/ausente e tela vazia passavam. |
| De onde vem a repetição? | Do planejamento e da seleção: (1) carrossel passava a tela anterior como referência ("mantenha a unidade") → telas quase iguais; (2) **bug de rodízio** da CMKV colocava o produto usado por último na frente → mesma estampa floral todo dia; (3) composição fixa do catálogo. |

Evidências: peças publicadas de 22 a 25/11 em `antes/` da pasta de comparativo (Área de Trabalho).

## 2. O que mudou

Núcleo puro (testável, sem I/O) em `src/application/creative-engine/`:

- `reference-roles.ts` — biblioteca de referências: 9 papéis (foto do produto, variação, logo, estilo,
  captura de software, peça anterior, captura de site, inspiração, fundo), prioridade por modo, o que vai
  ao modelo (`transmitted`, na ordem), o que fica de fora (com motivo) e o que falta (orientação).
  Captura de site nunca substitui foto de produto; logo nunca é referência de composição; foto de variante
  com outra cor (erro de catálogo) é excluída e, se for a anunciada, bloqueia.
- `visual-intent.ts` — modo **por pauta**: produto físico, software ou conceitual; auditável (motivos,
  fonte da decisão) e editável (materiais escolhidos ou modo explícito).
- `creative-spec.ts` — planejamento antes da geração: especificação estruturada (marca, objetivo,
  público, produto/funcionalidade, mensagem, composição, referências obrigatórias, restrições de
  fidelidade, imutáveis, o que evitar, formato) e 12 arquétipos de composição por modo, escolhidos por
  afinidade com a pauta e penalizados pelo uso recente. Instrução concreta para o gerador
  (`buildImageInstruction`) com o papel de cada imagem anexada.
- `visual-variety.ts` — histórico visual: impressão dHash de 64 bits + estrutura (arquétipo, posição do
  texto, nº de produtos). Reprova quase-cópia e layout repetido; na mesma série só a tela idêntica.
- `creative-fidelity-gate.ts` — Quality Gate por modo (produto, software, todos). Paleta/tamanho nunca
  compensam falha de fidelidade.
- `targeted-revision.ts` — correção pelo motivo (recompor com a foto original, inserir a captura real,
  trocar arquétipo, recompor texto, trocar a logo), com limite de tentativas e de custo; sem correção
  segura → revisão manual. Peça reprovada nunca é agendada.
- `plan-editorial-creative.ts` — plano completo de uma pauta do Bolsão (usado pelo piloto, pela prévia
  da interface e pelo comparativo) + rodízio corrigido dos produtos liberados.
- `creative-trace.ts` — rastreamento: ids, origem, papel, SHA-256 parcial, bytes e dimensões de cada
  referência; operações com engine, modelo, hash do prompt, duração e resultado. Assinaturas de URL
  são removidas.

Imagem em `src/infrastructure/media/creative/`:

- `compositions.ts` — composição controlada com os **arquivos originais**: produto em estúdio, editorial,
  variações reais em leque, destaque da estampa (zoom com os pixels da foto), comercial; notebook,
  janela, foco na funcionalidade (cartão ampliado do trecho real) e celular (só com captura móvel real).
- `perspective-warp.ts` — homografia para encaixar a captura real em perspectiva, sem serrilhado.
- `product-cutout.ts` — recorte do fundo de estúdio (inundação pela borda) + localização da estampa.
- `image-analysis.ts`, `catalog-photo-signals.ts`, `measure-fidelity.ts` — dHash, cores dominantes, ΔE,
  textura/vazio da tela, "cara de captura de tela", cor da variante, fidelidade do produto gerado.

Piloto (`scripts/editorial/`): `backend.mjs` classifica materiais, planeja a pauta, pula pautas
bloqueadas (com orientação), manda os bytes originais e o histórico; `schedule.mjs` orquestra por tela
via `creative-pipeline.mjs` (compartilhado com o comparativo) e grava no payload da publicação o registro
criativo (modo, arquétipos, rastreamento, impressões); `render.mjs` monta a base pelo arquétipo, mede e
devolve o veredito do gate + a revisão. O prompt do Codex virou regras fixas + instrução do plano.

Produção (UI): várias referências reais no `/edits` (`image[]`, principal primeiro) com hash/bytes na
auditoria; referência obrigatória que falha interrompe com `REFERENCE_IMAGE_UNAVAILABLE`.

Interface: o detalhe da ideia no Bolsão mostra **"Como a arte será produzida"** (modo, material
principal, papel de cada arquivo, o que vai/não vai para a arte e por quê, o que falta, composição por
tela). Trocar o material = trocar as imagens da ideia. API: `GET /v1/editorial-ideas/:id/creative-plan`.

Capturas reais da Vorix: `web/e2e-capture/vorix-product-screens.spec.ts` captura o front real com dados
de demonstração (API simulada) → `scripts/editorial/library/vorix-works/` + `manifest.json` (funcionalidade,
palavras-chave, trecho de foco). Cadastro na Biblioteca: `scripts/editorial/upload-software-captures.mjs`.

## 3. Modelos e endpoints

- Piloto: Codex CLI (`gpt-6.2-sol`, ferramenta nativa de imagem; plano ChatGPT, sem crédito de API),
  usado **só** nos arquétipos de IA: lifestyle (edição com a foto original anexada, depois conferida) e
  cena conceitual. Composições de produto e de software não usam IA.
- Produção: `gpt-image-2.6-sunburst` (padrão, edição precisa) e `gpt-image-2.6-flare` (rápido),
  `/v1/images/edits` com referências, `/v1/images/generations` sem. Família 2.6 omite `input_fidelity`.
  Não houve troca de modelo: a causa não era o modelo.

## 4. Custos

- Composição controlada (produto e software): **US$ 0** e ~1,5 s por tela.
- IA no piloto (Codex): sem custo por imagem (consome o limite do plano ChatGPT), ~1–3 min por imagem.
- IA na Produção (API, preço oficial 2.6: US$ 30/1M tokens de saída, US$ 8/1M de entrada de imagem):
  ≈ US$ 0,19–0,25 por imagem 4:5 em qualidade alta; edição com 2 referências ≈ +US$ 0,01–0,02.
- Revisão: correção por composição é gratuita; nova geração por IA só dentro do orçamento informado.

**Amostra de geração real proposta (aguarda autorização):** 6 lifestyles da CMKV (produto com a foto
original) + 4 cenas conceituais (Vorix/marca demo) + até 4 refações = 14 imagens. Pela API ≈ **US$ 3,50**
(teto US$ 4); pelo Codex, US$ 0 (limite do plano).

## 5. Testes

- `tests/creative-engine-fidelity.test.mjs` (21): papéis, modos, bloqueios, cor da variante, rodízio,
  arquétipos/variedade, Quality Gate, revisão, perspectiva, composição com pixels originais, fidelidade
  medida, **associação referência → entrada (100%)**, renderizador do piloto com gate, Produção com várias
  referências e referência obrigatória, API da prévia (isolamento por tenant).
- `web/e2e/creative-plan-preview.spec.ts` (desktop + mobile): prévia no Bolsão, sem escrita.
- Comparativo visual: `scripts/editorial/creative-benchmark.mjs <fixtures> <saída>`.

## 6. Riscos e limitações

- Lifestyle real depende de IA (não autorizada nos testes): sem ela, cai na composição editorial fiel.
- Medição de fidelidade de produto gerado pela IA depende da área informada pelo gerador; na dúvida,
  reprova e recompõe com a foto original (direção segura, mas pode descartar uma boa imagem).
- Recorte em foto de ambiente (fundo escuro não uniforme) pode deixar resto de fundo (relógio da marca
  demo); o gate ainda não detecta resto de fundo.
- Tela inteira do sistema dentro de dispositivo fica pequena no feed; o arquétipo de foco amplia o trecho.
- Vorix: a logo cadastrada para fundo escuro é só o símbolo V (falta versão clara oficial).
- Catálogo CMKV: a foto da variante "Azul-Marinho" do modelo 000033 é turquesa — corrigir no catálogo.

## 7. Implantação (pendente de autorização)

1. Deploy da API (os scripts do piloto passam a importar módulos novos do `dist/`).
2. Cadastrar as capturas da Vorix na Biblioteca (`upload-software-captures.mjs`) — sem elas as pautas de
   demonstração da Vorix ficam bloqueadas com orientação (comportamento intencional).
3. Copiar `codex-social-*.mjs` + `creative-pipeline.mjs` para `/opt/vorix-editorial` e rodar
   `node codex-social-schedule.mjs 19 select <workspace>` (só leitura) nas 4 marcas antes do horário.
