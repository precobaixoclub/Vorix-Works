# Modelos padrão — publicação em 05/11/2026

Release [`adb3b4c`](https://github.com/precobaixoclub/Vorix-Works/commit/adb3b4c9263a65b2d5ab40a088c7be6611d5b357), enviada à `main` e publicada pelo procedimento oficial com alvo `all`.

As melhorias comuns estão disponíveis em Nexus, Aura, Pulse, Catálogo, Institucional e Vitrine editorial. Cada modelo preserva sua linguagem visual. [Nexus](https://vorixworks.com/modelos/nexus) · [Aura](https://vorixworks.com/modelos/aura) · [Pulse](https://vorixworks.com/modelos/pulse).

## Resultado

- `DEPLOYED adb3b4c` e `DEPLOY_DONE` confirmados.
- Builds Linux do backend, workers, gateway e interface aprovados.
- API `ready: true`, site HTTP 200, zero erros fatais no recorte de logs do deploy.
- Todos os seis contêineres da aplicação e banco saudáveis; as cinco imagens atualizadas em execução correspondem às imagens construídas.
- Migrations: 193 aplicadas e nenhuma pendente antes e depois; nenhuma migration foi adicionada nesta release.
- `.env.zuno` preservado, com o mesmo hash antes e depois. Nenhum rollback necessário.

O status geral do readiness mantém o aviso preexistente `degraded` de `production_guard`, com `ready: true`.

## Registro e compatibilidade

O registro carregado pela API em execução confirmou os seis IDs, formato de configuração `version: 1`, revisão visual `presentationVersion: 2` e padrão de duas colunas no mobile. As seis cores primárias continuam distintas. Os arquivos canônicos de registro do backend e frontend têm o mesmo SHA-256: `85009637436ce214b928e592ccaafd281386a6db5a9da35e2639b4d2b52062f1`.

Cinco arquivos do host foram conferidos contra o commit publicado, incluindo o registro, os controles do header, os estilos comuns e a prévia do editor. As seis imagens de apresentação da galeria responderam HTTP 200 e corresponderam, byte a byte, às imagens do commit. A galeria utiliza a revisão visual na URL para renovar seu cache.

Os componentes comuns se aplicam aos sites existentes sem regravar as escolhas salvas. A nova composição inicial e os novos padrões de layout se aplicam a novas configurações; seções removidas e escolhas explícitas, como uma coluna, continuam preservadas.

## Conferência no navegador

- Nexus, Aura e Pulse: home e produto em 360, 390, 430, 768, 1024 e 1440 px, totalizando 36 verificações aprovadas.
- Busca por Enter, navegação da galeria por setas e teclado, miniaturas, imagens inteiras e ausência de overflow conferidos.
- Bambilu Kids: expansão das cores, escolha da foto, condições por quantidade e seleção de tamanho/cor; detalhe em seis larguras, somando mais seis verificações aprovadas.
- Zero erros JavaScript e nenhuma requisição comercial de gravação na conferência. Analytics foram interceptados no navegador.
- Capturas reais de home e produto em 390, 768 e 1440 px disponíveis no [registro de produção](qa/template-parity-20261105/production/README.md).

A resposta pública da Bambilu, normalizando apenas as assinaturas temporárias de URLs, permaneceu idêntica antes e depois: SHA-256 `3f96e2a7b3b78f5d6c0adee16ca34b9624a035714a782b023a48aef945efd233`. Conteúdo, produtos, variações, preços, ofertas e modo de venda foram preservados. A loja continua em modo vitrine, com carrinho e checkout desabilitados.

Validação anterior à publicação: 276 testes frontend, 66 testes backend, typecheck, verificações de arquitetura, 11 testes de mídia, quatro testes comerciais e nove testes de editor/demonstrações aprovados. Uma repetição da matriz de demonstrações foi ignorada porque ela já testa os oito breakpoints. [Relatório de implementação](standard-template-improvements-20261105.md).

## Recuperação e rastreabilidade

Host `143.198.47.74`, diretório `/opt/zuno`, com checagem estrita da chave SSH registrada.

- Código anterior: `/opt/zuno/deploy_backups/pre-adb3b4c-20261105173635.tgz`.
- Banco anterior: `/opt/zuno/deploy_backups/db-pre-adb3b4c-20261105173635.sql.gz`.
- Configuração anterior: `/root/.env.zuno.pre-adb3b4c-20261105173635`.
- Pacote exato publicado: `/opt/zuno/deploy_backups/release-adb3b4c.tgz`.
- SHA-256 do pacote: `a3ad6f4b27befdfb804e2cd1f6ede21865364ea73f1889a56fbcbb08fe619628`.
- Imagens anteriores: etiqueta `rollback-20261105173635`.
- Log oficial: `/var/log/vorix-deploy-adb3b4c-20261105173635.log`.

O pacote foi gerado por `git archive`. O relatório e as capturas de produção são registrados em commit posterior apenas de documentação; a aplicação publicada corresponde a `adb3b4c`.
