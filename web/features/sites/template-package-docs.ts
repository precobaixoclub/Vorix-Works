/**
 * Conteúdo da documentação pública do Pacote de Modelo Vorix (/modelos/importar). Espelha
 * `src/domain/sites/site-template-package.ts`; `tests/site-template-package.test.mjs` garante que
 * cada código de validação do backend está explicado aqui.
 */

export const PACKAGE_LIMITS = [
  ["Tamanho do .zip", "até 20 MB (60 MB descompactado)"],
  ["Arquivos no pacote", "até 200"],
  ["Cada imagem", "até 5 MB · JPG, PNG ou WEBP (convertidas para WEBP, até 2400 px)"],
  ["styles.css", "até 200 KB"],
  ["Cada seção (HTML)", "até 100 KB"],
  ["Seções", "até 40 na página inicial e 30 por página"],
  ["Páginas extras", "até 10"],
  ["Itens de uma lista", "até 30"],
  ["Links do menu", "até 8"],
] as const;

export type SectionDoc = { type: string; label: string; fields: string[]; required: string[]; items?: { fields: string[]; required: string[] } };
export const TEMPLATED_SECTION_DOCS: SectionDoc[] = [
  { type: "hero", label: "Banner principal", fields: ["eyebrow", "title", "text", "button", "image"], required: ["title"] },
  { type: "text", label: "Texto", fields: ["eyebrow", "title", "text"], required: ["text"] },
  { type: "image", label: "Imagem", fields: ["title", "text", "image"], required: ["image"] },
  { type: "image_text", label: "Imagem e texto", fields: ["eyebrow", "title", "text", "button", "image"], required: ["title", "image"] },
  { type: "cta", label: "Chamada para ação", fields: ["eyebrow", "title", "text", "button"], required: ["title", "button"] },
  { type: "features", label: "Diferenciais", fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["title", "text", "image"], required: ["title"] } },
  { type: "stats", label: "Números", fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["value", "title"], required: ["value", "title"] } },
  { type: "testimonials", label: "Depoimentos", fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["text", "title", "value", "image"], required: ["text", "title"] } },
  { type: "logos", label: "Logos de clientes/marcas", fields: ["title", "text"], required: [], items: { fields: ["image", "title"], required: ["image"] } },
  { type: "faq", label: "Perguntas frequentes", fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["title", "text"], required: ["title", "text"] } },
  { type: "divider", label: "Divisor", fields: [], required: [] },
];

export const NATIVE_SECTION_DOCS = [
  { type: "catalog", label: "Catálogo de produtos", manifest: "title, text, source, category, limit", classes: ".ts-section, .ts-section-heading, .ts-product-grid, .ts-product-card, .ts-price, .ts-button, .sp-price, .sp-price-was, .sp-price-now, .sp-sale-badge, .sp-sale-flag, [data-curated]" },
  { type: "categories", label: "Categorias", manifest: "title, text", classes: ".ts-category-grid, .ts-category" },
  { type: "contact", label: "Contato e formulário", manifest: "title, text", classes: ".ts-contact, .ts-contact-copy, .ts-contact-details, .ts-field, .ts-button" },
  { type: "video", label: "Vídeo (YouTube ou Vimeo)", manifest: "title, text, videoUrl", classes: ".ts-video" },
  { type: "gallery", label: "Galeria de fotos", manifest: "title, text, images: [{ file, alt }]", classes: ".ts-section, .ts-container" },
] as const;

