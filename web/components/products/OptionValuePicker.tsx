"use client";
import {useState} from "react";
import {Check,Plus,X} from "lucide-react";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {cn} from "@/lib/utils";

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

export function OptionValuePicker({name,values,disabled,onChange}:{name:string;values:string[];disabled?:boolean;onChange:(values:string[])=>void}){
 const [typed,setTyped]=useState("");
 const type=variationType(name),groups=type?.groups??[];
 const presets=groups.flatMap(group=>group.values);
 // Mantém a ordem natural da lista pronta (P antes de M, etc.); valores próprios vêm depois, na ordem em que foram incluídos.
 const ordered=(next:string[])=>[...presets.filter(value=>next.includes(value)),...next.filter(value=>!presets.includes(value))];
 const toggle=(value:string)=>onChange(ordered(values.includes(value)?values.filter(item=>item!==value):[...values,value]));
 const add=()=>{const value=typed.trim();if(!value)return;const existing=[...presets,...values].find(item=>normalize(item)===normalize(value));if(existing&&!values.includes(existing))toggle(existing);else if(!existing)onChange(ordered([...values,value]));setTyped("");};
 const custom=values.filter(value=>!presets.includes(value));
 const swatch=(value:string)=>type?.id==="color"?COLORS.find(color=>color.value===value)?.hex:undefined;
 const chip=(value:string)=>{const on=values.includes(value),hex=swatch(value);return <button key={value} type="button" disabled={disabled} aria-pressed={on} onClick={()=>toggle(value)} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",on?"border-primary bg-primary/15 text-foreground":"border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground")}>{on?<Check size={12}/>:null}{hex?<span aria-hidden className="h-3.5 w-3.5 rounded-full border border-border" style={{background:hex}}/>:null}{value}</button>;};
 return <div className="space-y-3">
  {groups.map((group,index)=><div key={group.label??index}>{group.label?<p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>:null}<div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">{group.values.map(value=>chip(value))}</div></div>)}
  {custom.length?<div><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{groups.length?"Seus valores":"Valores"}</p><div className="flex flex-wrap gap-1.5">{custom.map(value=><span key={value} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 py-1 text-xs font-medium">{value}<button type="button" disabled={disabled} aria-label={`Remover ${value}`} onClick={()=>toggle(value)} className="rounded-full p-0.5 hover:bg-background/60"><X size={12}/></button></span>)}</div></div>:null}
  <div className="flex gap-2"><Input aria-label={`Adicionar outro valor de ${name||"variação"}`} value={typed} disabled={disabled} placeholder={type?.placeholder??"Digite um valor e adicione"} onChange={event=>setTyped(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();add();}}}/><Button type="button" variant="secondary" disabled={disabled||!typed.trim()} onClick={add}><Plus size={14}/>Adicionar</Button></div>
  <p className="text-xs text-muted-foreground">{values.length?`${values.length} selecionado${values.length>1?"s":""}: ${values.join(", ")}`:"Nenhum valor selecionado. Marque os que você tem."}</p>
 </div>;
}

/** Escolha do tipo de variação ao adicionar uma opção ao produto. */
export function VariationTypePicker({productType,usedNames,onPick,onCancel}:{productType:string;usedNames:string[];onPick:(type?:VariationType)=>void;onCancel:()=>void}){
 const used=new Set(usedNames.map(name=>variationType(name)?.id).filter(Boolean));
 const suggested=SUGGESTED_TYPES[productType]??[];
 const sorted=[...VARIATION_TYPES.filter(type=>suggested.includes(type.id)).sort((a,b)=>suggested.indexOf(a.id)-suggested.indexOf(b.id)),...VARIATION_TYPES.filter(type=>!suggested.includes(type.id))];
 const card=(type:VariationType|undefined)=>{const taken=!!type&&used.has(type.id);return <button key={type?.id??"custom"} type="button" disabled={taken} onClick={()=>onPick(type)} className="rounded-lg border border-border/70 p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"><span className="flex items-center justify-between gap-2 text-sm font-medium">{type?.name??"Personalizada"}{type&&suggested.includes(type.id)?<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Sugerida</span>:null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{taken?"Já adicionada":type?.hint??"Crie seu próprio tipo e valores"}</span></button>;};
 return <div className="space-y-3 rounded-xl border border-dashed border-border p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">Qual tipo de variação?</p><Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sorted.map(card)}{card(undefined)}</div></div>;
}
