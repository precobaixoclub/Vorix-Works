# Contatos com telefone obrigatório — 02/11/2026

O cadastro no CRM exige telefone válido. O número é normalizado e gravado junto com o contato, antes de timeline e automações. O repositório PostgreSQL também aplica a validação, inclusive nas integrações que não passam pelo caso de uso. Edições dos campos personalizados preservam o telefone e rejeitam sua remoção ou substituição por valor inválido.

A validação usa `libphonenumber-js/max` com metadados de numeração, aceita telefones fixos, celulares, números internacionais e a normalização brasileira já existente para números legados do WhatsApp. Validade no plano de numeração não comprova linha ativa ou titularidade. LIDs conhecidos, JIDs de grupos, UUIDs e textos com dígitos não são números de contato.

Nas conversas, o backend resolve o telefone diretamente no Inbox do mesmo tenant/workspace e respeita a visibilidade do usuário; não aceita um telefone fornecido pelo navegador para substituir um LID. A ponte automática persiste o telefone real desde a criação. Marketplaces sem telefone do comprador continuam registrando o pedido sem criar um contato incompleto no CRM.

O formulário público do Site também exige telefone: a rota valida e normaliza o número, e o repositório transacional aplica a mesma regra antes da gravação direta. E-mail permanece opcional. Os builds Docker recebem heap de 2 GiB, após o limite automático de aproximadamente 1 GiB interromper o compilador TypeScript na VPS de 2 GiB com swap; o primeiro deploy foi revertido automaticamente antes da troca dos serviços.

## Limpeza autorizada

`scripts/cleanup-invalid-contacts.mjs` funciona em prévia por padrão e exige tenant, workspace e arquivo privado de relatório. Na execução, exige também a contagem esperada de exclusões. Uma transação com bloqueio das tabelas impede que uma resolução de telefone concorra com a exclusão. Falha ao gravar o relatório ou divergência de contagem cancela a operação.

Todos os contatos sem telefone válido do escopo escolhido são excluídos, mesmo quando possuem atividade comercial. As chaves estrangeiras existentes preservam conversas, tarefas, negócios e propostas, removendo seus vínculos quando previsto pelo schema. Identidades e participantes dependentes acompanham a exclusão do contato. Fazer backup completo do banco antes da execução.

Fontes válidas do Inbox, identidades manuais e telefones gravados apenas como nome inteiramente numérico são recuperados para `custom_fields.phone` antes da limpeza; nomes que correspondem a LID conhecido não são recuperados como telefone.

Escopo identificado na produção: tenant `tenant-vorix`, workspace `workspace-mscc9pi2-jkvwbo` (Preço Baixo Club), 60 contatos antes da limpeza. Outros tenants/workspaces não são alvos da exclusão.

```sh
node scripts/cleanup-invalid-contacts.mjs --tenant-id tenant-vorix --workspace-id workspace-mscc9pi2-jkvwbo --report /caminho-privado/preview.json
node scripts/cleanup-invalid-contacts.mjs --tenant-id tenant-vorix --workspace-id workspace-mscc9pi2-jkvwbo --report /caminho-privado/applied.json --apply --expected-removals CONTAGEM_DA_PREVIA
```

## Validação

- Build e TypeScript do backend e frontend aprovados.
- Regressões de CRM/identidade/telefones: 171 cenários; o novo cenário de marketplace foi corrigido para usar ID de pedido numérico e a suíte de sete cenários de marketplace passou.
- Checkout, Site e readiness: 66 testes aprovados.
- Frontend: 217 testes aprovados.
- Browser: oito cenários em 1440 e 390 px, incluindo bloqueio do formulário sem telefone, envio do número no cadastro e erro de número inválido.
- Isolamento CRM e 49 contratos backend/frontend aprovados.

O DNS atual da API aponta para `143.198.47.74`, autenticado por chave já registrada no `known_hosts` local. O IP `209.97.152.212` da configuração antiga não foi usado: sua chave não correspondia ao registro conhecido.

## Resultado em produção

Release `caf4105` implantada em 02/11/2026. Readiness aprovado, web HTTP 200 e zero erros fatais nos logs da implantação.

A limpeza foi concluída às 11:42 (America/Sao_Paulo), no workspace Preço Baixo Club: 60 contatos antes, cinco excluídos e 55 preservados. Os 55 telefones reais foram recuperados para o campo canônico. A prévia após a execução retornou zero candidatos à exclusão; a conferência direta confirmou zero contatos restantes com telefone inválido ou ausente.

O smoke autenticado da API retornou HTTP 400 nas quatro tentativas de cadastro sem telefone/com telefone inválido e HTTP 400 ao tentar cadastrar um contato real do Inbox que só possuía LID. A listagem autenticada retornou HTTP 200 com os 55 contatos.

Contagens preservadas antes/depois: 95 identidades do Inbox, duas conversas, 40 mensagens, um negócio, uma tarefa e duas propostas. Os seis contatos de outros workspaces também permaneceram. As identidades técnicas do Inbox continuam disponíveis para roteamento e futura resolução de telefone, sem gerar contatos incompletos no CRM.

Backup integral do banco verificado e relatórios privados de prévia, aplicação e conferência em `/opt/zuno/deploy_backups/contact-phone-5aee7e1-20261102144238/` (arquivos com permissão 0600). Nenhum dado pessoal desses relatórios foi incorporado ao Git. A revisão final do formulário público passou em 49 testes de Site/CRM, além dos checks anteriores.
