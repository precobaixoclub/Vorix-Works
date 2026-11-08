# Seleções e finalização pelo WhatsApp — produção em 08/11/2026

Aplicação [`79910988`](https://github.com/precobaixoclub/Vorix-Works/commit/7991098811e0840dd48d46e51dfce9db72315443), enviada à `main` e publicada pelo procedimento oficial com alvo `all`.

O cliente finaliza sem informar nome ou telefone. O Vorix registra a seleção e a oportunidade e abre o WhatsApp com os itens e o link de consulta/edição. A mensagem recebida pelo WhatsApp conectado identifica o contato e o vincula à oportunidade existente. Checkout online, carrinhos híbridos, histórico e apresentação para PDF permanecem disponíveis.

## Resultado

- `DEPLOYED 79910988` e `DEPLOY_DONE` confirmados.
- Migration `0194_site_selections` aplicada: **195 migrations, nenhuma pendente**.
- Seis contêineres saudáveis; as cinco imagens da aplicação em execução correspondem às imagens construídas.
- API com `ready: true`, site HTTP 200 e zero erros fatais no recorte de logs do deploy.
- Os 33 arquivos da release conferidos por SHA-256 correspondem ao commit.
- Arquivo `.env.zuno` preservado, conferido contra o backup sem expor seu conteúdo.
- Conteúdo público da CMKV preservado, normalizando somente assinaturas temporárias de imagens. Nenhum rollback necessário.

O readiness mantém o aviso preexistente de `production_guard`, com `ready: true`.

## Validação

- **306 testes frontend** aprovados; build de produção e TypeScript aprovados.
- **115 testes backend relevantes** aprovados em Linux: seleção/WhatsApp, checkout, publicação, regras comerciais, catálogo/CMS e Analytics.
- Typecheck, compilação e todas as verificações de arquitetura aprovados no ambiente Linux isolado.
- Dois testes locais de navegador cobrem finalização sem cadastro, revisão, reenvio e larguras de 360 a 1440 px.
- O frontend publicado foi conferido em 1440 e 390 px: ausência de campos de nome/telefone, payload sem dados pessoais, abertura do WhatsApp em um clique, sem overflow ou erros JavaScript.

Na conferência do navegador publicado, a API da seleção e o destino do WhatsApp foram interceptados com respostas de teste. Nenhuma escrita foi enviada à API de produção e nenhuma mensagem foi enviada a clientes. A vinculação real entre seleção, contato e oportunidade foi exercitada em banco descartável nos testes de integração.

O gate geral encontrou o limite padrão de heap do Node no contêiner descartável e foi repetido com 2048 MB, como no build oficial. Tipos, compilação e arquitetura passaram. A suíte geral completa foi interrompida para limitar a pressão de memória no host; ela **não é apresentada como concluída**. A liberação utilizou as seis suítes relevantes acima, executadas com concorrência 1 no runtime Linux isolado, todas aprovadas. Código, dependências e configurações da aplicação não foram alterados para esses ajustes do executor.

## Evidências e recuperação

- [Conferência do host e das imagens](qa/site-selections-20261108/production-host.json).
- [Conferência pública](qa/site-selections-20261108/production-public.json).
- [Navegador publicado](qa/site-selections-20261108/production-browser.json).
- [Computador](qa/site-selections-20261108/production-selection-1440.png) e [celular](qa/site-selections-20261108/production-selection-390.png).

Host verificado por SSH estrito: `143.198.47.74`, diretório `/opt/zuno`.

- Log oficial: `/var/log/vorix-deploy-79910988-20261108225451.log`.
- Código anterior: `/opt/zuno/deploy_backups/pre-79910988-20261108225451.tgz`.
- Banco anterior: `/opt/zuno/deploy_backups/db-pre-79910988-20261108225451.sql.gz`.
- Ambiente anterior: `/root/.env.zuno.pre-79910988-20261108225451`.
- Release exata: `/opt/zuno/deploy_backups/release-79910988.tgz`.
- SHA-256 do pacote: `198ec30a36d319fae5568472e1cc0a8c77bd586a6ad47e0809814d8b527c2d55`.
- Imagens anteriores: `rollback-20261108225451`.
- Resumo dos testes Linux: `/tmp/selections-gate-79910988-final.log`.
- Log das 115 regressões: `/var/log/vorix-selections-79910988-tests.log`.

Os backups e as imagens de rollback foram preservados. Foram removidos somente imagens sem uso, cache de build, a área temporária de QA e cópias de pacotes temporários comprovadamente idênticas às releases arquivadas. A limpeza do cache de build recuperou 5,96 GB; após remover as cópias temporárias, permaneceram 9.658 MiB livres no host. O relatório e as evidências são registrados em commit posterior de documentação; a aplicação publicada corresponde a `79910988`.
