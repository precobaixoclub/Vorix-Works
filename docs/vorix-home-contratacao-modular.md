# Vorix — Home e contratação modular

## Home e páginas de produto

A primeira dobra anterior apresentava a Vorix principalmente como ferramenta para empresas que vendem por conversa. A home também repetia a mesma explicação sobre contexto em várias seções. A página de preços dava destaque a Conversas, Meetings e Suite antes de explicar Marketing e Site. A versão local apresenta as quatro ferramentas desde a primeira dobra e leva ao configurador pelo menu e pelo CTA principal. Depois das demonstrações, mostra um fluxo de trabalho entre módulos, benefícios para a equipe, usos de IA, preços resumidos e perguntas frequentes. [Home anterior](https://vorixworks.com/) · [Preços anteriores](https://vorixworks.com/precos)

Cada página em `/produtos/{conversas,marketing,site,meetings}` mostra uma tela principal, as funcionalidades em uso, os benefícios, as condições de acesso, a capacidade e perguntas específicas. As páginas compartilham os componentes em `web/components/public/CommercialShowcase.tsx`, o conteúdo em `web/features/public-site/showcase.ts` e os estilos em `web/app/commercial.css`.

## Origem das capturas

As imagens foram tiradas no Chromium das próprias interfaces da Vorix com dados demonstrativos de uma empresa fictícia. O script intercepta a API de autenticação, workspace e ferramentas. O modelo Aura usa as fotografias já distribuídas nos arquivos demonstrativos do repositório. A peça em Revisão usa foto do Aura e tipografia composta localmente. A análise da reunião, o texto da peça e os dados da transcrição foram inseridos na API simulada.

| Produto | Capturas | Origem local |
| --- | --- | --- |
| Plataforma | `dashboard` e `dashboard-mobile` | Início de um workspace de teste, inclusive uma captura vertical a 390 px e DPR 2 |
| Conversas | `inbox`, `pipeline`, `proposal` | Caixa de entrada com detalhes do contato, Kanban de oportunidades e detalhe da proposta |
| Marketing | `ideas`, `create`, `review`, `calendar` | Bolsão, Criar conteúdo, Revisão com peça e legenda, e calendário com pautas e publicações simuladas |
| Site | `site-editor`, `storefront`, `store-catalog` | Editor visual, prévia pública do modelo Aura e catálogo da mesma vitrine |
| Meetings | `recording`, `transcript`, `meeting-ai`, `recording-library`, `meeting-actions` | Opções de gravação, transcrição, resumo, biblioteca e painel de decisões e tarefas |

As capturas comerciais são WebP de 480, 960 e 1440 px. A captura vertical tem variantes de 390 e 780 px. A home prioriza a imagem principal e adia as demais com carregamento nativo. Os originais e as comparações ficam em `artifacts/vorix-comercial-local/`. As imagens que acompanham o site ficam em `web/public/marketing/comercial/`.

## Catálogo e cobrança

| Plano de Conversas | Mensal | Anual | Usuários | WhatsApps | Créditos de IA por mês |
| --- | ---: | ---: | ---: | ---: | ---: |
| Start | R$ 149 | R$ 1.490 | 2 | 1 | 500 |
| Pro | R$ 299 | R$ 2.990 | 5 | 2 | 2.500 |
| Business | R$ 599 | R$ 5.990 | 10 | 5 | 10.000 |

Conversas usa os preços oficiais de `plan_versions`. O simulador existente calcula R$ 39/mês por usuário adicional e R$ 79/mês por WhatsApp adicional acima das franquias. A comparação considera o custo da mesma capacidade e mostra os créditos e as franquias do plano superior. O catálogo publica sete dias de teste para esses planos em cadastros elegíveis. O checkout confirma o teste e as condições efetivas.

Meetings tem preço-base de R$ 147/mês ou R$ 1.470/ano com uma gravação simultânea. Cada simultânea adicional custa R$ 67/mês ou R$ 670/ano. Esses valores remuneram a capacidade de gravação da conta. Cada conta Google conectada é infraestrutura operacional. Agenda e gravação por robô dependem da configuração, da autorização Google e da disponibilidade do ambiente. O modo presencial grava áudio do microfone. Minutos, armazenamento, retenção e uso de IA seguem o contrato e os limites da conta. O endereço antigo de planos de gravação agora redireciona para a seleção de Meetings no configurador. [Catálogo público da API](https://api.vorixworks.com/v1/platform/plans)

O checkout atual aceita Conversas e Conversas com capacidade de Meetings, nos ciclos publicados. A navegação preserva o plano, o ciclo e as quantidades. A API de billing aplica as franquias, valida a disponibilidade, resolve o preço pelo catálogo e impede checkout duplicado de assinatura ativa. O catálogo público expõe os adicionais de Conversas por mês. Valores anuais com usuários ou WhatsApps extras seguem para cotação. Uma seleção só de Meetings direciona à configuração da conta. Ao abrir a conta, o responsável escolhe lá a capacidade desejada.

Marketing e Site são selecionáveis no simulador. A configuração gera um e-mail comercial com módulos, ciclo, capacidade e valores conhecidos. Site pode estar incluído no contrato ou disponível como adicional da conta. Marketing depende da liberação comercial e do acesso da empresa. Os valores de R$ 129/mês para Marketing e R$ 69/mês para Site e o pacote de R$ 419,90/mês sobre a soma de R$ 494 são propostas. Os percentuais de 5%, 10% e 15% também aguardam aprovação. O cálculo modular está preparado para aplicar uma política aprovada às mensalidades-base elegíveis. A ativação da cobrança precisa de validação de margem, elegibilidade, ciclos, migração de assinaturas e precificação autoritativa no servidor.

## Acesso e capacidade

O usuário da conta, a participação no workspace, as permissões de operação, o acesso a módulos e a capacidade cobrada são mecanismos distintos. `GET /v1/solutions` retorna as ferramentas habilitadas para a empresa. Os endpoints de cada ferramenta aplicam as permissões do usuário e o escopo da empresa. A área Conta e assinatura lista as ferramentas disponíveis, mostra o plano-base, os adicionais e o uso e abre os controles existentes de capacidade.

- **Conversas.** O adicional amplia a capacidade operacional do plano para pessoas e números de WhatsApp além da inclusão. A gestão de membros e o acesso às conversas seguem as permissões da conta.
- **Marketing.** Criar, revisar, aprovar ou operar publicação e administrar conexões seguem as permissões existentes de conteúdo, execução, aprovação e publicação. Licenças por usuário, marcas, conexões sociais e franquia própria de IA dependem de definição comercial. Créditos disponíveis e integrações habilitadas são condições do ambiente e da conta.
- **Site.** Editar, publicar e operar vendas usa as permissões existentes. Visitantes e compradores do site público são usuários externos. Quantidades de editores, sites adicionais e armazenamento exigem oferta validada. Publicação e domínio seguem a configuração do editor. Pagamento online com Mercado Pago requer conta conectada. Frete e pedidos dependem da modalidade de vendas. Marketplaces exigem provedor configurado e conexão habilitada.
- **Meetings.** O acesso de usuários segue as permissões existentes. A unidade adicional de preço público é a gravação simultânea. A capacidade e o consumo são acompanhados na conta.

Para owner e admin, a área de capacidade usa a prévia oficial. Os aumentos e as reduções seguem as regras de renovação da assinatura. O valor futuro aparece antes de salvar. A troca de um plano ativo agora exibe preço-base e inclusão antes de pedir confirmação. O endpoint de verificação dessa troca informa se o uso cabe no novo plano. Uma cotação completa da migração com adicionais exigiria suporte da API.

## Reprodução local

No diretório raiz, rode a API de catálogo simulada em um terminal com `node scripts/public-site/commercial-preview-api.cjs`. Em outro terminal, dentro de `web/`, aponte `NEXT_PUBLIC_API_URL` e `API_INTERNAL_URL` para `http://localhost:3410` e suba a prévia local. Para usar uma compilação otimizada, faça o build com essas mesmas variáveis.

- Gere os PNGs das interfaces com `VORIX_CAPTURE_COMMERCIAL=1`, `VORIX_CAPTURE_BASE_URL` apontando para a prévia local e `node scripts/public-site/capture-home-product-ui.cjs`. Em seguida, rode `node scripts/public-site/prepare-commercial-images.cjs`.
- Gere as comparações finais e os dados de desempenho com `VORIX_PUBLIC_QA_BASE_URL` apontando para o build local e `node scripts/public-site/commercial-preview-evidence.cjs`.
- Rode `npm run test`, `npm run typecheck` e `npm run build` em `web/`. Os testes Playwright em `public-commercial.spec.ts`, `public-site-organization.spec.ts` e `billing-capacity-self-service.spec.ts` usam a prévia local pelo mesmo `VORIX_PUBLIC_QA_BASE_URL`. O checkout, a assinatura e as integrações são simulados.

## Validação

- 555 testes Vitest, 75 testes de backend de catálogo, capacidade, checkout, renovação e permissões, e 46 testes Playwright passaram. Para pagamentos e assinaturas, o navegador usou respostas simuladas e os testes de backend usaram banco descartável e gateway de teste.
- Typecheck e build de produção passaram. O ESLint global registrou 240 erros e 219 avisos existentes. A comparação com o código anterior mostrou os mesmos diagnósticos nas áreas alteradas que já tinham pendências.
- A regressão de layout passou em 320, 360, 390, 600, 768, 1024 e 1440 px. O navegador verificou carregamento de imagens, foco de teclado, links, contraste nas duas preferências de tema, ciclo anual e restrições de cobrança para colaboradores.
- Na amostra do build local, a home teve LCP de 112–192 ms, CLS zero, 138–175 KB de WebP e 213–229 KB de JavaScript antes de rolar. A pior interação observada nessa amostra foi de 24 ms na home e 32 ms em Preços. São observações de laboratório. INP de campo requer coleta com usuários reais.

As imagens de comparação usam os nomes `antes-home-*.png`, `depois-home-*.png`, `antes-precos-desktop.png` e `depois-precos-*.png`. As páginas de produto têm capturas em desktop e `metricas-locais.json` registra os valores da amostra.
