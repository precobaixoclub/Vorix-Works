# Seleções do site, WhatsApp e CRM — 08/11/2026

Publicado em produção na release `79910988`. [Resultado, evidências e recuperação](../../production-site-selections-deploy-20261108.md).

O cliente finaliza pelo WhatsApp com um clique, sem preencher nome e telefone nem passar por formulário intermediário. A seleção e a oportunidade aberta são registradas antes de abrir o WhatsApp com a mensagem pronta. O link na mensagem permite consultar fotos, opções e valores e editar a mesma seleção. O checkout online mantém seu fluxo de pagamento, reserva e entrega.

## Experiência

- [Prévia no celular](selection-mobile.png)
- [Prévia no desktop](selection-desktop.png)
- [Exemplo em PDF](exemplo-selecao.pdf)

As prévias usam produtos e dados fictícios. “Salvar PDF” usa a impressão do navegador, com layout próprio; o visitante pode escolher salvar em PDF.

Em **Site → Pedidos**, a aba **Solicitações WhatsApp** mostra fotos, cliente, variações, total e ações para abrir a seleção, a oportunidade e o atendimento. Quando não há compras online, essa aba abre por padrão. São exibidos até 200 interesses recentes; oportunidades também permanecem no CRM.

## Registro e integridade

- “Finalizar pelo WhatsApp” cria a seleção e a oportunidade sem inventar dados do cliente. O contato é criado e vinculado à mesma oportunidade quando a mensagem chega ao WhatsApp conectado. Sem número da loja configurado, permanece a opção de informar dados para a equipe retornar a solicitação.
- A seleção recebe token aleatório com índice único. A referência curta continua no texto para a ponte de atendimento.
- A consulta pública retorna somente a apresentação da seleção: nome e telefone do comprador e IDs de contato/oportunidade ficam fora da resposta pública. Quem possui o link pode revisar os itens enquanto a seleção estiver aberta.
- Preços, cupons, opções, moeda e disponibilidade são validados no servidor. A solicitação assistida não cobra nem reserva estoque.
- Revisões usam comparação de versão e bloqueio temporário. Duas abas não sobrescrevem a mesma revisão. Os snapshots anteriores ficam no histórico.
- Falhas de integração mantêm a seleção e mostram registro pendente. O reenvio reutiliza o contato e a oportunidade. IDs dos itens desta seleção permitem atualizar/remover esses itens sem apagar acréscimos do vendedor.
- Uma seleção anônima permanece aguardando identificação. A mensagem recebida vincula contato, atendimento e conversa à oportunidade existente e reconhece o contato no Analytics. Quando o contato já é conhecido, a confirmação pode concluir essa vinculação imediatamente. O evento de conversão é deduplicado.
- Oportunidade encerrada ou prazo de 14 dias vencido bloqueia novas edições. A apresentação continua disponível enquanto o site estiver publicado e habilitado.
- Carrinhos híbridos enviam só as linhas assistidas para a seleção; as linhas de compra online permanecem no carrinho para o checkout.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Build do backend | Aprovado |
| Backend: comércio, checkout, publicação e regras comerciais | 62 testes aprovados, incluindo finalização sem cadastro e vinculação posterior do contato |
| Storefront: armazenamento e abertura da seleção | 8 testes aprovados |
| Navegador Chromium | 2 testes aprovados, com larguras de 360, 390, 768 e 1440 px |
| Impressão | Layout conferido e PDF de exemplo gerado |
| Build de produção Next.js | Aprovado |
| API completa com PGlite descartável e JWT | Confirmação → contato + oportunidade → mensagem → mesma oportunidade → edição → central administrativa aprovados |

Comandos principais:

```text
npm run build
node --test tests/site-commerce.test.mjs tests/commerce-checkout.test.mjs tests/site-commerce-publication.test.mjs tests/commercial-rules-integration.test.mjs
cd web
npm run build
npx vitest run tests/storefront.test.ts
npx playwright test e2e/site-selection.spec.ts --project=desktop-1440 --workers=1
```

Os testes de navegador da seleção usam respostas controladas; o smoke da API completa usa o servidor `tests/fixtures/product-site-browser-server.mjs --site-commerce`, banco descartável, contas `.invalid` e entrada de WhatsApp simulada. Não houve mensagem a clientes, chamada de pagamento, alteração no banco de produção ou deploy.

## Publicação

Aplicar a migration **0194_site_selections.sql** antes de iniciar a nova API e publicar o frontend correspondente. `PUBLIC_APP_URL` na API define a origem dos links compartilhados; o padrão é `https://vorixworks.com`. O arquivo `.env.example` documenta a variável. A mesma tela também tem rota para domínios próprios.

As mensagens históricas já enviadas ao WhatsApp não podem ser alteradas. A migration atribui links às intenções antigas que ainda existem no banco; as novas mensagens passam a incluir o link da seleção.
