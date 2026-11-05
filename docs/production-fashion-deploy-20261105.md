# Bambilu Kids — publicação do redesenho em 05/11/2026

Release [`02a696d`](https://github.com/precobaixoclub/Vorix-Works/commit/02a696d1cac05cc85041296af38f7a8fe10ec787), enviada à `main` e publicada após autorização do usuário. [Loja publicada](https://vorixworks.com/s/bambilu-kids).

O deploy oficial usou o alvo `web`: a interface recebeu a apresentação Fashion / Kids. O backend e os workers mantiveram suas imagens anteriores. Não houve alteração de migrations, catálogo, estoque, preços, variações ou regras comerciais.

## Resultado

- Script oficial concluído com `DEPLOYED 02a696d` e `DEPLOY_DONE`.
- Build Linux da imagem e checagem TypeScript aprovados.
- Site público HTTP 200; API com `ready: true`; zero erros fatais no recorte de logs do deploy.
- Interface, API, workers, gateway e PostgreSQL saudáveis.
- Imagem web em execução corresponde à imagem construída: `sha256:7fabd8bbe03752fbd6ee1b912d09bf095b71e5e23f474164a2fc5b7ddb8ca1c2`.
- Cinco arquivos centrais da apresentação conferidos por SHA-256 contra o commit publicado.
- `.env.zuno` preservado, com hash igual antes e depois.
- Nenhum rollback necessário.

O readiness mantém o aviso preexistente `status: degraded` de `production_guard`, com `ready: true`.

## Conferência em produção

Home e produto em 360, 390, 430, 768, 1024 e 1440 px: 12 verificações aprovadas, sem overflow, imagens quebradas ou erros JavaScript. O grid tem duas, três ou quatro colunas conforme a largura. Capturas completas foram registradas em 390, 768 e 1440 px.

Busca, menu mobile, prévia de cor, preços por quantidade, seleção de tamanho/cor, swipe touch nativo e teclado da galeria foram exercitados. Nenhum formulário, pedido, pagamento ou mensagem foi enviado. As requisições de analytics foram interceptadas no navegador de conferência.

A comparação integral da resposta pública, normalizando apenas as assinaturas temporárias das URLs, permaneceu idêntica antes e depois. Digest SHA-256: `3f96e2a7b3b78f5d6c0adee16ca34b9624a035714a782b023a48aef945efd233`. Isso inclui conteúdo, configuração comercial, produtos, variações e ofertas. A loja continua em **SHOWCASE**, com carrinho e checkout desabilitados, e as condições por quantidade permanecem R$ 60/R$ 55/R$ 50.

A primeira rodada de conferência forçou carregamento antecipado de todas as fotos em várias larguras e recebeu HTTP 429 após nove verificações. As duas larguras restantes foram retomadas após a janela `Retry-After`, com sucesso; nenhum limite do servidor foi alterado. O registro final contém as 12 verificações aprovadas e essa observação.

[Capturas e registro de produção](qa/bambilu-fashion-production-20261105/README.md). [Comparação visual anterior à publicação](qa/bambilu-fashion-20261105/comparativo.html). Validações locais: 270 testes em 39 arquivos, 10 testes Playwright, typecheck e build aprovados.

## Recuperação e rastreabilidade

Host: `143.198.47.74`; diretório `/opt/zuno`; SSH com checagem estrita da chave registrada.

- Código anterior: `/opt/zuno/deploy_backups/pre-02a696d-20261105105509.tgz`.
- Banco anterior: `/opt/zuno/deploy_backups/db-pre-02a696d-20261105105509.sql.gz`.
- Configuração anterior: `/root/.env.zuno.pre-02a696d-20261105105509`.
- Pacote exato publicado: `/opt/zuno/deploy_backups/release-02a696d.tgz`.
- SHA-256 do pacote: `7488394351ace2285585087225ff3f8a8941ecaf4862820e8294437d92692009`.
- Imagem anterior da interface: `zuno-zuno-web:rollback-20261105105509`.
- Log oficial: `/var/log/vorix-deploy-02a696d-20261105105509.log`.

O pacote foi gerado por `git archive` do commit. Este relatório e as capturas de produção são registrados posteriormente em commit apenas de documentação; a aplicação publicada corresponde a `02a696d`.
