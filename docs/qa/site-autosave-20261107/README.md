# Editor com salvamento automático — 07/11/2026

O editor salva o rascunho automaticamente e mantém Publicar e Restaurar versão em produção como ações principais. Mudanças em regras comerciais e modo de venda ficam no mesmo rascunho do conteúdo e são aplicadas na transação da publicação. A restauração também recupera essas configurações sem alterar a loja pública antes da publicação.

A navegação e a prévia são compartilhadas por todas as abas, incluindo Regras Comerciais. Títulos, descrições e botões dos blocos de contato podem ser editados. Redes sociais têm seleção de plataforma e ícones acessíveis, com links em outra aba. Os seis modelos usam o mesmo rodapé.

## Validação local

- TypeScript do backend e frontend: aprovado.
- Vitest: 36 testes aprovados (fila de autosave, histórico, redes sociais, personalização, paridade dos modelos e mídia de produtos).
- Publicação comercial: 4 testes de integração aprovados, incluindo preservação da produção, aplicação conjunta de preços/modo/conteúdo, conflito, rollback, permissões e restauração.
- Regressão do backend: cenários de catálogo, personalização, regras comerciais, carrinho, checkout, pagamentos e isolamento aprovados.
- Navegador: edição nos seis modelos, navegação por clique, campos, imagens, páginas, prévia, publicação e restauração em 1440 × 1000 e 390 × 844; demonstrações em oito larguras.
- Bambilu e Commerce: administração de regras, cálculo do carrinho, checkout/pedido, seis modelos em seis larguras, edição do conteúdo padrão e preenchimento do banner aprovados.
- O teste que publica descontos restaura sua configuração comercial fictícia ao terminar, para não interferir nas verificações de SEO de outros testes. A rodada complementar com esses cenários e autosave terminou com 8 testes aprovados.

Os testes de edição usam banco, imagens e usuários fictícios locais. Nenhum rascunho, regra, produto, credencial ou publicação do cliente é escrito pela validação. Campos inválidos ou falha de rede mantêm a edição na tela e exibem o estado de erro; a publicação aguarda a gravação pendente.

## Produção

O resultado do deploy e da verificação do frontend publicado será registrado nos arquivos JSON deste diretório. A verificação de edição usa o JavaScript publicado com API fictícia interceptada; o site real é consultado somente em leitura.
