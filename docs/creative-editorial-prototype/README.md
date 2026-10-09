# VORIX - Prototipo isolado de composicao editorial

Data local: 2026-10-06.

Escopo obedecido:

- Nenhuma chamada OpenAI.
- Nenhuma alteracao no Creative Engine ativo.
- Nenhum deploy.
- Nenhum benchmark final.
- Assets locais/controlados reaproveitados.

## Pranchas

[Overview](00-overview.png)

| Cenario | Pipeline atual | Editorial refinado | Lado a lado 4:5 | Lado a lado 9:16 | Observacao de asset |
|---|---|---|---|---|---|
| A. Produto fisico com preco e CTA | [Atual 4:5](a-produto-preco-cta-current.png) | [Editorial 4:5](a-produto-preco-cta-editorial-refined-4x5.png) | [Comparativo 4:5](a-produto-preco-cta-comparison.png) | [Comparativo 9:16](a-produto-preco-cta-comparison-9x16.png) | Produto fisico simulado com asset local de aliancas/relogio. O compositor preserva o asset original como produto quando fornecido; preco fixture nao e preco comercial real confirmado. |
| B. Publicacao institucional premium | [Atual 4:5](b-institucional-premium-current.png) | [Editorial 4:5](b-institucional-premium-editorial-refined-4x5.png) | [Comparativo 4:5](b-institucional-premium-comparison.png) | [Comparativo 9:16](b-institucional-premium-comparison-9x16.png) | Usa fotografia contextual local sem chamada comercial de preco. |
| C. Divulgacao de servico | [Atual 4:5](c-divulgacao-servico-current.png) | [Editorial 4:5](c-divulgacao-servico-editorial-refined-4x5.png) | [Comparativo 4:5](c-divulgacao-servico-comparison.png) | [Comparativo 9:16](c-divulgacao-servico-comparison-9x16.png) | Usa screenshot local real/controlado do produto Rumo ao Altar com dados demonstrativos QA; nao apresenta UI inventada como captura real. |

## Regras ajustadas nesta rodada

1. Headline nunca cruza mascaras, fotos ou transicoes de contraste: cada texto tem um plano visual consistente.
2. Produto/oferta preserva o asset original como produto principal quando existe, sem duplicacao decorativa circular.
3. Preco e CTA passam a formar um bloco comercial integrado, com preco deterministico e CTA em area propria.
4. Institucional premium ganhou area editorial mais equilibrada, headline contida e fotografia sem competir com o texto.
5. Servico/produto digital usa screenshot local real/controlado do produto com dados QA, nao UI inventada.
6. Foram mantidas tres linguagens distintas: vitrine de produto, editorial institucional e produto digital com device.
7. A saida 9:16 foi gerada separadamente para testar enquadramento vertical, nao apenas recortar a versao 4:5.

## Limitacoes que permanecem

1. Os precos dos fixtures servem apenas para testar composicao; nao devem ser tratados como preco comercial real sem confirmacao.
2. O cenario A ainda usa asset local de casamento como produto fisico simulado; um packshot real de cliente melhoraria fidelidade.
3. O screenshot do cenario C e real/controlado, mas vem de captura desktop; em producao o ideal e priorizar captura mobile real quando o formato for celular.
4. A validacao visual aqui e manual/local. A integracao futura ainda precisa de regras automaticas para contraste, overflow e colisao com mascaras.

Parecer: este prototipo deve ser avaliado visualmente antes de qualquer implementacao no motor ativo.
