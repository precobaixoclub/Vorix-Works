# Editor de sites — publicação em 07/11/2026

Release [`f645661`](https://github.com/precobaixoclub/Vorix-Works/commit/f645661642354dea4f3597d462120d94084740d4), enviada à `main` e publicada com o procedimento oficial. O pacote contém o commit completo; o alvo `web` atualiza o serviço afetado. Não há alterações de backend nem migrations nesta release.

Inclui as orientações de imagens e caracteres, prévia que acompanha a edição, aviso de alterações não salvas, botões de imagem e configuração guiada de links. [Implementação e validação local](site-editor-improvements-20261107.md).

## Resultado

- `DEPLOYED f645661` e `DEPLOY_DONE` confirmados.
- Build Linux otimizado e TypeScript aprovados.
- Site HTTP 200, API `ready: true`, zero erros fatais no recorte de logs.
- Todos os seis contêineres saudáveis. A imagem web em execução corresponde à imagem construída.
- Configuração `.env.zuno` idêntica ao backup, conferida sem expor seu conteúdo.
- Os 31 arquivos do pacote alterados nesta release correspondem, por SHA-256, ao commit.
- Nenhum rollback necessário.

O readiness geral mantém o aviso preexistente `degraded` de `production_guard`, com `ready: true`.

## Conferência após a publicação

As páginas públicas de Nexus, Aura, Pulse e Bambilu Kids foram verificadas em computador e celular, na página inicial e no produto: 16 verificações aprovadas, sem overflow, imagens visíveis quebradas ou erros JavaScript. As requisições de gravação foram interceptadas.

O **frontend efetivamente publicado** também foi conferido em 1440 e 390 px com uma API fictícia local interceptada no navegador. Foram verificados atualização do rascunho, aviso de alterações não salvas, botão de foto, orientações de campos, acompanhamento do rodapé dentro do viewport e links guiados. Nenhuma conta ou loja real foi usada para essas edições; todas as chamadas de API desse contexto foram redirecionadas para a fixture local.

A resposta pública da Bambilu, normalizando apenas assinaturas temporárias de URLs, permaneceu idêntica antes e depois: SHA-256 `62e2c44216679b4494ce6c84a3fde80eb3b9ea2229af20bc7b3a6d13d7fff7cb`. Conteúdo, catálogo, variações, preços, regras e modo de venda foram preservados.

Antes da publicação: typecheck e 280 testes frontend aprovados em 07/11/2026. A última rodada interativa local teve 14 testes aprovados em computador e celular, incluindo os seis modelos e os fluxos de salvar, publicar, desfazer, editar seções e usar a prévia.

Evidências:

- [Validação do host](qa/site-editor-20261107/production-host-validation.json).
- [Verificações públicas](qa/site-editor-20261107/production-public-validation.json).
- [Editor publicado com dados fictícios](qa/site-editor-20261107/production-editor-validation.json).
- [Editor em computador](qa/site-editor-20261107/production-editor-desktop.png) e [celular](qa/site-editor-20261107/production-editor-mobile.png).

## Recuperação

Host `143.198.47.74`, diretório `/opt/zuno`, chave SSH verificada estritamente.

- Código anterior: `/opt/zuno/deploy_backups/pre-f645661-20261107124822.tgz`.
- Banco anterior: `/opt/zuno/deploy_backups/db-pre-f645661-20261107124822.sql.gz`.
- Configuração anterior: `/root/.env.zuno.pre-f645661-20261107124822`.
- Pacote exato: `/opt/zuno/deploy_backups/release-f645661.tgz`.
- SHA-256 do pacote: `9ee67fb3336699efc40e65ee38334a48380651ffd3ef537e19a39180e5a0bee0`.
- Imagem web: `sha256:5e62dca9f8416683ce0ca3db2a057f1c0fac9c267cc9c15b7ed6a28109f8f9cd`.
- Build ID: `JpEJNyaZ4jH34zaUIV7Pu`.
- Imagem anterior: `zuno-zuno-web:rollback-20261107124822`.
- Log: `/var/log/vorix-deploy-f645661-20261107124822.log`.

O relatório e as evidências de produção são registrados em commit posterior de documentação. A aplicação publicada corresponde à release `f645661`.
