# Regras comerciais e automações — organização e uso

Revisão local de 17/10/2026. Escopo: tornar a configuração compreensível para pessoas sem familiaridade técnica, com três exemplos de automação desativados. Outras alterações locais em estoque, cobrança, IA e relatórios foram preservadas.

## Regras comerciais

Os assuntos agora ficam separados em seções que abrem individualmente:

1. Quem pode ver e fazer o quê.
2. Descontos e aprovação.
3. Mensagens das propostas.
4. Motivos de venda e concorrentes.
5. Etapas da venda.

Campos extras e tabelas de preço ficam em opções adicionais. Acesso, fechamento e duração de contratos têm salvamento explícito, indicador de alterações pendentes e confirmação de sucesso. Alternâncias possuem rótulos acessíveis e resposta visível “Sim” ou “Não”.

O desconto é explicado com um exemplo de venda de R$ 100. Margem e preço mínimo têm explicações próprias e ficam recolhidos até serem necessários. Há resumo dos limites antes de salvar e validação de porcentagens. A edição carrega os limites existentes; as regras mostram para quem valem, sem exigir identificadores técnicos.

## Automações

O assistente segue quatro etapas: quando começar, o que fazer, em quais casos e conferir/salvar. Campos obrigatórios impedem avançar vazios. As condições são opcionais, até três, e todas precisam ser atendidas. Etapas podem ser escolhidas por nome em qualquer funil, inclusive no segundo funil; a revisão apresenta nomes, não IDs.

Três exemplos ficam disponíveis na tela:

- Novo contato: criar a tarefa “Fazer o primeiro atendimento”.
- Proposta aceita: colocar a etiqueta “Proposta aceita” no contato.
- Proposta recusada: criar uma tarefa para retomar a conversa.

O botão **Adicionar exemplos desativados** salva os três no workspace atual, sem ativá-los, e ignora exemplos já presentes pelo nome. Também é possível usar um exemplo como ponto de partida do assistente. Não há gravação automática ao abrir a página. As regras de proposta dependem de contato vinculado, com aviso na tela; os exemplos não enviam mensagens.

Toda criação pelo novo fluxo informa `active=false`. O backend aceita esse campo e grava o estado na própria inserção: não há intervalo entre criar uma regra ativa e desativá-la. Para compatibilidade, clientes antigos que omitem o campo mantêm o comportamento anterior. As regras existentes não são desativadas automaticamente.

A ativação exige confirmação separada. Ajustar e salvar uma regra ativa a deixa desativada para revisão, com aviso antes do salvamento. Histórico, desativação e exclusão estão separados da área clicável de revisão, sem botões aninhados.

## Validação

- Backend: build e typecheck aprovados; oito testes de automação aprovados, incluindo POST real da rota com PGlite, ausência de tarefas e logs enquanto desativada e execução apenas após ativação explícita.
- Frontend: typecheck, build de produção e 112 testes aprovados.
- Navegador desktop e celular: quatro testes aprovados, cobrindo criação dos três exemplos desativados, confirmação antes de ativar, assistente com campos obrigatórios, condições vazias, seleção de etapa em outro funil, revisão por nome, salvamento explícito de acessos, validação de desconto e ausência de overflow horizontal.
- Capturas revisadas em `tmp/settings-usability/`; testes em `web/e2e/settings-usability.spec.ts`, executados com `playwright.sales-qa.config.ts`.

Não foi aplicada migration nem ativada automação em produção. Esta revisão modifica o código local; não houve commit, push ou deploy desta etapa.