/** Que produtos uma seção "catalog" mostra (campo "source" do manifest). */
export const CATALOG_SOURCE_DOCS = [
  { source: "all", label: "Todos os produtos", detail: "Padrão. O catálogo completo, com busca, filtros e abas de categoria." },
  { source: "featured", label: "Destaques", detail: "Os produtos marcados com a estrela em Produtos. A seção some do site enquanto não houver nenhum." },
  { source: "sale", label: "Em promoção", detail: "Os produtos com desconto ativo (promoção do produto ou regra comercial). Some quando não houver promoção." },
  { source: "category", label: "Uma categoria", detail: "Os produtos da categoria informada em \"category\" (o endereço dela, ex.: \"camisetas\") e das subcategorias. Some se a categoria não tiver produtos no site." },
] as const;
export const CATALOG_SOURCE_EXAMPLE = `"home": [
  { "type": "hero", "file": "sections/hero.html" },
  { "type": "catalog", "title": "Destaques", "source": "featured", "limit": 8 },
  { "type": "catalog", "title": "Em promoção", "source": "sale", "limit": 8 },
  { "type": "categories", "title": "Compre por categoria" },
  { "type": "catalog", "title": "Camisetas", "source": "category", "category": "camisetas" },
  { "type": "catalog", "title": "Todos os produtos" }
]`;

export const FIELD_DOCS = [
  ["title", "Título", "h1–h6, p, span, strong, em, div, li, dt, dd, figcaption, small, cite, blockquote"],
  ["text", "Texto", "p, span, div, li, dt, dd, small, blockquote, figcaption, h2–h6, cite"],
  ["eyebrow", "Texto pequeno acima do título", "span, p, small, div, strong"],
  ["button", "Botão (texto + link)", "a"],
  ["image", "Imagem (arquivo + texto alternativo)", "img"],
  ["value", "Valor de destaque (só em itens: números, cargo)", "as mesmas do título"],
] as const;

export const CSS_VARIABLES = ["--site-primary", "--site-secondary", "--site-on-primary", "--site-bg", "--site-fg", "--site-surface", "--site-soft", "--site-line", "--site-header", "--site-footer-bg", "--site-footer-fg", "--site-body-font", "--site-heading-font", "--site-heading-weight", "--site-radius", "--site-button-radius", "--site-width", "--site-space"];

export const ALLOWED_TAGS_TEXT = "section, div, span, p, h1–h6, a, img, ul, ol, li, strong, em, b, i, u, small, br, hr, figure, figcaption, blockquote, cite, header, footer, article, aside, nav, dl, dt, dd";
export const ALLOWED_ATTRIBUTES_TEXT = "class, alt, title, role, href (só em <a>), src (só em <img>), width, height, loading, aria-* e os data-vorix-*";

