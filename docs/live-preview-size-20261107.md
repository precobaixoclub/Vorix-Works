# Prévia maior no editor do site — 07/11/2026

O editor aproveita a largura disponível da página. Nas seções de personalização, a navegação fica no topo e o formulário ocupa uma coluna menor, liberando espaço para o site ao vivo. A galeria de modelos e as regras comerciais mantêm sua navegação lateral.

No computador, a prévia preenche a altura disponível da janela, sem ter sua altura útil reduzida pela escala. Na janela de 1440 × 1000 px usada na conferência, a largura da prévia passa de aproximadamente 528 para 814 px, com escala de ajuste próxima de 56% em vez de 37%.

O seletor de zoom oferece ajuste automático, 50%, 75%, 100%, 125% e 150%. Quando o site ampliado ultrapassa a área disponível, a rolagem horizontal permite ver toda a largura. O acompanhamento do campo em edição também ajusta essa posição. O botão de visualização ampliada fica identificado por texto no computador.

O acompanhamento considera a altura do cabeçalho fixo da loja. Se o texto cresce e sua posição muda durante a digitação, a prévia reposiciona o destaque para que o cabeçalho não cubra o começo do conteúdo.

Ao focar ou alterar um campo, a página encaixa a prévia abaixo da barra superior também no computador, aproveitando toda a altura sem exigir rolagem manual. Esse encaixe usa a posição atual do painel fixo, preservando a navegação por formulários longos.

O celular mantém a prévia compacta, os modos de computador/tablet/celular, o recolhimento e o formulário com rolagem própria. Zoom e modo de visualização são locais à sessão do editor e não alteram rascunho ou publicação.

Não há alterações no conteúdo das lojas, catálogo, regras comerciais, backend, banco de dados ou permissões do iframe.

## Validação

- TypeScript aprovado.
- Teste específico da área ampliada, zoom em 100%, rolagem horizontal, retorno ao ajuste automático, atualização imediata e ausência de gravação de rascunho aprovado em computador e celular.
- 20 cenários de regressão aprovados em computador e celular: edição nos seis modelos, imagens, links, banners, páginas internas, salvamento/publicação com dados fictícios, rodapé, seções, galeria e busca da prévia.

- Após o ajuste de posicionamento sob o cabeçalho, os seis cenários de acompanhamento, banner/página interna e ampliação foram repetidos com sucesso.
- Capturas locais: [computador](qa/live-preview-size-20261107/local-editor-desktop.png) e [celular](qa/live-preview-size-20261107/local-editor-mobile.png).

## Publicação

Registro da publicação e das verificações finais será acrescentado após o deploy.
