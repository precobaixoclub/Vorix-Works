import type {SiteContent} from "./types";

/**
 * Textos fixos dos modelos (frases de efeito, legendas, rótulos do formulário e do catálogo) que a
 * pessoa pode trocar em "Textos do site" ou clicando no texto na prévia. Vazio = texto padrão.
 * `scope` diz em quais modelos o texto aparece ("all" = todos).
 */
export type SiteTextScope="all"|"fashion"|"nexus"|"aura"|"pulse"|"premium";
export type SiteTextDef={key:string;label:string;group:string;value:string;scope:SiteTextScope;multiline?:boolean};

export const SITE_TEXTS:readonly SiteTextDef[]=[
 // Bambilu (moda infantil)
 {key:"fk.headerNote",label:"Frase do cabeçalho",group:"Cabeçalho",value:"Pequenos momentos.\nGrandes descobertas.",scope:"fashion",multiline:true},
 {key:"fk.searchPlaceholder",label:"Texto do campo de busca",group:"Cabeçalho",value:"O que vamos descobrir hoje?",scope:"fashion"},
 {key:"fk.heroFootnote",label:"Frase abaixo do banner",group:"Banner",value:"O bonito é crescer do seu jeito.",scope:"fashion"},
 {key:"fk.heroCaption",label:"Legenda da foto do banner",group:"Banner",value:"O universo Bambilu",scope:"fashion"},
 {key:"fk.exploreKicker",label:"Título da faixa de categorias",group:"Página inicial",value:"ENCONTRE SEU JEITO",scope:"fashion"},
 {key:"fk.exploreFeatured",label:"Link “nossas escolhas”",group:"Página inicial",value:"Nossas escolhas",scope:"fashion"},
 {key:"fk.exploreAll",label:"Link “toda a coleção”",group:"Página inicial",value:"Toda a coleção",scope:"fashion"},
 {key:"fk.featuredKicker",label:"Texto pequeno dos destaques",group:"Página inicial",value:"ESCOLHAS BAMBILU",scope:"fashion"},
 {key:"fk.featuredTitle",label:"Título dos destaques",group:"Página inicial",value:"Pequenos favoritos.",scope:"fashion"},
 {key:"fk.featuredLink",label:"Link dos destaques",group:"Página inicial",value:"Ver tudo",scope:"fashion"},
 {key:"fk.colorsTitle",label:"Destaque de cores: título",group:"Página inicial",value:"Suas cores, seu jeito",scope:"fashion"},
 {key:"fk.colorsText",label:"Destaque de cores: texto",group:"Página inicial",value:"Veja as opções de cada peça.",scope:"fashion"},
 {key:"fk.sizesTitle",label:"Destaque de tamanhos: título",group:"Página inicial",value:"Uma escolha que combina",scope:"fashion"},
 {key:"fk.sizesText",label:"Destaque de tamanhos: texto",group:"Página inicial",value:"Confira os tamanhos no produto.",scope:"fashion"},
 {key:"fk.contactTitle",label:"Destaque de contato: título",group:"Página inicial",value:"Vamos conversar?",scope:"fashion"},
 {key:"fk.contactText",label:"Destaque de contato: texto",group:"Página inicial",value:"Fale com a gente sobre suas escolhas.",scope:"fashion"},
 // Nexus
 {key:"nexus.signal",label:"Texto pequeno do banner",group:"Banner",value:"NOVAS PERSPECTIVAS",scope:"nexus"},
 {key:"nexus.caption",label:"Legenda do banner",group:"Banner",value:"DESIGN EM CADA DETALHE",scope:"nexus"},
 {key:"nexus.bottom",label:"Convite abaixo do banner",group:"Banner",value:"Explore o que vem a seguir",scope:"nexus"},
 {key:"nexus.index",label:"Marcação abaixo do banner",group:"Banner",value:"01 — COLEÇÃO",scope:"nexus"},
 {key:"nexus.cardLink",label:"Link dos cards de produto",group:"Catálogo",value:"Conhecer",scope:"nexus"},
 // Aura
 {key:"aura.edition",label:"Texto pequeno do banner",group:"Banner",value:"A CURADORIA DO ESSENCIAL",scope:"aura"},
 {key:"aura.imageNote",label:"Legenda da imagem do banner",group:"Banner",value:"Forma, matéria & significado.",scope:"aura"},
 {key:"aura.bottomNote",label:"Frase abaixo do banner",group:"Banner",value:"Uma seleção que faz sentido para você.",scope:"aura"},
 {key:"aura.bottomLink",label:"Link abaixo do banner",group:"Banner",value:"Conheça nossa coleção",scope:"aura"},
 // Pulse
 {key:"pulse.edition",label:"Texto pequeno do banner",group:"Banner",value:"ENCONTRE SEU PRÓXIMO FAVORITO",scope:"pulse"},
 {key:"pulse.stamp",label:"Selo do banner",group:"Banner",value:"ESCOLHAS COM PERSONALIDADE",scope:"pulse"},
 {key:"pulse.badge",label:"Etiqueta da imagem do banner",group:"Banner",value:"Uma nova\ndescoberta.",scope:"pulse",multiline:true},
 {key:"pulse.categories",label:"Título da faixa de categorias",group:"Página inicial",value:"Explore por categoria",scope:"pulse"},
 {key:"pulse.allProducts",label:"Link “todos os produtos”",group:"Página inicial",value:"Todos os produtos",scope:"pulse"},
 // Nexus, Aura e Pulse
 {key:"premium.noImage",label:"Frase do banner sem imagem",group:"Banner",value:"Uma nova perspectiva.",scope:"premium"},
 // Todos os modelos
 {key:"catalog.searchPlaceholder",label:"Texto da busca do catálogo",group:"Catálogo",value:"O que você procura?",scope:"all"},
 {key:"catalog.empty",label:"Mensagem sem produtos",group:"Catálogo",value:"Nenhum produto encontrado com esses filtros.",scope:"all"},
 {key:"catalog.unavailable",label:"Aviso de produto sem estoque",group:"Catálogo",value:"Consulte disponibilidade",scope:"all"},
 {key:"product.relatedKicker",label:"Texto pequeno de produtos relacionados",group:"Página do produto",value:"CONTINUE EXPLORANDO",scope:"all"},
 {key:"product.relatedTitle",label:"Título de produtos relacionados",group:"Página do produto",value:"Você também pode gostar",scope:"all"},
 {key:"form.name",label:"Formulário: campo nome",group:"Formulário de contato",value:"Seu nome",scope:"all"},
 {key:"form.namePlaceholder",label:"Formulário: exemplo do nome",group:"Formulário de contato",value:"Como podemos chamar você?",scope:"all"},
 {key:"form.email",label:"Formulário: campo e-mail",group:"Formulário de contato",value:"E-mail",scope:"all"},
 {key:"form.phone",label:"Formulário: campo telefone",group:"Formulário de contato",value:"Telefone com DDD",scope:"all"},
 {key:"form.hint",label:"Formulário: orientação",group:"Formulário de contato",value:"Informe seu telefone com DDD para receber a resposta. O e-mail é opcional.",scope:"all"},
 {key:"form.message",label:"Formulário: campo mensagem",group:"Formulário de contato",value:"Sua mensagem",scope:"all"},
 {key:"form.messagePlaceholder",label:"Formulário: exemplo da mensagem",group:"Formulário de contato",value:"Conte o que você está procurando.",scope:"all"},
 {key:"form.submit",label:"Formulário: botão enviar",group:"Formulário de contato",value:"Enviar mensagem",scope:"all"},
 {key:"form.success",label:"Formulário: mensagem de enviado",group:"Formulário de contato",value:"Recebemos sua mensagem. Nossa equipe entrará em contato.",scope:"all"},
];

const BY_KEY=new Map(SITE_TEXTS.map(text=>[text.key,text]));
export const SITE_TEXT_MAX_LENGTH=300;

/** Texto do site: o escrito pela pessoa ou o padrão do modelo. */
export function siteText(content:Pick<SiteContent,"texts">,key:string):string{
 const custom=content.texts?.[key]?.trim();
 return custom||BY_KEY.get(key)?.value||"";
}
export function siteTextDef(key:string){return BY_KEY.get(key);}

/** Textos que aparecem no modelo em uso (os de todos os modelos e os do modelo atual). */
export function siteTextsFor(template:string,fashion:boolean):SiteTextDef[]{
 const premium=["nexus","aura","pulse"].includes(template);
 return SITE_TEXTS.filter(text=>text.scope==="all"||(fashion?text.scope==="fashion":(text.scope===template||(premium&&text.scope==="premium"))));
}
