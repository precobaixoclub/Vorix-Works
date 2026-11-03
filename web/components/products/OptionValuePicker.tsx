"use client";

/**
 * Catálogo de tipos de variação: o lojista escolhe o tipo (tamanho, cor, voltagem, marca do veículo...)
 * e marca os valores que tem, em vez de digitar separado por vírgula. O tipo é reconhecido pelo nome
 * da opção, porque o produto guarda só {key,name,values}.
 */
type ValueGroup={label?:string;values:string[]};
export type VariationType={id:string;name:string;hint:string;aliases?:string[];groups:ValueGroup[];placeholder:string};
const range=(from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>String(from+i));
export const COLORS:{value:string;hex:string}[]=[
 {value:"Preto",hex:"#111111"},{value:"Branco",hex:"#ffffff"},{value:"Off-white",hex:"#f4f1e8"},{value:"Cinza",hex:"#9ca3af"},{value:"Grafite",hex:"#4b5563"},{value:"Bege",hex:"#d9c4a3"},{value:"Nude",hex:"#e3bc9a"},{value:"Marrom",hex:"#7b4a2a"},
 {value:"Azul",hex:"#2563eb"},{value:"Azul-claro",hex:"#93c5fd"},{value:"Azul-marinho",hex:"#1e3a5f"},{value:"Verde",hex:"#16a34a"},{value:"Verde-claro",hex:"#86efac"},{value:"Verde-militar",hex:"#4d5d3a"},{value:"Amarelo",hex:"#facc15"},{value:"Laranja",hex:"#f97316"},
 {value:"Vermelho",hex:"#dc2626"},{value:"Vinho",hex:"#7f1d1d"},{value:"Rosa",hex:"#f9a8d4"},{value:"Pink",hex:"#ec4899"},{value:"Lilás",hex:"#c4b5fd"},{value:"Roxo",hex:"#7c3aed"},
 {value:"Dourado",hex:"#d4af37"},{value:"Prateado",hex:"#c0c0c0"},{value:"Transparente",hex:"repeating-conic-gradient(#e5e7eb 0 25%,#ffffff 0 50%) 0 0/6px 6px"},{value:"Estampado",hex:"conic-gradient(#f472b6,#facc15,#4ade80,#60a5fa,#f472b6)"},{value:"Colorido",hex:"linear-gradient(90deg,#ef4444,#facc15,#22c55e,#3b82f6)"},
];
export const VARIATION_TYPES:VariationType[]=[
 {id:"size",name:"Tamanho",hint:"Roupas: P, M, G, infantil, bebê",aliases:["tamanhos","tam"],placeholder:"Outro tamanho (ex.: 5)",groups:[{label:"Bebê",values:["RN","0-3M","3-6M","6-9M","9-12M","12-18M","18-24M"]},{label:"Infantil",values:["1","2","3","4","6","8","10","12","14","16"]},{label:"Adulto",values:["PP","P","M","G","GG","XG","XGG","EG","EGG"]},{label:"Plus size",values:["G1","G2","G3","G4","G5"]},{label:"Outros",values:["Único"]}]},
 {id:"shoe_size",name:"Numeração",hint:"Calçados: 17 ao 48",aliases:["numero","numeracao do calcado","calcado"],placeholder:"Outra numeração (ex.: 37/38)",groups:[{label:"Infantil",values:range(17,33)},{label:"Adulto",values:range(34,48)}]},
 {id:"color",name:"Cor",hint:"Preto, branco, azul…",aliases:["cores"],placeholder:"Outra cor (ex.: Verde-musgo)",groups:[{values:COLORS.map(color=>color.value)}]},
 {id:"material",name:"Material",hint:"Algodão, couro, inox…",aliases:["tecido"],placeholder:"Outro material",groups:[{label:"Tecidos",values:["Algodão","Poliéster","Viscose","Linho","Malha","Moletom","Jeans","Seda","Lã","Tricô"]},{label:"Outros",values:["Couro","Couro sintético","Madeira","MDF","Metal","Inox","Alumínio","Plástico","Vidro","Cerâmica","Silicone"]}]},
 {id:"voltage",name:"Voltagem",hint:"110V, 220V, bivolt",aliases:["tensao"],placeholder:"Outra voltagem",groups:[{values:["110V","127V","220V","Bivolt","Bateria","USB"]}]},
 {id:"storage",name:"Armazenamento",hint:"Celulares e eletrônicos: 128GB…",aliases:["capacidade de armazenamento","memoria interna"],placeholder:"Outro (ex.: 4TB)",groups:[{values:["16GB","32GB","64GB","128GB","256GB","512GB","1TB","2TB"]}]},
 {id:"ram",name:"Memória RAM",hint:"4GB, 8GB, 16GB…",aliases:["memoria","ram"],placeholder:"Outra (ex.: 24GB)",groups:[{values:["2GB","3GB","4GB","6GB","8GB","12GB","16GB","32GB","64GB"]}]},
 {id:"volume",name:"Volume",hint:"Perfumes, bebidas: 100ml, 1L…",aliases:["capacidade","conteudo"],placeholder:"Outro volume (ex.: 750ml)",groups:[{values:["30ml","50ml","75ml","100ml","200ml","250ml","300ml","500ml","1L","1,5L","2L","5L"]}]},
 {id:"weight",name:"Peso",hint:"Alimentos e suplementos: 500g, 1kg…",aliases:["gramatura"],placeholder:"Outro peso (ex.: 900g)",groups:[{values:["100g","200g","250g","500g","1kg","2kg","3kg","5kg","10kg","15kg"]}]},
 {id:"flavor",name:"Sabor",hint:"Chocolate, morango, natural…",aliases:["sabores"],placeholder:"Outro sabor",groups:[{values:["Natural","Chocolate","Morango","Baunilha","Limão","Coco","Banana","Maracujá","Menta","Frutas vermelhas","Cookies","Doce de leite"]}]},
 {id:"scent",name:"Fragrância",hint:"Velas, cosméticos, limpeza",aliases:["aroma","essencia","perfume"],placeholder:"Outra fragrância",groups:[{values:["Neutro","Lavanda","Floral","Cítrico","Amadeirado","Baunilha","Erva-doce","Alecrim","Talco","Oceano"]}]},
 {id:"bed_size",name:"Tamanho da cama",hint:"Colchões e cama: solteiro, casal…",aliases:["cama","colchao"],placeholder:"Outro tamanho",groups:[{values:["Berço","Solteiro","Solteiro king","Viúvo","Casal","Queen","King","Super king"]}]},
 {id:"vehicle_brand",name:"Marca do veículo",hint:"Peças e acessórios: compatível com…",aliases:["marca do carro","montadora","compatibilidade","veiculo"],placeholder:"Outra marca",groups:[{label:"Carros",values:["Chevrolet","Fiat","Ford","Volkswagen","Toyota","Honda","Hyundai","Renault","Jeep","Nissan","Peugeot","Citroën","Mitsubishi","Kia","BYD","Caoa Chery","BMW","Mercedes-Benz","Audi","Volvo"]},{label:"Motos",values:["Honda Motos","Yamaha","Suzuki","Kawasaki","BMW Motorrad","Triumph","Harley-Davidson","Royal Enfield","Shineray"]}]},
 {id:"vehicle_year",name:"Ano do veículo",hint:"Peças: ano de fabricação",aliases:["ano","ano modelo"],placeholder:"Outro ano",groups:[{values:range(2000,new Date().getFullYear()+1).reverse()}]},
 {id:"rim",name:"Aro",hint:"Bicicletas e rodas",aliases:["aro da roda"],placeholder:"Outro aro",groups:[{label:"Bicicletas",values:["12","16","20","24","26","27,5","29"]},{label:"Rodas e pneus",values:["13\"","14\"","15\"","16\"","17\"","18\"","19\"","20\""]}]},
 {id:"pack",name:"Quantidade",hint:"Kits e embalagens: unidade, kit com 3…",aliases:["kit","embalagem","pacote"],placeholder:"Outra (ex.: Caixa com 24)",groups:[{values:["1 unidade","Kit com 2","Kit com 3","Kit com 4","Kit com 5","Kit com 6","Kit com 10","Caixa com 12"]}]},
 {id:"dimension",name:"Tamanho (P/M/G)",hint:"Pequeno, médio, grande",aliases:["porte","dimensao","medida"],placeholder:"Outra medida (ex.: 40x60cm)",groups:[{values:["Mini","Pequeno","Médio","Grande","Extra grande"]}]},
 {id:"model",name:"Modelo",hint:"Versões do mesmo produto",aliases:["versao"],placeholder:"Digite o nome do modelo",groups:[]},
];
/** Tipos sugeridos primeiro, conforme o que está sendo cadastrado. */
export const SUGGESTED_TYPES:Record<string,string[]>={APPAREL:["size","shoe_size","color","material"],GENERAL:["color","dimension","voltage","model"]};
const normalize=(text:string)=>text.normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
export function variationType(name:string):VariationType|undefined{const n=normalize(name);return n?VARIATION_TYPES.find(type=>normalize(type.name)===n||type.aliases?.includes(n)):undefined;}
