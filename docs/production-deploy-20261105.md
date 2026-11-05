# Publicação em produção — 05/11/2026

Release da aplicação: [`f3626e8`](https://github.com/precobaixoclub/Vorix-Works/commit/f3626e8638d1ffe2be8f06035eec3f1dad929e56), enviada à branch `main` e publicada após autorização do usuário. Data local: 05/11/2026, fuso America/Sao_Paulo.

Inclui as alterações pendentes de produtos e upload, a experiência compartilhada de imagens/galeria/variações e o módulo de Regras Comerciais configuráveis. API, workers, gateway e interface foram atualizados pelo script oficial, usando um pacote gerado por `git archive` do commit.

## Resultado

- Processo oficial concluído com `DEPLOYED f3626e8` e `DEPLOY_DONE`.
- API com `ready: true`, site público HTTP 200 e zero erros fatais no recorte de logs do deploy.
- Cinco serviços atualizados e saudáveis, com as imagens em execução correspondendo às imagens construídas: API, worker de atendimento, worker de marketplaces, gateway social e interface.
- Migration `0192_commercial_rules` aplicada: 193 migrations aplicadas, nenhuma pendente.
- Configuração `.env.zuno` preservada, com hash igual antes e depois.
- Nenhum rollback necessário.

O readiness continua retornando `status: degraded` pelo aviso preexistente de `production_guard`; `ready` permanece verdadeiro. Esse aviso já existia antes da publicação.

## Regra da Bambilu Kids

A loja [Bambilu Kids](https://vorixworks.com/s/bambilu-kids) recebeu a regra **Preço progressivo por quantidade**, ativa na revisão 1, com escopo de toda a loja e soma das quantidades elegíveis entre produtos e variações:

| Quantidade | Preço por unidade |
| --- | --- |
| 1–2 | R$ 60,00 |
| 3–4 | R$ 55,00 |
| 5 ou mais | R$ 50,00 |

Prioridade 0, canais checkout e WhatsApp, sem acumulação com outras regras ou cupom. ID: `rule-e0e406c3-2677-4c66-a9ad-4436b4a9c90a`.

A ativação usou `saveCommercialRule` e o repositório normal da aplicação, com validação e auditoria identificada como `system:release:f3626e8`. Os totais para 1, 2, 3, 4, 5, 6 e 10 unidades foram conferidos com produtos reais antes e depois da persistência. Catálogo, estoque, clientes, pedidos e configurações comerciais permaneceram iguais durante essa operação.

A loja permanece com template Nexus e modo **SHOWCASE**, com carrinho e checkout desabilitados, conforme a configuração anterior. As condições por quantidade são exibidas no catálogo/detalhe. Não foram criados pedidos, pagamentos ou contatos, nem enviadas mensagens durante a validação.

## Validação

- Frontend local: 266 testes em 38 arquivos e typecheck aprovados.
- Backend: 68 testes aprovados; repetidos no ambiente Linux isolado.
- Navegador local: 4 testes comerciais e 7 testes de galeria aprovados; cobertura dos seis templates e das larguras previstas.
- Pacote exato da release: build Docker de backend e verificações de arquitetura aprovados; imagem Docker da interface construída com verificação de tipos.
- Produção: catálogo e detalhe em 360, 390, 430, 768, 1024 e 1440 px, totalizando 12 verificações HTTP 200, imagens com `contain`, sem overflow horizontal e sem erros JavaScript.
- Navegação da galeria por setas, miniaturas e teclado conferida; faixas de R$ 55 e R$ 50 visíveis.
- Miniatura derivada de 160 px respondeu HTTP 200 em WebP.
- Endpoint administrativo de regras sem autenticação respondeu HTTP 401.

As duas primeiras tentativas do gate Linux esgotaram o limite de heap do contêiner ao recompilar o projeto. O gate foi concluído reaproveitando a compilação Docker já aprovada e executando separadamente todas as verificações de arquitetura e os 68 testes. Isso ocorreu antes da troca dos serviços de produção.

[Evidências do navegador e da ativação](qa/production-commerce-20261105/README.md).

## Backups e rastreabilidade

Host verificado: `143.198.47.74`, diretório `/opt/zuno`, com SSH e checagem estrita da chave registrada.

- Código anterior: `/opt/zuno/deploy_backups/pre-f3626e8-20261105041049.tgz`.
- Banco anterior: `/opt/zuno/deploy_backups/db-pre-f3626e8-20261105041049.sql.gz`.
- Configuração anterior: `/root/.env.zuno.pre-f3626e8-20261105041049`.
- Pacote publicado: `/opt/zuno/deploy_backups/release-f3626e8.tgz`.
- SHA-256 do pacote: `01f429bfdd48fe2f98b33df2559aa719feae470e65b7ef3b7aa192baebe9a156`.
- Imagens anteriores: etiqueta `rollback-20261105041049`.
- Log oficial: `/var/log/vorix-deploy-f3626e8-20261105041049.log`.
- Status das migrations: `/var/log/vorix-commercial-migration-status-f3626e8.log`.
- Ativação: `/var/log/vorix-commercial-activation-f3626e8.json`.
- Gate Linux: `/var/log/vorix-commercial-gate-build-f3626e8.log` e `/var/log/vorix-commercial-gate-tests-f3626e8.log`.
- Build da interface: `/var/log/vorix-commercial-web-image-f3626e8.log`.

O relatório e as capturas são registrados em commit posterior apenas de documentação. A aplicação publicada corresponde ao commit `f3626e8`.
