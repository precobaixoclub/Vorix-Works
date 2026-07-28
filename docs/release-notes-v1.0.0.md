# Zuno — Release Notes v1.0.0

**Data de lançamento:** 2026-07-10
**Tipo de release:** primeira versão estável para uso local (`LOCAL_PRODUCTION`).

---

## 1. O que é o Zuno

Zuno é a fundação de uma Agência de Marketing Inteligente composta por especialistas em IA (Skills), coordenados por Arthur (orquestrador) e executados por Caio (executor de workflows), com Helena gerenciando as Skills, Valentina administrando clientes e Clara centralizando conhecimento de marca/público/produto. Nesta versão, tudo roda localmente pela CLI — sem painel web, servidor, banco de dados ou infraestrutura externa.

## 2. Modo oficial: `LOCAL_PRODUCTION`

Esta versão opera exclusivamente em `LOCAL_PRODUCTION`, o modo padrão da CLI (não é necessário informar `--mode`). Neste modo:

- Todos os artefatos (imagens, vídeos, HTML de entrega, ZIP, metadados) ficam em `artifacts/<executionId>/`.
- **Imagens e vídeos usam Developer Assisted Mode**: não existe geração nativa de pixels/vídeo nem provider externo de IA configurado nesta fase. Pedro (imagem) e Rafa (vídeo) montam um prompt técnico completo e o caminho exato onde o arquivo deve ser salvo, pausam o workflow (`WAITING_ASSISTED_GENERATION`) e aguardam o arquivo real ser criado em disco antes de continuar.
- **Publicação real ainda depende de hospedagem pública e de integração configurada com a Meta.** Mesmo quando o comando pede para publicar, Ana sempre devolve `local_ready`/`dry_run`: monta o payload, mas não chama nenhuma API externa, não agenda e não faz upload. O adaptador real da Meta já existe no código (`src/infrastructure/social-networks`), mas está sem credenciais configuradas e sem um serviço de hospedagem pública de mídia — publicar de fato é uma etapa manual, fora desta versão.

## 3. Funcionalidades entregues

- **CLI natural-first**: comandos como "crie um post", "crie um carrossel com 5 imagens", "crie uma imagem", "crie um vídeo para Reels", "crie um TikTok", "crie um Story" — sem precisar citar Arthur, Helena ou qualquer Skill.
- **Pipeline de imagem completa**: Eduardo (planejamento editorial) → João (estratégia) → Maria (copy) → Sofia (direção de arte) → Bianca (design) → Pedro (geração de imagem) → Lucas (revisão) → aprovação humana → Ana (publicação/local_ready). Cobre imagem única, carrossel e Story.
- **Pipeline de vídeo completa**: João → Bruno (roteiro) → Vanessa (direção) → Diego (edição) → Rafa (renderização) → Lucas (revisão) → aprovação humana → Ana. Cobre Reels, TikTok, Shorts e vídeo vertical.
- **Eduardo decide a estratégia de conteúdo antes de tudo**: formato, quantidade de slides/telas, duração de vídeo, emoção principal, estrutura narrativa, CTA, profundidade, complexidade e prioridade de conversão.
- **Proporção e resolução corretas por canal/formato**: Instagram/Facebook Story, Reels, TikTok e Shorts verticais em 1080x1920 (9:16); feed vertical e carrossel em 1080x1350 (4:5); quadrado em 1080x1080 (1:1) quando solicitado explicitamente — decidido uma única vez e propagado a todas as etapas visuais, sem divergência entre elas.
- **Developer Assisted Mode** para imagem e vídeo, com validação real de arquivo (assinatura PNG/MP4, resolução esperada) antes de prosseguir.
- **Entrega final padronizada**: `artifacts/<executionId>/index.html` com preview, downloads reais, legenda/hashtags/CTA copiáveis, `caption.txt`, `hashtags.txt`, `metadata.json`, `execution-report.json`, `carousel.zip` (múltiplas imagens) e player HTML5 (vídeo).
- **Campaign Manager**: transforma um objetivo de campanha em texto livre em um Campaign Plan completo (persona, canais, frequência, calendário, lista de conteúdos com formato/prioridade/CTA/relações), com histórico, status por conteúdo e percentual concluído. Não é uma Skill e não participa do `ExecutionPlan` — funciona acima do Arthur, chamando-o sob demanda para cada conteúdo.
- **Quality Feedback**: avaliação humana pós-execução (estrelas 1–5 ou nota 1–10, categorias de melhoria, comentário livre), histórico local e relatório agregado (médias por Skill/formato/campanha, evolução temporal, melhores/piores conteúdos, reclamações recorrentes). O Eduardo consulta esse histórico apenas como recomendação — nunca decide nada sozinho a partir dele.