type IssueDoc = { severity: "erro" | "aviso"; title: string; fix: string };
export const ISSUE_DOCS: Record<string, IssueDoc> = {
  "PACKAGE_INVALID_ZIP": { severity: "erro", title: "O arquivo não é um .zip válido", fix: "Compacte a pasta do modelo em ZIP, sem senha." },
  "PACKAGE_TOO_LARGE": { severity: "erro", title: "Pacote grande demais", fix: "Reduza as imagens e remova arquivos não usados (limite de 20 MB compactado e 60 MB descompactado)." },
  "PACKAGE_TOO_MANY_FILES": { severity: "erro", title: "Arquivos demais", fix: "Envie no máximo 200 arquivos, só os usados pelo modelo." },
  "PACKAGE_UNSAFE_PATH": { severity: "erro", title: "Caminho de arquivo inseguro", fix: "Use caminhos relativos dentro do pacote, sem “..” nem caminhos absolutos." },
  "MANIFEST_MISSING": { severity: "erro", title: "Falta o manifest.json", fix: "Coloque o manifest.json na raiz do pacote (ou na única pasta do .zip)." },
  "MANIFEST_INVALID_JSON": { severity: "erro", title: "manifest.json com JSON inválido", fix: "Confira vírgulas, aspas duplas e chaves." },
  "MANIFEST_INVALID": { severity: "erro", title: "Campo do manifest.json inválido", fix: "A mensagem diz qual campo. Compare com o manifest do pacote de exemplo." },
  "MANIFEST_FORMAT_UNSUPPORTED": { severity: "erro", title: "Formato ou versão não suportados", fix: "Use \"format\": \"vorix-site-template\" e \"formatVersion\": 1." },
  "THEME_INVALID_JSON": { severity: "erro", title: "theme.json com JSON inválido", fix: "Confira a sintaxe do arquivo." },
  "THEME_INVALID": { severity: "erro", title: "Campo do tema inválido ou não suportado", fix: "Use só os campos da tabela de tema, com cores em #RRGGBB." },
  "HOME_EMPTY": { severity: "erro", title: "Página inicial sem seções", fix: "Liste ao menos uma seção em \"home\"." },
  "TOO_MANY_SECTIONS": { severity: "erro", title: "Seções demais", fix: "Até 40 seções na página inicial e 30 por página." },
  "PAGE_INVALID": { severity: "erro", title: "Página inválida", fix: "Até 10 páginas, cada uma com slug único (letras minúsculas, números e hífen)." },
  "SECTION_TYPE_UNKNOWN": { severity: "erro", title: "Tipo de seção desconhecido", fix: "Use um dos tipos listados nesta documentação." },
  "SECTION_FILE_MISSING": { severity: "erro", title: "Arquivo indicado não existe", fix: "Confira nome e pasta; maiúsculas e minúsculas fazem diferença." },
  "SECTION_FILE_REQUIRED": { severity: "erro", title: "Seção sem arquivo HTML", fix: "Seções com desenho próprio precisam de \"file\": \"sections/arquivo.html\"." },
  "SECTION_NATIVE_WITH_FILE": { severity: "erro", title: "Seção do Vorix com HTML próprio", fix: "Catálogo, categorias, contato, vídeo e galeria são montados pelo Vorix: remova \"file\" e estilize pelo CSS." },
  "SECTION_ROOT_INVALID": { severity: "erro", title: "Estrutura da seção inválida", fix: "Cada arquivo deve ter uma única <section data-vorix-block=\"tipo\"> envolvendo tudo, sem <html>, <head> ou <body>." },
  "SECTION_TYPE_MISMATCH": { severity: "erro", title: "Tipo da seção diferente do manifest", fix: "data-vorix-block precisa ser igual ao \"type\" do manifest." },
  "SECTION_TOO_LARGE": { severity: "erro", title: "HTML da seção grande demais", fix: "Até 100 KB por seção: simplifique ou divida em mais seções." },
  "HTML_FORBIDDEN_TAG": { severity: "erro", title: "Tag não permitida", fix: "Sem <script>, <style>, <iframe>, <form>, <svg>, <video> etc. Veja a lista de tags aceitas." },
  "HTML_FORBIDDEN_ATTRIBUTE": { severity: "erro", title: "Atributo não permitido", fix: "Use só os atributos da lista; href apenas em <a> e src apenas em <img>." },
  "HTML_EVENT_HANDLER": { severity: "erro", title: "Código JavaScript em atributo (onclick, onload…)", fix: "Remova o atributo. Interações vêm dos recursos do Vorix." },
  "HTML_INLINE_STYLE": { severity: "erro", title: "Estilo direto no elemento (style=\"…\")", fix: "Crie uma classe no styles.css." },
  "HTML_UNSAFE_LINK": { severity: "erro", title: "Link não permitido", fix: "Use https://, mailto:, tel:, âncora (#contato) ou caminho do site (/sobre)." },
  "HTML_ATTRIBUTE_REMOVED": { severity: "aviso", title: "Atributo removido (id ou data-*)", fix: "Use classes para estilizar; atributos de bibliotecas JavaScript não têm efeito." },
  "FIELD_UNKNOWN": { severity: "erro", title: "Campo editável que não existe nessa seção", fix: "Use os campos da tabela da seção." },
  "FIELD_REQUIRED": { severity: "erro", title: "Falta um campo obrigatório", fix: "Marque o elemento com data-vorix-field conforme a tabela da seção ou dos itens." },
  "FIELD_DUPLICATED": { severity: "erro", title: "Campo repetido", fix: "Cada campo aparece uma vez por seção (ou por item)." },
  "FIELD_WRONG_ELEMENT": { severity: "erro", title: "Campo na tag errada", fix: "Botões em <a>, imagens em <img>, textos nas tags de texto da tabela de campos." },
  "FIELD_NOT_TEXT": { severity: "erro", title: "Campo de texto com tags dentro", fix: "O elemento marcado deve ter só texto. Mova ícones para fora ou para o CSS (::before)." },
  "REPEAT_INVALID": { severity: "erro", title: "Lista de itens inválida", fix: "Use data-vorix-repeat=\"items\" uma vez, só nas seções com itens, com 1 a 30 itens dentro." },
  "REPEAT_REQUIRED": { severity: "erro", title: "Falta a lista de itens", fix: "Envolva os itens em um elemento com data-vorix-repeat=\"items\"." },
  "ASSET_MISSING": { severity: "erro", title: "Imagem não encontrada", fix: "Coloque o arquivo em assets/ e confira o caminho." },
  "ASSET_EXTERNAL": { severity: "erro", title: "Imagem de fora do pacote", fix: "Baixe a imagem para assets/ e use o caminho relativo." },
  "ASSET_FORMAT": { severity: "erro", title: "Formato de imagem não aceito", fix: "Use JPG, PNG ou WEBP. SVG e GIF não são aceitos." },
  "ASSET_TOO_LARGE": { severity: "erro", title: "Imagem grande demais", fix: "Até 5 MB por imagem; 2400 px no lado maior é suficiente." },
  "ASSET_INVALID_IMAGE": { severity: "erro", title: "Imagem corrompida", fix: "Exporte a imagem de novo em JPG, PNG ou WEBP." },
  "ASSET_UNUSED": { severity: "aviso", title: "Imagem não usada", fix: "Remova do pacote para deixá-lo menor." },
  "CSS_PARSE_ERROR": { severity: "erro", title: "Erro de sintaxe no CSS", fix: "Confira chaves e ponto e vírgula perto da linha indicada." },
  "CSS_TOO_LARGE": { severity: "erro", title: "CSS grande demais", fix: "Até 200 KB. Não inclua frameworks inteiros." },
  "CSS_FORBIDDEN_AT_RULE": { severity: "erro", title: "Regra @ não permitida (@import, @font-face…)", fix: "Use só @media, @supports, @container e @keyframes. Fontes vêm do theme.json." },
  "CSS_EXTERNAL_URL": { severity: "erro", title: "url() externo no CSS", fix: "Use url(assets/arquivo.jpg) com a imagem dentro do pacote." },
  "CSS_UNSAFE": { severity: "erro", title: "CSS com código executável ou “<”", fix: "Remova expression(), javascript:, behavior, -moz-binding e qualquer HTML." },
  "CSS_FIXED_POSITION": { severity: "aviso", title: "position: fixed", fix: "Pode cobrir o cabeçalho e o carrinho; prefira sticky ou absolute." },
  "CSS_NO_RESPONSIVE": { severity: "aviso", title: "Sem ajustes para celular", fix: "Inclua @media (max-width: 700px) e teste em 390 px de largura." },
  "FILE_IGNORED": { severity: "aviso", title: "Arquivo fora do formato", fix: "Será ignorado; pode remover." },
  "IMAGE_ALT_MISSING": { severity: "aviso", title: "Imagem sem texto alternativo", fix: "Descreva a imagem em alt=\"…\"." },
  "PREVIEW_MISSING": { severity: "aviso", title: "Sem imagem de pré-visualização", fix: "Inclua preview.png (1200 × 800)." },
};

