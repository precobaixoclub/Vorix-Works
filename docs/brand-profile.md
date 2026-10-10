# Brand Profile (identidade visual estruturada)

O Brand Profile é a representação **estruturada** da identidade visual de uma marca, por workspace.
Não é um campo de prompt livre: o motor criativo lê papéis, versões de logo, estilos e proibições, e
cada camada recebe só o que lhe cabe.

## Onde vive

- Persistência: `brand_visual_profiles.profile.identity` (jsonb, 1 linha por workspace — migration
  0059). Nenhuma tabela nova e nenhuma migration: perfis antigos não têm `identity` e continuam
  funcionando (SYSTEM_DEFAULT).
- Domínio: `src/shared/utils/brand-identity.ts` (modelo, validação, versão, mapeadores, skin).
- Serviço: `src/application/brand/brand-identity-service.ts`.
- API: `GET/PUT /v1/brand-identity`, `POST /v1/brand-identity/suggest-from-logo`.
- UI: Marca → **Identidade Visual** (`web/features/brand-identity`).

## Modelo

| Grupo | Campos |
|---|---|
| Cores | `hex` + papel `PRIMARY` / `SECONDARY` / `ACCENT` / `NEUTRAL` / `FORBIDDEN` + nome + provenance |
| Logos | `assetId` (Asset Library do workspace) + tipo (principal, horizontal, vertical, símbolo, clara, escura, monocromática) + fundos compatíveis (`LIGHT`/`DARK`/`PHOTO`) + prioridade + provenance |
| Estilo | estilo principal + até 3 traços (`MINIMAL`, `PREMIUM`, `EDITORIAL`, `BOLD`, `TECH`, `ORGANIC`, `LUXURY`, `PLAYFUL`, `CORPORATE`) |
| Densidade | `LOW` / `MEDIUM` / `HIGH` → `visualDensity` do plano (`clean` / `balanced` / `dense`) |
| Intensidade comercial | `LOW` / `MEDIUM` / `HIGH` — destaque de preço/CTA; nunca cria preço, desconto ou urgência |
| Contraste | `SOFT` / `BALANCED` / `HIGH` |
| Tipografia | serifa/sem serifa, época, desenho, voz, peso, caixa dos títulos |
| Forma | cantos (`SHARP`/`SOFT`/`ROUNDED`/`PILL`), linhas, sombras |
| Imagem | fotografia editorial, produto em estúdio, lifestyle, ilustração, 3D, gradiente, fundo minimalista |
| Proibições estruturadas | sem gradientes, emojis, bordas grossas, sombras fortes, fundos escuros, cards arredondados, caixa alta |
| Padrões preferidos | fios finos, muito respiro, camadas de profundidade, brilho suave, foto emoldurada |
| Notas | texto livre complementar (nunca o mecanismo principal) |
| Versão | `version` incrementa a cada gravação; `updatedAt` |

## Provenance

Cada cor e cada logo têm `provenance`; os demais grupos têm `fieldProvenance`:
`USER_CONFIGURED`, `ASSET_EXTRACTED`, `AI_SUGGESTED`, `SYSTEM_DEFAULT`.

- A sugestão de cores a partir da logo é determinística (pixels, sem IA e sem OCR) e volta como
  `ASSET_EXTRACTED` / `SUGGESTION`. **Nunca é gravada sozinha**: entra no rascunho da UI e só vale
  quando a pessoa salva.
- Nada `AI_SUGGESTED` vira fato sem confirmação: ao salvar, a API converte para `USER_CONFIGURED`.

## Precedência final de instruções

1. **Segurança e fatos**: fatos comerciais confirmados, fidelidade de produto/screenshot/logo, texto
   autorizado, isolamento multi-tenant.
2. **Brand Profile estruturado**: cores por papel, logos, proibições e estilo.
3. **Diretrizes criativas / Prompt de Produção**: texto livre permanente do workspace.
4. **Pedido atual**: objetivo e ideia da geração.
5. **Defaults do sistema** (`SYSTEM_DEFAULT`).

### Conflitos

Restrições explícitas do Brand Profile **prevalecem** sobre o pedido atual até a pessoa alterar
conscientemente a identidade. Exemplo: com vermelho proibido, "faça tudo vermelho" não deixa a peça
vermelha. O conflito fica registrado na provenance da peça
(`FORBIDDEN_COLOR_REQUESTED` / `FORBIDDEN_PATTERN_REQUESTED`, `outcome: PROFILE_PREVAILED`).

O "Perfil da Marca" textual (posicionamento, tom de voz) e o campo legado de cores do perfil
continuam como contexto; quando há identidade estruturada, é ela que decide cores, logo e forma no
renderer.

## Aplicação no motor

- **Plano (diretor)**: linhas estruturadas resumidas (papéis, estilo, densidade, intensidade,
  tipografia, proibições). O JSON inteiro nunca vai no prompt.
- **Imagem base (IA)**: só direção visual — estilo, paleta como clima, estilo de imagem, cores e
  padrões proibidos. Nunca vão nome da marca, texto de logo, CTA, preço, headline ou claim.
- **Renderer determinístico**:
  - superfícies pelos neutros/primária;
  - destaque (CTA, preço, fios) pelo `ACCENT`, com contraste mínimo garantido;
  - guarda de cor proibida, incluindo cores derivadas da base ou do screenshot;
  - versão de logo escolhida pelo fundo real; sem versão compatível, usa um tratamento permitido
    (direto/placa suave/fio);
  - raio do CTA, sombras, gradientes, fundo claro e caixa alta conforme a identidade;
  - headline serifada (DM Serif Display, SIL OFL) ou sans (Geist);
  - filete de destaque da marca.
- **Nunca muda**: preço factual, produto, screenshot, claims, texto autorizado do CTA/headline,
  posse de tenant, geometria final, safe areas, prova em pixel dos assets.
- **Variantes legadas do institucional** (colagem/full-bleed/split antigos): skin parcial, só a logo
  padrão; registrado como `BRAND_SKIN_PARTIAL`.

## Auditoria por peça

`artifact_provenance.brandProfile = { source, profileId, workspaceId, version, updatedAt,
appliedBrandRules[], identity }` — snapshot da identidade usada, para reproduzir depois qual perfil
gerou a arte. Ausente = SYSTEM_DEFAULT.

## Multi-tenant

- Toda rota (`/brand-identity`, `/brand-profile`, `/production-settings`) confere que o workspace
  pertence ao tenant do principal: outro tenant/workspace = **404**.
- Logos só podem ser assets **ativos da biblioteca do próprio workspace** (outro workspace, mesmo do
  mesmo tenant = 404). A paleta sugerida é lida do storage por chave, nunca por URL arbitrária.
