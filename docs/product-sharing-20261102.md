# Produto compartilhado pelo Conversas — 02/11/2026

A descrição enviada ao cliente deixava de existir após 180 caracteres. O envio agora utiliza a descrição completa, preservando quebras de linha. O seletor também permite conferir o conteúdo completo em uma área com rolagem.

O envio cria um link de ficha em `/produto/<token>`, sem exigir a solução Site nem login do cliente. A ficha mostra empresa, nome, referência, preço, opções, descrição inteira e fotos, preservando a variação e o preço escolhidos pelo atendente. Inclui metadados para prévia de link e apresentação responsiva, com fotos inteiras (`object-contain`). Em ambientes sem assinatura de compartilhamento configurada, permanece o link do site publicado quando disponível.

O token é uma capability opaca AES-256-GCM, com nonce aleatório e chave derivada por finalidade do segredo persistente da aplicação. Vincula produto, tenant, workspace e variação selecionada; não expira por uma sessão do cliente. Produto inativado/removido, variação inativada ou workspace arquivado tornam a ficha indisponível. Rotação do segredo também invalida os links. Não há nova tabela nem migration.

A API pública (`GET /v1/public/products?token=...`) devolve somente uma lista explícita de campos comerciais. Não expõe custos, margens, mínimo de negociação, estoque interno, impostos ou IDs de tenant/workspace. Fotos são autorizadas pelo escopo da chave de armazenamento; o token é redigido nos logs, e a resposta usa `no-store`/`noindex`/`no-referrer`.

O envio utiliza a foto da variação selecionada, com fallback para a capa do produto. As imagens são lidas pelo próprio armazenamento, com limite de tamanho, rotação EXIF, redimensionamento sem recorte e conversão JPEG para o canal. Descrições que excedem 1.024 caracteres com o cabeçalho/link seguem integralmente em uma mensagem de texto após a foto, cuja legenda contém nome e preço. Sem foto ou com a opção desmarcada, a mensagem textual mantém descrição e link completos.

Validação local: 15 testes de Commerce/compartilhamento, 86 regressões de mídia/catálogo/uploads/readiness, 217 testes da interface e seis cenários de browser em desktop/celular. Incluem produto sem Site, foto exclusiva da variação, legenda longa, texto sem foto, token adulterado/tenant incorreto, inativação e exclusão de campos internos. TypeScript, build da interface, isolamento CRM e 49 contratos aprovados.

Os testes de envio usam fila/provider de fixture e não enviam mensagens para destinatários reais.

Release `7a50eab` implantada em produção em 02/11/2026 pelo fluxo oficial com backup. Readiness aprovado, web HTTP 200 e zero erros fatais nos logs.

A conferência autenticada por capability, sem envio de mensagens, abriu a ficha do produto real `Lampada` no workspace Preço Baixo Club. A API e o browser sem login preservaram os 449 caracteres cadastrados, com HTTP 200 em 1440 e 390 px e sem overflow. A resposta não continha campos internos, e a capability com tenant incorreto retornou 404. Não há fotos cadastradas nos produtos ativos deste workspace nesta conferência; o caminho de imagem/variação foi validado com arquivos reais de fixture (conversão WebP→JPEG e proporção 40×80 preservada).