export const MANIFEST_EXAMPLE = `{
  "format": "vorix-site-template",
  "formatVersion": 1,
  "name": "Atelier",
  "version": "1.0.0",
  "author": "Sua agência",
  "description": "Loja de cerâmica artesanal",
  "preview": "preview.png",
  "theme": "theme.json",
  "styles": "styles.css",
  "navigation": [
    { "label": "Produtos", "url": "#catalogo" },
    { "label": "Sobre", "url": "/sobre" }
  ],
  "home": [
    { "type": "hero", "file": "sections/hero.html" },
    { "type": "features", "file": "sections/features.html" },
    { "type": "catalog", "title": "Peças da semana" },
    { "type": "contact", "title": "Vamos conversar?" }
  ],
  "pages": [
    { "slug": "sobre", "title": "Sobre", "sections": [
      { "type": "text", "file": "sections/text.html" }
    ] }
  ]
}`;

export const THEME_EXAMPLE = `{
  "primary": "#8a4b2a",
  "secondary": "#d9a066",
  "background": "#fbf7f2",
  "foreground": "#2b211b",
  "surface": "#f3ebe1",
  "footerBackground": "#2b211b",
  "bodyFont": "modern",
  "headingFont": "editorial",
  "buttonStyle": "pill",
  "rounded": true
}`;

