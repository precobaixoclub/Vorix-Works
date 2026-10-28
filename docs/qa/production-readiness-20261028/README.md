# Evidências — revisão final de produção

Execução de 28/10/2026, partindo de `576d781`, 187 migrations aplicadas e nenhuma pendente.

O relatório final fica em `docs/production-readiness-final-20261028.md`; procedimentos vigentes em `docs/operations/production-readiness.md`.

- `local-validation.json`: totais e limites da validação; não confunde mocks com provedores reais.
- `screenshots/`: Site/checkout, pedidos, Catalog Bulk, Analytics e Marketplaces nas seis larguras solicitadas. Somente dados QA.
- `production-before.json`: auditoria somente leitura, sem valores de credenciais ou dados de contatos.
- `pglite-reproduction-before.txt` e `pglite-validation-after.txt`: erro de protocolo reproduzido sem serialização e validação após correção; não é falha do PostgreSQL de produção.
- `runtime-stress.txt`: três rodadas de runtime/PGlite/operação, 13 testes cada, sem retries ou skips.
- `postgresql-concurrency.txt`: PostgreSQL real descartável; compra concorrente da última unidade, chave repetida, aprovação repetida, estorno simulado e reposição. Não é homologação do Mercado Pago.
- `database-restore-before.txt` e `media-restore.txt`: restore QA; o ensaio final após deploy também confere página publicada e descriptografia de segredo restaurado.
- `architecture.txt`: verificações arquiteturais existentes.

Na rodada de navegador, 52 casos passaram inicialmente; dois checks de Analytics em 360/430 px usavam incorretamente o layout desktop. O teste passou a seguir o breakpoint real e ambos foram reexecutados com sucesso. Analytics com backend real efêmero passou nas seis larguras. O cadastro do segredo de webhook tem verificação adicional no navegador.

Credenciais externas ausentes: nenhum PIX/cartão, frete ou fluxo de marketplace foi declarado homologado. Backups privados (banco/configuração/mídias) ficam fora do Git; apenas contagens, hashes e resultados sanitizados podem ser registrados aqui.
