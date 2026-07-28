# Relatório técnico — Remoção do acoplamento artificial `carousel_creation`

Durante a validação do Developer Assisted Mode com um carrossel real de 3 imagens, o comando pedido pelo usuário falhou imediatamente no pré-flight de Caio (`FAILED — nenhuma Skill pronta para carousel_creation`), antes de chegar ao Pedro. Este relatório documenta a causa raiz, a correção aplicada (autorizada explicitamente pelo usuário como "correção definitiva da arquitetura", não workaround) e a validação completa após a correção.

## Causa raiz

Em `arthur.orchestrator.ts`, três pontos estavam acoplados de forma indevida:

1. `detectRequiredCapabilities` adicionava a capability `carousel_creation` a `requiredCapabilities` sempre que o texto do comando mencionava "carrossel"/"carousel"/"slide(s)".
2. `detectFormat` só retornava `"carrossel"` quando `carousel_creation` estava em `requiredCapabilities` — ou seja, o *label* de formato dependia da capability.
3. A etapa de `image_generation` calculava `imageCount: format === "carrossel" ? 3 : 1` — ou seja, a contagem de imagens do Pedro dependia do *label* de formato, que por sua vez dependia da capability.

Resultado: **não existia nenhuma frase de comando capaz de produzir `imageCount > 1` sem também adicionar `carousel_creation` ao plano** — e como nenhuma Skill jamais implementou essa capability (ela nunca representou uma especialidade real; carrossel sempre foi apenas Pedro com `imageCount > 1`), Caio's `findMissingCapabilities` barrava o workflow inteiro antes de qualquer etapa rodar, mesmo com o Pedro já plenamente capaz de gerar carrosséis reais (testado e funcionando desde sessões anteriores).

## Correção aplicada

**Princípio adotado (conforme instrução explícita do usuário):** carrossel não é uma especialidade separada — é uma configuração de saída da própria Skill Pedro (`imageCount`). Arthur nunca deve planejar uma etapa dedicada a "criar carrossel"; quem decide gerar 1, 2, 3, 5+ imagens é exclusivamente o Pedro, a partir do `imageCount` que recebe.

### `src/domain/skills/skill-capability.contract.ts`
Removida a entrada `"carousel_creation"` da lista `SKILL_CAPABILITIES` (e do tipo `SkillCapability` derivado dela). Comentário adicionado explicando a decisão para quem ler o arquivo no futuro.

### `src/application/tenancy/valentina-plan-catalog.ts`
Removida `"carousel_creation"` de `PRO_SPECIALISTS` — o plano PRO continua liberando `image_generation` normalmente, que já cobre carrossel.

### `src/application/orchestration/arthur.orchestrator.ts`
- Removida `"carousel_creation"` de `DEFAULT_CAPABILITIES`.
- Removido o bloco em `detectRequiredCapabilities` que adicionava `carousel_creation` com base em palavras-chave.
- Removida por completo a etapa "Criação de carrossel" (`skillCapability: "carousel_creation"`) que era adicionada ao plano.
- Nova função `detectImageCount(text)`: lê um número explícito no comando (`"3 imagens"`, `"5 slides"`, etc.) via regex; na ausência de número explícito, mantém o comportamento anterior de assumir 3 quando há menção a carrossel/slides; caso contrário, 1.
- `detectFormat` agora deriva o label `"carrossel"` diretamente de `imageCount > 1`, não mais de uma capability.
- A etapa de `image_generation` agora recebe `input: { imageCount, desiredAspectRatio: "4:5" }` — `imageCount` computado uma única vez por `detectImageCount`, sem qualquer capability envolvida.

### Testes atualizados
- `tests/arthur.orchestrator.test.mjs`: o teste que antes verificava a presença de `carousel_creation` agora verifica explicitamente sua **ausência**, confirma que existe exatamente uma etapa `image_generation` e que `imageCount` chega correto (3) a partir da palavra "carrossel". Dois testes novos: `imageCount` a partir de número explícito no texto ("3 imagens") e `imageCount = 1` para um post único sem menção a carrossel/slides.
- `tests/caio.workflow-executor.test.mjs`: os dois testes de "capability faltante" que usavam `carousel_creation` apenas como exemplo de string foram trocados para `video_creation` (uma capability genuinamente reservada e ainda sem Skill), preservando a cobertura do mecanismo genérico de pré-flight sem depender do conceito removido.
- `tests/cli.smoke.test.mjs`: o teste que validava a falha por capability faltante usava "crie um carrossel..." como gatilho; trocado para um comando de campanha paga (`campaign_management`, ainda genuinamente não implementada).

### Documentação atualizada
`README.md`, `src/interfaces/cli/README.md`, `docs/arthur-orchestrator.md` e `docs/caio-workflow-executor.md` — removidas as menções a `carousel_creation` como capability reservada, com uma nota explícita em `docs/arthur-orchestrator.md` explicando a correção para quem ler a história do projeto. Os dois relatórios históricos anteriores (`docs/content-pipeline-standardization-report.md`, `docs/zuno-release-candidate-1.0-report.md`) foram deliberadamente **não alterados** — são registros datados de auditorias já entregues; alterá-los reescreveria retroativamente o que foi observado naquele momento.

## Confirmação: nenhuma nova capability foi criada

`SkillCapability` foi apenas **reduzido** (uma entrada a menos: `carousel_creation`). Nenhuma capability nova foi adicionada em nenhum ponto desta correção. As quatro capabilities reservadas restantes (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) permanecem exatamente como estavam — essas continuam representando especialidades futuras genuinamente distintas, não absorvidas por nenhuma Skill existente.

