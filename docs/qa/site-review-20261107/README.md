# Revisão consolidada do editor — 07/11/2026

Revisão de autosave, publicação, regras comerciais, restauração, endereço/domínio, textos, redes sociais, modelos e contexto do produto ativo.

Foi corrigido o carregamento da publicação anterior: as condições históricas são recuperadas com a referência atual da produção, permitindo publicar novamente sem um conflito comercial causado pela própria restauração. O editor busca a revisão mais recente do site antes de restaurar, salva o resultado automaticamente e mantém a produção intacta até Publicar. Erros de carregamento são apresentados ao usuário.

Validação:

- Os 304 testes unitários do frontend passaram. Após a correção, os 16 testes de templates e autosave passaram novamente.
- Revisão de 119 testes do backend: 118 passaram inicialmente. Um teste legado esperava que trocar o endereço mantivesse a revisão; foi corrigido para exigir a invalidação da revisão antiga, preservar o conteúdo e impedir sobrescrita por sessão desatualizada. Os 34 testes da suíte de produtos/sites passaram após esse ajuste. Nenhum erro restante nessa seleção.
- TypeScript e build de produção do frontend aprovados.
- Navegador, computador e celular: duas publicações com modos/regras diferentes, carregamento da publicação anterior, salvamento automático, preservação da produção antes de publicar e aplicação das condições históricas depois de publicar aprovados.
- Os dados dos testes são fictícios e usam banco efêmero. A implantação mantém os rascunhos e publicações reais dos clientes.

As evidências da implantação e das verificações posteriores serão incluídas neste diretório.
