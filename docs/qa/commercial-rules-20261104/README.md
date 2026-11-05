# Evidências — Regras Comerciais

Validação local iniciada em 04/11 e concluída em 05/11/2026. Banco descartável, autenticação normal, produtos fictícios e pagamento sandbox. A loja de teste usa o slug `bambilu-kids` para exercitar a configuração entregue. Não houve alteração da loja em produção.

[Relatório de arquitetura, migration, API e resultados](../../commercial-rules-implementation.md).

| Tela | Desktop | Mobile |
| --- | --- | --- |
| Listagem de regras | [1440 px](admin-1440.png) | [390 px](admin-390.png) |
| Configuração da regra inicial | [1440 px](initial-rule-1440.png) | [390 px](initial-rule-390.png) |
| Cadastro de regra por valor | [1440 px](form-1440.png) | [390 px](form-390.png) |
| Site com faixas | [1440 px](site-1440.png) | [390 px](site-390.png) |
| Carrinho com 5 unidades | [1440 px](cart-5-1440.png) | [390 px](cart-5-390.png) |
| Checkout | [1440 px](checkout-1440.png) | [390 px](checkout-390.png) |

Também disponíveis: [carrinho com 2 unidades](cart-2-390.png), [carrinho com 3 unidades](cart-3-390.png), [pedido final](order-390.png), [snapshot financeiro do pedido](order-pricing.json) e [36 verificações de template/largura](templates-responsive.json).

Reprodução:

```powershell
# Na raiz: compila o backend e aplica as migrations somente nos bancos dos testes
npm run build
node --test tests/commercial-rules.test.mjs tests/commercial-rules-integration.test.mjs tests/commerce-checkout.test.mjs tests/site-commerce.test.mjs
npm run typecheck

cd web
npm test -- --maxWorkers=2
npm run typecheck
npx playwright test -c playwright.commercial-rules.config.ts
npm run build
```

A configuração Playwright inicia o fixture local em `127.0.0.1:3390` e o frontend em `127.0.0.1:3391`. O fixture cadastra a regra pelo endpoint normal, usando `config/commercial-rules/bambilu-kids-progressive.json`. As publicações de template exercitadas nos testes ocorrem exclusivamente nessa loja descartável.
