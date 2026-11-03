import type {ProductDetails} from "./types";

/**
 * O que está sendo cadastrado decide os campos e as etapas do cadastro — tudo por configuração.
 * Novo segmento = nova entrada aqui: `family` é o tipo guardado no produto (comportamento de
 * ficha/estoque), `fields` vira `details.specs` (com o rótulo, para o site exibir) e
 * `variationTypes` são as sugestões da etapa Variações (ids de `VARIATION_TYPES`).
 */
export type SpecField={key:string;label:string;kind?:"text"|"number"|"select"|"textarea";choices?:string[];unit?:string;placeholder?:string};
export type ProductSegment={
 id:string;label:string;description:string;icon:string;family:ProductDetails["type"];itemType:"product"|"service";
 fields:SpecField[];variationTypes:string[];
 /** Pode ter combinações (tamanho, cor...). Veículos e imóveis são cadastro por unidade. */
 variations:boolean;
 /** Controle de estoque faz sentido? Serviços e produtos digitais não têm estoque físico. */
 stock:boolean;
 /** Peso e medidas para frete. */
 shipping:boolean;
 namePlaceholder:string;
};

const GENDER=["Feminino","Masculino","Unissex","Infantil","Bebê"];
export const PRODUCT_SEGMENTS:ProductSegment[]=[
 {id:"apparel",label:"Vestuário",description:"Roupas, moda e uniformes",icon:"👕",family:"APPAREL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Camiseta Oversized",variationTypes:["size","color","material"],
  fields:[{key:"gender",label:"Gênero",kind:"select",choices:GENDER},{key:"material",label:"Material",placeholder:"Ex.: Algodão"},{key:"composition",label:"Composição",placeholder:"Ex.: 100% algodão"},{key:"fit",label:"Modelagem",kind:"select",choices:["Tradicional","Slim","Oversized","Reta","Ampla","Cropped"]},{key:"collection",label:"Coleção",placeholder:"Ex.: Verão 2027"}]},
 {id:"shoes",label:"Calçados",description:"Tênis, sapatos, sandálias",icon:"👟",family:"APPAREL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Tênis Corrida Leve",variationTypes:["shoe_size","color"],
  fields:[{key:"gender",label:"Gênero",kind:"select",choices:GENDER},{key:"material",label:"Material",placeholder:"Ex.: Couro"},{key:"sole",label:"Solado",placeholder:"Ex.: Borracha"},{key:"collection",label:"Coleção"}]},
 {id:"accessories",label:"Acessórios",description:"Bolsas, bonés, joias, relógios",icon:"👜",family:"GENERAL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Boné Aba Curva",variationTypes:["color","material","dimension"],
  fields:[{key:"material",label:"Material"},{key:"dimensions",label:"Medidas",placeholder:"Ex.: 30 x 20 x 10 cm"},{key:"warranty",label:"Garantia",placeholder:"Ex.: 3 meses"}]},
 {id:"electronics",label:"Eletrônicos",description:"Celulares, eletroportáteis, informática",icon:"📱",family:"GENERAL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Fone Bluetooth X200",variationTypes:["color","voltage","storage","ram"],
  fields:[{key:"model",label:"Modelo"},{key:"voltage",label:"Voltagem",kind:"select",choices:["110V","220V","Bivolt","Bateria","USB"]},{key:"warranty",label:"Garantia",placeholder:"Ex.: 12 meses"},{key:"specs_summary",label:"Especificações técnicas",kind:"textarea",placeholder:"Processador, tela, bateria..."}]},
 {id:"food",label:"Alimentos e bebidas",description:"Comidas, bebidas, suplementos",icon:"🍫",family:"GENERAL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Granola Artesanal",variationTypes:["flavor","weight","volume"],
  fields:[{key:"net_content",label:"Conteúdo líquido",placeholder:"Ex.: 500 g"},{key:"ingredients",label:"Ingredientes",kind:"textarea"},{key:"allergens",label:"Alérgenos",placeholder:"Ex.: Contém glúten"},{key:"shelf_life",label:"Validade",placeholder:"Ex.: 6 meses fechado"}]},
 {id:"furniture",label:"Móveis e decoração",description:"Móveis, colchões, decoração",icon:"🛋️",family:"GENERAL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Poltrona Aurora",variationTypes:["color","material","dimension","bed_size"],
  fields:[{key:"material",label:"Material"},{key:"dimensions",label:"Medidas",placeholder:"Ex.: 80 x 75 x 90 cm"},{key:"assembly",label:"Montagem",kind:"select",choices:["Já montado","Requer montagem","Montagem inclusa"]},{key:"warranty",label:"Garantia"}]},
 {id:"vehicle",label:"Veículos",description:"Carros, motos, utilitários",icon:"🚗",family:"VEHICLE",itemType:"product",variations:false,stock:false,shipping:false,namePlaceholder:"Ex.: Honda Civic EXL 2022",variationTypes:[],fields:[]},
 {id:"real_estate",label:"Imóveis",description:"Casas, apartamentos, terrenos",icon:"🏠",family:"REAL_ESTATE",itemType:"product",variations:false,stock:false,shipping:false,namePlaceholder:"Ex.: Casa com 3 quartos no Centro",variationTypes:[],fields:[]},
 {id:"service",label:"Serviços",description:"Consultoria, manutenção, aulas",icon:"🛠️",family:"GENERAL",itemType:"service",variations:false,stock:false,shipping:false,namePlaceholder:"Ex.: Instalação de ar-condicionado",variationTypes:["model"],
  fields:[{key:"duration",label:"Duração",placeholder:"Ex.: 2 horas"},{key:"location",label:"Onde é realizado",kind:"select",choices:["No cliente","Na empresa","Online"]},{key:"includes",label:"O que está incluso",kind:"textarea"}]},
 {id:"digital",label:"Produtos digitais",description:"Cursos, e-books, licenças",icon:"💾",family:"GENERAL",itemType:"product",variations:true,stock:false,shipping:false,namePlaceholder:"Ex.: Curso de Fotografia",variationTypes:["model"],
  fields:[{key:"format",label:"Formato",placeholder:"Ex.: PDF, vídeo, licença"},{key:"access",label:"Acesso",placeholder:"Ex.: Vitalício"}]},
 {id:"general",label:"Outros produtos",description:"Qualquer outro tipo de produto",icon:"📦",family:"GENERAL",itemType:"product",variations:true,stock:true,shipping:true,namePlaceholder:"Ex.: Leitor de código de barras",variationTypes:["color","dimension","model","voltage"],
  fields:[{key:"model",label:"Modelo"},{key:"material",label:"Material"},{key:"warranty",label:"Garantia"}]},
];

/** Segmento de um produto já cadastrado (inclusive anteriores a esta tela, que não guardam `segment`). */
export function segmentOf(details:Pick<ProductDetails,"type"|"segment">,itemType?:"product"|"service"):ProductSegment{
 const byId=PRODUCT_SEGMENTS.find(segment=>segment.id===details.segment);
 if(byId)return byId;
 if(details.type==="VEHICLE")return PRODUCT_SEGMENTS.find(segment=>segment.id==="vehicle")!;
 if(details.type==="REAL_ESTATE")return PRODUCT_SEGMENTS.find(segment=>segment.id==="real_estate")!;
 if(details.type==="APPAREL")return PRODUCT_SEGMENTS.find(segment=>segment.id==="apparel")!;
 return PRODUCT_SEGMENTS.find(segment=>segment.id===(itemType==="service"?"service":"general"))!;
}
