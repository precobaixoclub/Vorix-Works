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

## Produção atualizada

Versão funcional `edc990ad`, implantação oficial com alvo `all`, concluída com `DEPLOY_DONE`. Os 45 arquivos conferidos correspondem ao commit e as cinco imagens da aplicação em execução correspondem às imagens geradas. Os seis containers estão saudáveis, API pronta, frontend 200, zero erros fatais nos logs verificados e arquivo de ambiente preservado. O conteúdo público da Bambilu permaneceu igual à leitura anterior ao deploy.

O frontend publicado foi testado com API fictícia interceptada em 1440 × 1000, 1920 × 1080 e 390 × 844: salvamento automático, edição de títulos, seleção e ícone de rede social, regras/modo aguardando Publicar, layout com prévia e restauração da produção aprovados. O fluxo adicional de carregar uma publicação histórica e republicar suas condições comerciais também passou. Nenhuma escrita foi enviada à API de produção e nenhum erro de JavaScript ocorreu nesses cenários.

Os backups e as imagens de rollback foram preservados. A limpeza apenas do cache de build Docker sem uso liberou 5,957 GB; permaneceram 7.540 MB disponíveis. As evidências estão em `production-host.json`, `production-editor-validation.json` e nas capturas `production-*.png`.
