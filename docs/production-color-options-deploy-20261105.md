# Bambilu Kids — publicação das miniaturas de cor

Release [`9f0b31b`](https://github.com/precobaixoclub/Vorix-Works/commit/9f0b31b541bcb7893dedc71830bbbf79117b7670), enviada à `main` e publicada em 05/11/2026. [Loja publicada](https://vorixworks.com/s/bambilu-kids).

O deploy oficial atualizou somente a interface (`web`). A seleção de cores no catálogo, destaques, relacionados e detalhe passa a usar fotos reais vinculadas à cor. O botão `+N` dos cards permite acessar as opções restantes. A seleção continua usando os mesmos dados e controles de disponibilidade.

## Resultado

- `DEPLOYED 9f0b31b` e `DEPLOY_DONE` confirmados.
- Build Linux e TypeScript aprovados; site HTTP 200, API `ready: true`, zero erros fatais no recorte de logs do deploy.
- Todos os serviços saudáveis; backend e workers preservados, sem novas migrations.
- Imagem web em execução conferida: `sha256:f80f110a82f2235c6889fad9cbdc07dd65485c5bfc696d9a70db763847b19ab5`.
- Três arquivos centrais conferidos por SHA-256 contra o commit publicado.
- Configuração `.env.zuno` preservada, com hash igual antes e depois. Nenhum rollback necessário.

## Verificação após publicação

Card e opções do detalhe em 360, 390, 430, 768, 1024 e 1440 px: 12 verificações aprovadas, sem overflow ou erros JavaScript. Foram conferidos quatro previews iniciais, expansão para sete cores, correspondência entre a foto selecionada e a principal, seleção de tamanho/cor e estado marcado.

Capturas reais em 390, 768 e 1440 px estão no [índice de evidências](qa/color-photo-options-20261105/README.md); o [registro de produção](qa/color-photo-options-20261105/production/validation.json) confirma os resultados.

A resposta pública da loja, normalizando apenas as assinaturas temporárias das URLs, permaneceu idêntica antes e depois: SHA-256 `3f96e2a7b3b78f5d6c0adee16ca34b9624a035714a782b023a48aef945efd233`. Produtos, variações, preços, estoque exposto, regras e configuração comercial foram preservados. A loja continua em modo vitrine, com carrinho e checkout desabilitados. A conferência não enviou formulários, pedidos ou mensagens; analytics foram interceptados no navegador.

Antes da publicação: 273 testes de frontend em 39 arquivos, typecheck e 10 testes Playwright aprovados, incluindo a regressão das galerias dos seis templates.

## Recuperação

Host `143.198.47.74`, diretório `/opt/zuno`, com checagem estrita da chave SSH registrada.

- Código: `/opt/zuno/deploy_backups/pre-9f0b31b-20261105163617.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-9f0b31b-20261105163617.sql.gz`.
- Configuração: `/root/.env.zuno.pre-9f0b31b-20261105163617`.
- Pacote publicado: `/opt/zuno/deploy_backups/release-9f0b31b.tgz`.
- SHA-256 do pacote: `1e498036dd32759e66856835e1833a1ea30158f6eb7918bc156fe2fc817d7a1a`.
- Imagem anterior: `zuno-zuno-web:rollback-20261105163617`.
- Log oficial: `/var/log/vorix-deploy-9f0b31b-20261105163617.log`.

O pacote foi gerado por `git archive`. Este relatório e as capturas de produção entram em commit posterior apenas de documentação; a aplicação publicada corresponde a `9f0b31b`.
