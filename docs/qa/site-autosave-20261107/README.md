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

## Revisão integrada de endereço, textos e produto ativo

- O endereço padrão agora faz parte do rascunho automático e só muda ao publicar. A publicação mantém a alteração de endereço na mesma transação do conteúdo e das condições comerciais. Um endereço já utilizado impede toda a publicação, sem aplicar descontos parcialmente.
- Alterar o endereço da Bambilu preserva o visual de moda; a apresentação passa a ser mantida na configuração do modelo, independentemente do slug.
- O passo a passo do domínio tem registros copiáveis, orientação por provedor, limites de caracteres, exemplos e links oficiais. A verificação TXT comprova propriedade; apontamento e liberação da hospedagem são apresentados separadamente.
- As configurações mantêm a solução ativa inclusive após recarregar. URLs diretas de configurações de outra solução voltam às configurações do produto atual. Opções compartilhadas da conta continuam disponíveis.
- A aba Textos do site e a seleção por clique editam frases dos modelos, rótulos de formulários e botões. A prévia mostra o texto escolhido no botão de envio, mantendo o envio desabilitado.
- 47 testes unitários do frontend aprovados; 26 cenários de integração do backend aprovados, incluindo pacotes de modelos. Os cenários novos foram verificados em 1440 × 1000 e 390 × 844 com API e banco fictícios.
- Build de produção local aprovado com fontes incluídas no repositório. A tentativa anterior em produção foi revertida pelo procedimento oficial após falha no carregamento de fontes do Google durante o build; a fonte local elimina essa dependência na compilação. Licenças e origem estão em web/app/fonts.

Referências do guia: [Registro.br](https://registro.br/tecnologia/caracteristicas-tecnicas/), [Hostinger](https://support.hostinger.com/pt/articles/1583664-como-adicionar-e-remover-registros-txt-na-hostinger), [GoDaddy](https://www.godaddy.com/pt-br/help/adicionar-um-registro-txt-19232), [Cloudflare](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/). Carregamento de fontes locais: [Next.js](https://nextjs.org/docs/app/getting-started/fonts#local-fonts).