## Impacto na arquitetura

- **Nenhuma Skill foi criada, alterada em responsabilidade, ou teve sua capability trocada.** Pedro continua sendo a única Skill com `image_generation`; seu contrato de entrada (`imageCount`) não mudou.
- **Arthur** perdeu uma ramificação de planejamento (a etapa "Criação de carrossel", que nunca teve Skill real por trás) e ganhou uma função pura e testável (`detectImageCount`) no lugar de uma dedução indireta via capability.
- **Caio** não precisou de nenhuma mudança — seu mecanismo de pré-flight (`findMissingCapabilities`) já era genérico; ele simplesmente para de encontrar uma capability que deixou de ser requisitada.
- **Valentina** perdeu uma entrada de uma lista de entitlements (`PRO_SPECIALISTS`) que nunca correspondeu a uma Skill real utilizável.
- Nenhuma mudança em Helena, Clara, Ícaro, ou em qualquer uma das sete Skills.

## Validações executadas após a correção

- `npx tsc --noEmit` — sem erros.
- `npm test` — **255/255 testes passando** (253 antes desta correção + 2 testes novos em Arthur — os dois testes de Caio e o de CLI que citavam `carousel_creation` foram *adaptados* para usar `video_creation`/`campaign_management`, não removidos nem duplicados).
- `npm run architecture:check` — build completo, sete Skills descobertas, todas as capabilities resolvendo corretamente (nenhuma referência pendente a `carousel_creation`).

## Validação end-to-end real: carrossel de 3 imagens via CLI

Comando executado de verdade (não simulado):

```
npm run zuno -- "crie um carrossel de 3 imagens para o Instagram do Rumo ao Altar com o tema taxa zero na lista de presentes"
```

Resultado observado, passo a passo:

1. **Plano aceito, sem falha de pré-flight.** Workflow avançou por Estratégia → Copy → Direção de arte → Design de redes sociais normalmente, chegando a `WAITING_ASSISTED_GENERATION` na etapa "Geração de imagem" — nenhuma etapa "Criação de carrossel" existe mais no plano.
2. **3 caminhos esperados informados corretamente**, cada um com resolução 1080×1350: `images/slide-01.png`, `images/slide-02.png`, `images/slide-03.png`.
3. Criei (como a IA desenvolvedora) 3 PNGs reais e válidos nesses caminhos exatos, usando o mesmo encoder mínimo baseado só em `node:zlib` já usado nos testes automatizados.
4. `npm run zuno -- --continue <executionId>` — **as 3 imagens foram aceitas** (validação de assinatura PNG + resolução passou para as três), Pedro completou, Lucas revisou, workflow avançou para `WAITING_HUMAN_APPROVAL`.
5. `npm run zuno -- --approve <executionId>` — workflow avançou até **`COMPLETED`**, todas as 9 etapas com estado `COMPLETED`.

Checklist pedido, todos os itens confirmados:

| Item | Resultado |
|---|---|
| As 3 imagens foram aceitas | ✅ `metadata.json.imageCount = 3`, três entradas em `images[]` com 1080×1350 cada |
| HTML final foi gerado | ✅ `index.html`, 15.597 bytes |
| ZIP foi gerado | ✅ `carousel.zip`, 22.787 bytes, contendo `images/slide-01.png`, `slide-02.png`, `slide-03.png` e `caption.txt` (4 arquivos, íntegro — verificado lendo o diretório central do ZIP) |
| caption.txt foi gerado | ✅ 286 bytes, com a legenda real e as hashtags |
| metadata.json foi gerado | ✅ 3.402 bytes, `provider: "developer-assisted"`, `model: "claude-code-developer-assisted"` |
| Botões de download funcionam | ✅ `download="slide-01.png"`, `download="slide-02.png"`, `download="slide-03.png"` presentes nos três cartões de imagem, mais `href="carousel.zip"` no botão "Baixar todas em ZIP" |
| A legenda aparece no HTML | ✅ Texto completo da legenda e as quatro hashtags presentes diretamente no corpo do HTML (seção "Copiar legenda"), não só em `caption.txt` |
| O relatório mostra `developer-assisted` | ✅ Presente no HTML (resumo técnico da execução) e em `metadata.json` |
| Status final ficou correto | ✅ `WAITING_ASSISTED_GENERATION` → (após as 3 imagens) `WAITING_HUMAN_APPROVAL` → (após aprovação) `COMPLETED`, todas as 9 etapas concluídas |

Também confirmado: a galeria/lightbox do HTML inclui navegação "Anterior"/"Próxima" (`lightboxStep(-1)`/`lightboxStep(1)`) por haver mais de uma imagem — mesmo comportamento já validado para carrosséis antes desta correção, agora acessível de fato via um comando de texto real.

## Limitações e observações

- `detectImageCount` só reconhece números escritos em algarismos junto de "imagem(ns)"/"foto(s)"/"slide(s)" (ex.: "3 imagens"). Números por extenso ("três imagens") não são reconhecidos e caem no padrão de 3 (se houver menção a carrossel/slides) ou 1.
- O comportamento padrão de 3 imagens para menções genéricas a "carrossel" (sem número explícito) foi mantido intencionalmente, para não mudar o resultado de comandos que já funcionavam dessa forma antes da correção.
- As quatro capabilities reservadas restantes (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) continuam causando falha imediata e consolidada quando mencionadas — comportamento correto e inalterado, já que essas representam Skills futuras genuinamente distintas.