export const HERO_EXAMPLE = `<section data-vorix-block="hero" class="at-hero">
  <span class="at-eyebrow" data-vorix-field="eyebrow">Coleção outono</span>
  <h1 data-vorix-field="title">Peças feitas à mão</h1>
  <p data-vorix-field="text">Cerâmica e linho de produtores locais.</p>
  <a class="at-button" href="#catalogo" data-vorix-field="button">Ver coleção</a>
  <img data-vorix-field="image" src="assets/hero.jpg" alt="Mesa posta com louças">
</section>`;

export const FEATURES_EXAMPLE = `<section data-vorix-block="features" class="at-features">
  <h2 data-vorix-field="title">Por que comprar com a gente</h2>
  <ul data-vorix-repeat="items">
    <li class="at-card">
      <h3 data-vorix-field="title">Feito à mão</h3>
      <p data-vorix-field="text">Cada peça é única.</p>
    </li>
    <li class="at-card">
      <h3 data-vorix-field="title">Envio cuidadoso</h3>
      <p data-vorix-field="text">Embalagem reforçada.</p>
    </li>
  </ul>
</section>`;

export const STRUCTURE_EXAMPLE = `meu-modelo.zip
├── manifest.json      (obrigatório)
├── theme.json         (cores e fontes)
├── styles.css         (aparência)
├── preview.png        (miniatura 1200 × 800)
├── sections/
│   ├── hero.html
│   └── features.html
└── assets/
    └── hero.jpg`;

export const AI_PROMPT = `Converta o site/template HTML anexo para o formato "Pacote de Modelo Vorix" seguindo a documentação em https://vorixworks.com/modelos/importar:
1. Crie manifest.json (format "vorix-site-template", formatVersion 1) listando as seções da página inicial na ordem.
2. Para cada seção, crie sections/<nome>.html com UMA <section data-vorix-block="<tipo>"> (tipos: hero, text, image, image_text, cta, features, stats, testimonials, logos, faq, divider).
3. Marque textos, botões e imagens editáveis com data-vorix-field (title, text, eyebrow, button, image) e listas com data-vorix-repeat="items".
4. Catálogo de produtos, categorias, contato, vídeo e galeria NÃO têm HTML: entram no manifest só com "type" e "title". Para vitrines, use seções "catalog" com "source": "featured" (destaques), "sale" (promoção) ou "category" + "category": "<endereço>", e uma final sem "source" com todos os produtos.
5. Remova todo JavaScript, iframes, formulários, SVG inline, atributos style e on*.
6. Junte o CSS em styles.css, sem @import nem @font-face, e com @media para celular. Use as variáveis --site-primary etc. para as cores.
7. Coloque as imagens em assets/ (JPG, PNG ou WEBP, até 5 MB) e referencie com caminho relativo.
8. Crie theme.json com as cores em #RRGGBB e as fontes (modern, classic, rounded ou editorial).`;
