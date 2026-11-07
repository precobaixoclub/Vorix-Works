# Personalização de sites — 07/11/2026

O editor mostra o rascunho em tempo real, sinaliza alterações não salvas e acompanha o campo, seção, item, link ou banner em edição. O acompanhamento pode ser desligado para navegar livremente pela prévia. O conteúdo público só muda ao publicar.

No computador, a prévia acompanha a rolagem ao lado do formulário. Em telas menores, o formulário tem rolagem própria e a prévia permanece acima dele. O ajuste de rolagem do workspace se limita à rota do editor de sites.

Os campos de imagens têm botões azuis de adicionar/trocar, dimensões e proporções recomendadas, formatos e limite de arquivo. Os textos mostram recomendação editorial, contador e limite aceito quando aplicável. As recomendações não cortam conteúdo existente.

Os links são organizados por item e oferecem destinos guiados: página, seção, outro site, WhatsApp, e-mail, telefone ou endereço personalizado. Domínios externos podem receber https:// automaticamente; links existentes com parâmetros continuam preservados. As seções disponíveis usam âncoras reais, sem opções duplicadas.

Os componentes são compartilhados pelos seis modelos, mantendo as identidades visuais. O acompanhamento do carrossel só altera a prévia, sem modificar as configurações salvas.

## Validação

- Typecheck frontend aprovado.
- 280 testes frontend em 41 arquivos aprovados em 07/11/2026.
- Última rodada de navegador: 14 testes aprovados em computador e celular. Inclui os seis modelos, atualização sem salvar/publicar, foco preservado, acompanhamento e navegação livre, links guiados, upload/troca/remoção, páginas internas e carrossel.
- Regressões de salvar/reabrir, publicar, mover/duplicar/ocultar seções, desfazer e formatação aprovadas.
- Prévia e elemento destacado conferidos dentro do viewport durante edição de campos mais abaixo na página.
- Os testes interativos usam dados fictícios locais; não gravam conteúdo em lojas de produção.

## Evidências locais

Capturas da rodada aprovada em [qa/site-editor-20261107](qa/site-editor-20261107). Os dados exibidos são fictícios.

Publicado em 07/11/2026. [Resultado do deploy e conferências de produção](production-site-editor-deploy-20261107.md).