## 4. Limitações conhecidas

- Não há painel web, API pública, servidor, banco de dados ou CDN — apenas CLI local.
- Imagens e vídeos exigem intervenção humana/assistida para salvar o arquivo real (Developer Assisted Mode); não há geração automática de pixels.
- Publicação real (Instagram/Facebook) não ocorre nesta versão — depende de hospedagem pública de mídia e de credenciais reais da Meta, ainda não configuradas.
- Eduardo não reconhece todo o vocabulário comercial possível em português (ex.: "presentear" pode enviesar a classificação para conversão mesmo em perguntas de engajamento).
- A palavra "roteiro" sozinha já ativa a pipeline de vídeo antes de o Eduardo avaliar o objetivo do conteúdo, podendo divergir do formato que o Eduardo recomendaria isoladamente.
- O rótulo de formato do Eduardo não distingue "vídeo" genérico de "reels" — ambos usam o mesmo rótulo interno.
- O erro de cliente inexistente (`--client-id` inválido) ainda aparece sob o prefixo genérico "[zuno] Erro inesperado:" em vez de uma mensagem de validação dedicada.

Nenhuma dessas limitações é um bug crítico ou de integridade de dados — todas foram avaliadas e mantidas deliberadamente fora do escopo da v1.0 (ver `docs/rc2-fix-report.md` e `docs/bug06-fix-report.md`).

## 5. Instalação

Pré-requisitos: Node.js 20 ou superior.

```bash
git clone <repositório>   # ou copie a pasta do projeto
cd Zuno
npm install
```

## 6. Uso via CLI

```bash
npm run typecheck     # valida os tipos
npm test              # builda e roda toda a suíte automatizada
npm run build         # compila src/ para dist/ e copia os manifestos das Skills
npm run zuno -- "crie um post para o Rumo ao Altar no Instagram"
```

`--mode local-production` é opcional (é o padrão atual). `--client-id <id>` usa um cliente já cadastrado em vez do cliente de demonstração (`client-rumo`).

### Exemplos de comando por formato

```bash
# Imagem única
npm run zuno -- "crie uma imagem para Instagram sobre taxa zero na lista de presentes"

# Carrossel
npm run zuno -- "crie um carrossel para Instagram sobre taxa zero na lista de presentes do Rumo ao Altar"

# Story (Instagram ou Facebook)
npm run zuno -- "crie um story para Instagram divulgando a confirmação de presença antes do prazo"

# Reels
npm run zuno -- "crie um reels para Instagram apresentando o painel dos noivos"

# Vídeo (TikTok/Shorts/vertical genérico)
npm run zuno -- "crie um vídeo curto para TikTok convidando para comentar sobre presentes de casamento"
```

### Fluxo de `--continue` (geração assistida) e `--approve`/`--reject` (aprovação humana)

1. Rode um comando normalmente. Se o formato exigir imagem ou vídeo, o workflow pausa em `WAITING_ASSISTED_GENERATION` e a CLI imprime o prompt técnico e o caminho exato de cada arquivo esperado (ex.: `artifacts/<executionId>/images/slide-01.png`).
2. Salve o arquivo real (PNG para imagem, MP4 para vídeo) exatamente nesse caminho.
3. Retome com:
   ```bash
   npm run zuno -- --continue <executionId>
   ```
   Se algum arquivo ainda não existir ou não for válido, o workflow pausa de novo na mesma etapa, com a mesma instrução.
