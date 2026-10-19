# Vorix Site — personalização pelo próprio cliente

Revisão de 18/10/2026. Correção do editor e da apresentação pública após comparação com o projeto Bambilu Kids informado pelo usuário.

O editor anterior oferecia alterações básicas de conteúdo, mas não reproduzia a autonomia de personalização usada como referência. Os modelos tinham pouca diferenciação e a prévia compartilhava o contexto visual do painel. Esta revisão substitui essa experiência por um editor organizado e um renderizador próprio, compartilhado entre o site publicado e a prévia em documento isolado.

## Referência e escopo

O ZIP foi inspecionado como referência de funcionalidades. Nenhum script do projeto foi executado. Marca, textos, produtos, imagens de clientes, credenciais e configurações privadas do Bambilu não foram importados para o Vorix. Os recursos foram implementados na arquitetura existente, com autenticação, permissões, armazenamento e catálogo do Vorix.

| Necessidade observada na referência | Implementação no Vorix |
| --- | --- |
| Aparência da marca | Três modelos com paletas, cabeçalhos, tipografia e cartões diferentes; cores próprias, fontes, leitura, botões, largura e espaçamento ajustáveis. Trocar modelo conserva conteúdo e produtos. |
| Cabeçalho e navegação | Logo, tamanho, posição, busca, menu fixo, links internos/externos, ordem, visibilidade, botão de destaque e faixa de aviso. |
| Banners | Imagem principal ou carrossel de até dez banners; imagens próprias para computador e celular; textos, botões, descrição acessível, ordem e início/fim opcionais. |
| Organização da página inicial | Arrastar seções ou usar setas; adicionar, editar, duplicar, ocultar e remover com confirmação; desfazer/refazer no rascunho. |
| Conteúdo por blocos | Banner, texto formatado, catálogo, categorias, contato, imagem, perguntas frequentes, benefícios, imagem com texto, galeria, chamada, números, depoimentos, marcas, vídeo e separador. |
| Páginas próprias | Criar páginas, editar endereço e SEO, montar blocos e conferir páginas ainda privadas. Inclusão na publicação é explícita. |
| Texto formatado | Negrito, itálico, subtítulo, lista e link. Persistência em estrutura validada; renderização com escape do React, sem HTML arbitrário. |
| Catálogo | Colunas por dispositivo, formato das fotos, cartões, preços, referência, disponibilidade, filtros, busca, ordem e carregamento progressivo. Integração com produtos e variantes existentes. |
| Rodapé e contatos | Até quatro colunas personalizadas, links, cores, texto, aviso final, contato, redes sociais e formulário integrado. |
| Conferência antes de publicar | Prévia interativa do rascunho, incluindo alterações não salvas, em iframe isolado; modos computador/celular; navegação entre páginas e produtos sem enviar formulários. |
| Controle da publicação | Salvar rascunho e publicar são ações separadas. Conteúdo público continua na versão publicada. Restauração da versão publicada e retirada do ar preservadas. |

## Compatibilidade e limites

Os campos novos são opcionais nos snapshots existentes. A revisão não exige migration e não substitui sites, produtos ou versões publicadas dos clientes. Imagens aninhadas em banners, galerias e depoimentos passam pela mesma validação de propriedade do workspace e assinatura de URLs. Revisões concorrentes, RBAC, entitlement e isolamento de tenant continuam nas APIs existentes.

Links aceitam somente destinos previstos; vídeos são limitados a YouTube/Vimeo. Cores e estilos usam valores estruturados validados. O conteúdo tem limite global de tamanho, além dos limites de páginas, seções e itens. Não há upload de código, CSS ou HTML executável pelo cliente.

Carrinho, checkout, pagamentos e frete continuam em preparação dentro do Vorix Site. Esta revisão não afirma que essas funções estejam concluídas. Não houve login Google, gravação, cobrança ou alteração de conteúdo de clientes na validação.

## Validação

Evidências locais são geradas em `tmp/site-builder-browser/` e `tmp/product-site-browser/`. Os testes de navegador usam API, JWT, frontend e PostgreSQL descartável com dados `.invalid`, sem provedores reais. As ilustrações de QA são originais geradas por código em fixture; não são instaladas nos sites dos clientes.

Resultados finais:

- Backend: build aprovado; 41 testes focados de Product/Site/personalização aprovados, incluindo RBAC, isolamento, compatibilidade, mídia aninhada e agendamento. Rodada adicional de regressão: 403 aprovados, nenhuma falha.
- Frontend: 133 testes aprovados em 18 arquivos; typecheck e build de produção aprovados.
- Navegador: 16 regressões de navegação aprovadas; rodada final dos 12 novos cenários de personalização aprovada sem falhas em computador e celular. Inclui arrastar seções, imagens por dispositivo, texto formatado, páginas privadas, persistência e separação entre prévia, salvar e publicar.
- Contratos: 49 verificados; verificações de isolamento arquitetural aprovadas. Scripts de QA verificados com `node --check`; diff sem erros de whitespace.
- PostgreSQL descartável de QA encerrado e removido ao final. Nenhum teste usou contas ou cobranças reais.

[Capturas dos três modelos e do editor](qa/site-builder/README.md). A rodada prepara a rota pública antes da edição para evitar que a compilação inicial do `next dev` recarregue abas com rascunhos durante o teste. Essa particularidade do Fast Refresh não faz parte do build de produção.

Para repetir o QA de navegador, com as dependências instaladas, Chrome e Docker disponíveis:

```bash
npm run build
node scripts/sites/test-builder-browser.mjs
```

No Windows, o executor usa Docker no WSL; no Linux usa Docker diretamente. Ele exige as portas locais 3390/3391 livres, cria PostgreSQL com publicação somente em loopback, verifica a identificação da fixture e remove apenas o container que criou. Logs ficam em `tmp/site-builder-browser/server.log` e `tmp/site-builder-browser/tests.log`. O argumento `--project=desktop` pode limitar a rodada; o padrão verifica computador e celular.
