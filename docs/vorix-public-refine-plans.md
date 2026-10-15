# Vorix — refinamento premium do site + planos personalizáveis

14/10/2026. Implementação e validação locais (build de produção em `localhost:3003`, API de preview `localhost:3002` com o catálogo oficial `plan_versions`). Nenhum deploy.

## Auditoria do design anterior

| Decisão | Elemento | Motivo |
|---|---|---|
| KEEP | Paleta, tokens `--public-*`, tipografia, header com dropdown, showcase com abas, FAQ, footer, metadata/OG | Direção aprovada e funcionando. |
| REFINE | Headline do hero (4 linhas, 62px) | Encurtada para 3 linhas com quebra controlada. |
| REFINE | Subtítulo do hero | De 3 linhas genéricas para 1 frase objetiva. |
| REFINE | Cards de preço (7 itens, textos de 9–10px) | No máximo 4 destaques; nenhum texto comercial abaixo de 11px. |
| REFINE | Diferenciais | Viram a seção "Plataforma", com capacidades reais. |
| REFINE | CTA final | CTA ligado à proposta. |
| REWORK | Produtos (dois cards iguais com listas de 6–7 itens) | Blocos alternados: problema → resultado → produto → 4 capacidades → CTA. |
| REMOVE | "Em três passos" | Genérico, com cara de template. Substituído pela jornada "Antes da reunião / Durante e depois / No dia a dia". |
| REMOVE | Faixa abaixo do hero | Redundante com os chips de produto. |
| REMOVE | Simulador "Calcular" antigo | Substituído pelo configurador com preço em tempo real. |

## Narrativa da home

Hero (plataforma + Conversas + Meetings, prova visual) → Problema → Plataforma → Conversas → Meetings → Juntos → Planos + Monte seu Vorix → FAQ → CTA final.

## Modelo comercial no site

| Conceito | Onde vive | O que o site faz |
|---|---|---|
| CATALOG / PRICE (Conversas) | `plan_versions` + `addon_definitions` | Lê `GET /v1/platform/plans`; cotação por `POST /v1/platform/plans/simulate` (`recommendBestPlan`, a mesma conta do checkout). O front nunca recalcula. |
| PRICE (Meetings/Suite) | `PUBLIC_REFERENCE_PRICES` (provisório, centralizado) | Mostra como "referência"; nunca contratável. |
| Preço faltante | `PENDING_COMMERCIAL_PRICES.meetingsAdditionalConcurrentRecording = null` | Linha "a definir"; nenhum valor inventado. |
| COMMERCIAL AVAILABILITY | Gate de soluções (`isSolutionContractable`) | CTA de cadastro só para Conversas. Meetings e Suite levam a conversa com o time (e-mail com a configuração preenchida). |
| SUBSCRIPTION / USAGE | Produto → Configurações → Plano | Usuários e números ajustados por add-ons já existentes (`purchaseAddon`/`removeAddon`). |
| RecorderAccount | Infraestrutura do Meetings | Nunca cobrada como licença. A unidade comercial é "gravação simultânea"; contas extras ficam como reserva. |

Unidades: Conversas = usuários + números conectados; Meetings = gravações simultâneas. O configurador não usa a palavra "bot".

## Configurador "Monte seu Vorix"

- Seleção de produtos (pelo menos um sempre marcado). Conversas + Meetings = "Suite Vorix" no resumo.
- Steppers com mínimo e máximo (usuários 1–100, números 1–20, gravações 1–10). Funcionam por clique, digitação e setas; no máximo, aparece "fale com o time".
- Total com `aria-live`, composição recolhível ("Ver composição do preço") e notas de disponibilidade.
- Tempo de resposta: o primeiro valor é o próprio plano de entrada, sem chamar a API. Depois disso:
  - cache por configuração;
  - pré-busca das configurações vizinhas a partir da interação (mouse ou foco), sem chamadas só por abrir a página;
  - medição local: **48 ms** do clique ao preço novo.
- Mobile: barra fixa com o total enquanto os controles estão na tela; ela some quando o resumo aparece.

## Preços

```text
CONVERSAS_PRICE = R$ 149/mês (oficial, plan_versions START); adicionais oficiais: usuário R$ 39, número R$ 79
MEETINGS_PRICE  = R$ 147/mês — referência provisória, não contratável
SUITE_PRICE     = R$ 297/mês — referência provisória, não contratável ("Experiência integrada", sem "Mais vantajoso")
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE    = NO
```

## Decisões comerciais pendentes

1. Preço de gravação simultânea adicional do Meetings (hoje "a definir").
2. Coerência da Suite. A referência de R$ 297 é R$ 1 mais cara que Conversas Start (R$ 149) + Meetings (R$ 147) = R$ 296. No configurador, a Suite aparece como soma das partes. É preciso definir o preço oficial do pacote ou ajustar a referência.
3. Limites do Meetings por plano: minutos, retenção, armazenamento e créditos de IA.
4. Regra de cobrança de Meetings (upgrade imediato com pró-rata, redução no próximo ciclo), a ser implementada pelo provider de billing quando Meetings for contratável.

## Pendências técnicas

1. O billing ainda não tem produto, preço ou assinatura para Meetings (`maxConcurrentRecordings` hoje vive em `solution_entitlements.limits`).
2. O cadastro (`/signup?plan=`) recebe só o plano. Usuários e números escolhidos no configurador são confirmados depois, em Configurações → Plano. Levar a configuração direto ao checkout exige estender o signup.
3. A tela "Gerenciar plano" só cobre Conversas. A visão unificada ("Conversas: 5 usuários · 2 números / Meetings: 2 gravações simultâneas") depende do item 1.
4. Bug existente no app autenticado (não alterado nesta rodada): `settings/plano` exibe "US$" em valores cobrados em BRL (`Adicionar · US$ {price}`, `US$ .../mês`).

## Validação

- Web: typecheck PASS; 107/107 testes (14 arquivos; +13 do configurador); build de produção PASS.
- Browser smoke oficial (`scripts/public-site/browser-smoke.mjs`, atualizado para a nova estrutura): todos os itens PASS, inclusive o configurador. Zero erros de página.
- Varredura 320/360/375/390/430/768/1024/1440 × `/`, `/precos`, `/produtos/conversas`, `/produtos/meetings`: nenhum overflow horizontal.
- Âncoras internas: nenhuma quebrada.
- Nomes acessíveis: nenhum controle sem nome; 1 `h1` por página.
- Configurador operável só por teclado.
- Performance (uma execução local, build otimizado): CLS 0; LCP 592 ms (antes 600 ms); JS 263 KB (antes 265 KB); nenhuma dependência nova.
- Backend: não alterado.

Evidências: `docs/qa/public-refine-20261014/`. O "antes" está em `before-home-*.png`; o depois, em `desktop-1440.png`, `mobile-390.png`, `tablet-768.png`, `sections/` e `configurator/`.