4. Quando todas as etapas de geração terminarem, o workflow pausa em `WAITING_HUMAN_APPROVAL`. Aprove ou reprove:
   ```bash
   npm run zuno -- --approve <executionId>
   npm run zuno -- --reject <executionId>
   ```
5. `npm run zuno -- --list` lista todas as execuções aguardando aprovação humana ou geração assistida.
6. Ao concluir (`COMPLETED`), abra o `index.html` indicado no terminal — é a entrega final, com preview, downloads e textos prontos para publicação manual.

### Campaign Manager

```bash
# Criar uma campanha a partir de um objetivo em texto
npm run zuno -- --campaign "Quero uma campanha para divulgar o Rumo ao Altar durante 30 dias." --client-id client-rumo

# Duração e canais explícitos
npm run zuno -- --campaign "Quero uma campanha de divulgação." --duration-days 9 --channels tiktok --client-id client-rumo

# Listar histórico de campanhas
npm run zuno -- --campaign-list --client-id client-rumo

# Ver o Campaign Plan completo e o resumo de status
npm run zuno -- --campaign-show <campaignId>

# Gerar o ExecutionPlan de um conteúdo específico da campanha (via Arthur)
npm run zuno -- --campaign-generate-plan <campaignId> <contentId>

# Atualizar o status de um conteúdo (pending, execution_planned, in_review, approved, rejected, published, failed)
npm run zuno -- --campaign-mark <campaignId> <contentId> approved --reason "Aprovado pelo time de marketing"
```

### Quality Feedback

```bash
# Avaliar uma execução concluída (estrelas 1-5 ou nota 1-10)
npm run zuno -- --rate <executionId> --stars 4 --needs-improvement cta,hashtags --comment "CTA podia ser mais direto"
npm run zuno -- --rate <executionId> --score 8

# Ver o relatório agregado de qualidade
npm run zuno -- --quality-report --client-id client-rumo
```

Categorias válidas para `--needs-improvement`: `estrategia`, `copy`, `legenda`, `cta`, `hashtags`, `layout`, `design`, `hierarquia_visual`, `imagem`, `video`, `roteiro`, `tempo`, `reels`, `qualidade_geral`.

## 7. Checklist de validação pós-instalação

Depois de `npm install`, confirme que o ambiente está saudável antes do primeiro uso real:

- [ ] `npm run typecheck` — termina sem erros.
- [ ] `npm test` — todos os testes passam (502 testes na v1.0.0).
- [ ] `npm run architecture:check` — build completo e as 12 Skills são descobertas corretamente, cada uma pela sua capability.
- [ ] `npm run zuno --` (sem argumentos) — imprime as instruções de uso.
- [ ] `npm run zuno -- "crie uma imagem para Instagram sobre o Rumo ao Altar"` — workflow inicia e pausa em `WAITING_ASSISTED_GENERATION`, mostrando o caminho e o prompt da imagem esperada.
- [ ] Salvar um PNG real no caminho indicado e rodar `npm run zuno -- --continue <executionId>` — workflow avança para `WAITING_HUMAN_APPROVAL`.
- [ ] `npm run zuno -- --approve <executionId>` — workflow conclui (`COMPLETED`) e informa que nada foi publicado (`LOCAL_PRODUCTION`).
- [ ] Abrir o `index.html` gerado em `artifacts/<executionId>/` — a página carrega com preview, downloads e textos.
- [ ] `npm run zuno -- --list` — não mostra mais essa execução pendente.

Se todos os itens acima passarem, o ambiente está pronto para uso local.

## 8. Documentação relacionada

- `README.md` — visão geral da arquitetura e dos componentes.
- `docs/architecture.md` — arquitetura completa.
- `docs/rc1-release-candidate-report.md`, `docs/rc2-fix-report.md`, `docs/rc2-re-homologacao-report.md`, `docs/bug06-fix-report.md` — histórico completo de homologação e correções que levaram a esta versão.
- `docs/campaign-manager.md`, `docs/quality-feedback.md` — documentação detalhada dos dois módulos que não são Skills.
- `CHANGELOG.md` — changelog desta versão.
