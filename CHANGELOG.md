# Changelog

Todas as mudanças notáveis do Zuno são documentadas neste arquivo. O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] — 2026-07-10

Primeira versão estável do Zuno para uso local. Encerra a fase de RC (Release Candidate) após duas rodadas de homologação (RC1/RC2) e a correção do último bug crítico pendente (BUG-06, proporção/resolução de Story). Documentação completa em `docs/release-notes-v1.0.0.md`.

### Added

- CLI local (`npm run zuno -- "<comando>"`) como ponto de entrada real: interpreta pedidos em linguagem natural e percorre o fluxo completo Arthur → Caio → Helena → Skills a partir de um único comando em texto.
- 12 Skills reais e prontas para produção local: Eduardo (planejamento editorial), João (estratégia de marketing), Maria (copywriting), Sofia (direção de arte), Bianca (design para redes sociais), Pedro (geração de imagem), Lucas (revisão de qualidade), Ana (publicação social), Bruno (roteiro de vídeo), Vanessa (direção de vídeo), Diego (edição de vídeo), Rafa (renderização de vídeo).
- Pipeline de imagem completa (Eduardo → João → Maria → Sofia → Bianca → Pedro → Lucas → Aprovação humana → Ana) para imagem única, carrossel, Story e capa de Reels.
- Pipeline de vídeo completa (João → Bruno → Vanessa → Diego → Rafa → Lucas → Aprovação humana → Ana) para Reels, TikTok, Shorts e vídeo vertical.
- Developer Assisted Mode para geração de imagem (Pedro) e de vídeo (Rafa): o workflow pausa em `WAITING_ASSISTED_GENERATION`, aguarda o arquivo real ser salvo em disco e retoma com `--continue`.
- Campaign Manager: quebra um objetivo de campanha em texto livre em um Campaign Plan com múltiplos conteúdos, cada um capaz de gerar seu próprio `ExecutionPlan` via Arthur sob demanda (`--campaign`, `--campaign-list`, `--campaign-show`, `--campaign-generate-plan`, `--campaign-mark`).
- Quality Feedback: ciclo de melhoria contínua com avaliação humana pós-execução (estrelas/nota, categorias, comentário), histórico local e relatório agregado (`--rate`, `--quality-report`); o Eduardo consulta esse histórico apenas como recomendação, nunca como decisão automática.
- Entrega final padronizada em `artifacts/<executionId>/index.html`: preview, downloads reais, `caption.txt`, `hashtags.txt`, `metadata.json`, `execution-report.json`, `carousel.zip` (quando houver múltiplas imagens) e player de vídeo HTML5.
- Autoridade única de proporção/resolução visual (`src/shared/utils/aspect-ratio.ts`), decidida uma vez por Sofia a partir de canal/formato e propagada por `inputBinding` a Bianca, Pedro e Lucas.

### Fixed

Consolidado das duas rodadas de homologação (RC1/RC2) e da correção final:

- Story com mais de uma tela não falha mais na geração de imagem (Bianca reconhece Story como formato multi-slide).
- O slide de Fechamento/CTA não é mais descartado silenciosamente quando a contagem de slides do Eduardo diverge da contagem própria da Bianca (Eduardo passou a ser a fonte única de verdade para a contagem de slides/telas, propagada por `inputBinding`).
- Formas no gerúndio/conjugadas dos verbos de classificação do Eduardo ("explicando", "ensinando", "mostrando", "vendendo") agora são reconhecidas corretamente.
- Duas execuções de workflow completamente diferentes não colidem mais no mesmo `executionId` entre invocações separadas da CLI.
- Flags da CLI aceitam valores que começam com `--` (ex.: um comentário de avaliação); a mensagem de erro de flag ausente passou a citar a flag e o exemplo corretos.
- Story (Instagram, Facebook, enquete, com múltiplas telas) é gerado em 1080x1920 (9:16), não mais 1080x1350 (4:5) herdado do feed — proporção e resolução agora vêm de uma autoridade única baseada em canal/formato, não de um valor estático.

### Known limitations

- **Modo oficial: `LOCAL_PRODUCTION`.** Não há painel web, servidor, banco de dados ou CDN nesta versão — tudo roda localmente via CLI/VS Code.
- **Imagens e vídeos usam Developer Assisted Mode.** Não existe geração nativa de pixels/vídeo nem provider externo configurado; o arquivo real é salvo manualmente (pela IA desenvolvedora ou por quem estiver operando a CLI) no caminho indicado, e o workflow retoma com `--continue`.
- **Publicação real ainda depende de hospedagem pública e integração com a Meta.** Em `LOCAL_PRODUCTION`, Ana sempre devolve `local_ready`/`dry_run` — nada é publicado de fato, mesmo quando o comando pede publicação. O adaptador real da Meta existe (`src/infrastructure/social-networks`), mas sem credenciais configuradas e sem hospedagem pública de mídia.
- Eduardo não reconhece todo o vocabulário comercial possível (ex.: viés de classificação em torno de "presentear"), Arthur ainda ativa a pipeline de vídeo pela palavra "roteiro" antes de o Eduardo avaliar o objetivo, e o erro de cliente inexistente ainda aparece sob o prefixo genérico "Erro inesperado". Detalhes completos em `docs/release-notes-v1.0.0.md`.

[1.0.0]: docs/release-notes-v1.0.0.md
