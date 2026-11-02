# Ativar e inativar espaços de trabalho — 02/11/2026

O modal **Editar Espaço de Trabalho** oferece o campo **Situação do espaço**, com as opções **Ativo** e **Inativo**, aplicado pelo botão **Salvar alterações**. Usa as operações existentes `POST /v1/workspaces/:id/activate` e `/deactivate`, com a permissão efetiva `workspace:transition`.

O nome e a logo mantêm a permissão `workspace:update`. Um espaço arquivado conserva a situação terminal e não oferece ativação. Cancelar o modal descarta alterações; os controles ficam bloqueados durante o salvamento.

Cada gravação bem-sucedida atualiza o detalhe e revalida as listas de espaços, incluindo as listas filtradas utilizadas pelo seletor. Se nome/logo forem salvos e a mudança de situação falhar, o modal preserva o resultado parcial e permite repetir somente a operação que falhou.

O escopo é expor o ciclo ativo/inativo que já existia no backend. As regras operacionais de canais e integrações seguem o comportamento existente do status; esta mudança não implementa suspensão de integrações ou de acesso.

Validação: TypeScript e build da interface; 217 testes unitários; 35 testes da API/casos de uso de Workspace; dez cenários de browser em 1440 e 390 px cobrindo inativação, reativação, persistência, filtros, cancelamento, falha/repetição e permissões.

Release `51e1d06` publicada na produção em 02/11/2026, com backup pelo fluxo oficial de deploy. Readiness aprovado, web HTTP 200 e zero erros fatais nos logs. O browser autenticado confirmou o campo publicado em 1440 e 390 px, opções Ativo/Inativo disponíveis ao dono, botão de salvar habilitado após alterar a seleção, cancelamento funcionando e zero erros JavaScript/overflow. A conferência de produção não gravou nenhuma mudança de situação nos workspaces existentes.
