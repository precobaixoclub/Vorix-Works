# Quantidades do plano e próxima cobrança

Revisão de 18/10/2026. Publicação em produção autorizada pelo usuário após a validação abaixo, incluindo o trabalho local anterior de Product Engine e Site Engine.

## Comportamento entregue

- Dono ou administrador ajusta usuários, números de WhatsApp, gravações adicionais já contratadas e outros adicionais disponíveis em **Configurações → Plano e cobrança → Quantidades do seu plano**. Os mínimos incluídos no plano e os limites comerciais continuam válidos.
- A tela mostra a quantidade atual, a escolhida para o próximo ciclo e o próximo valor antes de habilitar **Salvar quantidades**. O salvamento envia o valor recorrente ao gateway imediatamente, sem cobrança proporcional e sem mudar a data de renovação.
- Aumentos liberam capacidade imediatamente. Reduções preservam a capacidade já paga até a renovação e não podem ficar abaixo do uso existente. Novas alocações respeitam a redução já escolhida; o administrador pode cancelá-la ou alterar a quantidade novamente.
- Cancelar uma redução recompõe o próximo valor e preserva as outras alterações. Recarregar a página mantém as quantidades futuras e o preço salvo.
- A validação considera todos os campos antes de escrever, preserva os preços contratados, os demais adicionais e a periodicidade mensal ou anual. Falha do gateway não salva alterações locais. O scheduler aplica as reduções sem reenviar uma cobrança já sincronizada.
- O fluxo usa quantidades absolutas, bloqueio por tenant e gravação transacional local. O CORS agora permite `Idempotency-Key`, necessário para o navegador conseguir enviar o salvamento.

Meetings permanece sujeito ao gate comercial existente; este trabalho não libera sua contratação pública. Adicionais descontinuados podem ser reduzidos, mas não aumentados. A redução até zero vale para adicionais removíveis, respeitando o pacote mínimo contratado.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Regressão backend: cobrança, permissões, quotas, catálogo, Site Engine e contratos relacionados | 403 testes aprovados em 42 arquivos |
| Casos dedicados de próxima cobrança em PostgreSQL 16 descartável | 15 aprovados; container removido |
| Frontend | 123 testes aprovados em 17 arquivos |
| Navegador real, computador e celular, API/JWT/relay HTTP e PostgreSQL de fixture | 6 cenários aprovados: aumentar, reduzir e cancelar redução |
| Contratos e isolamento arquitetural | 49 contratos e verificações de isolamento aprovados |
| Compilação | Backend e frontend verificados antes da publicação |

As fixtures usam clientes fictícios e o provedor sandbox. Os adapters Mercado Pago e Stripe são testados com respostas controladas: Mercado Pago recebe uma atualização do valor recorrente completo; Stripe recebe uma atualização de itens com `proration_behavior=none`. Nenhuma assinatura real foi alterada e nenhuma cobrança real foi criada durante a validação. As capturas em [qa/capacity-renewal](qa/capacity-renewal/README.md) são dessas fixtures.

## Banco e publicação

A migration aditiva `0167_capacity_renewal_sync.sql` registra a sincronização antecipada do valor e a referência de preço capturada no gateway. Não altera migrations já aplicadas. A publicação completa também inclui `0164` a `0166` do Product Engine e Site Engine, usando o executor oficial de migrations.

O deploy usa arquivo gerado por `git archive` do commit publicado, conferência SHA-256, backup de código/banco/configuração e `scripts/deploy/deploy-production.sh ... all`. O procedimento preserva `.env.zuno`, compila os serviços em sequência e exige API e worker saudáveis, `/readyz` pronto, site HTTP 200 e ausência de erros fatais antes de declarar `DEPLOY_DONE`.

## Repetição

```powershell
npm.cmd run build
node --test tests/capacity-renewal.test.mjs
```

O teste dedicado usa PGlite por padrão. Para PostgreSQL real, `VORIX_CAPACITY_FIXTURE_PG_URL` deve apontar exclusivamente para banco descartável cujo nome começa com `vorix_capacity_fixture`. O browser usa `tests/fixtures/product-site-browser-server.mjs --capacity`, esse mesmo banco descartável, API local em `3390` e `CAPACITY_BROWSER_QA=1` com `web/playwright.product-site.config.ts`. As credenciais de fixture são públicas e não devem ser usadas em produção.

Referências dos gateways: [Mercado Pago: gerenciamento de assinaturas](https://www.mercadopago.com.br/developers/en/docs/subscriptions/subscription-management), [atualização de preapproval](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/update-preapproval/put) e [Stripe: atualização de assinatura](https://docs.stripe.com/api/subscriptions/update).
