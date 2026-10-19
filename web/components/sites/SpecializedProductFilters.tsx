"use client";
import type {PublicSiteProduct} from "@/features/sites/types";
import {PROPERTY_KIND_LABELS,VEHICLE_KIND_LABELS} from "@/features/product-engine/specializations";
import {EMPTY_PRODUCT_FILTERS,type ProductFilters} from "@/features/product-engine/public-presentation";

export function SpecializedProductFilters({products,value,onChange}:{products:PublicSiteProduct[];value:ProductFilters;onChange:(filters:ProductFilters)=>void}){
 const vehicles=products.filter(p=>p.vehicle).filter(p=>!value.make||p.vehicle?.make===value.make),estates=products.filter(p=>p.realEstate).filter(p=>!value.city||p.realEstate?.address.city===value.city);
 const types=[...new Set(products.map(p=>p.type))];const patch=(key:keyof ProductFilters,next:string)=>onChange({...value,[key]:next,...(key==="make"?{model:""}:{}),...(key==="city"?{neighborhood:""}:{})});
 const select=(key:keyof ProductFilters,label:string,items:readonly (readonly [string,string])[])=><label key={key}>{label}<select className="ts-field" aria-label={label} value={value[key]} onChange={event=>patch(key,event.target.value)}><option value="">Todos</option>{items.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>;
 const num=(key:keyof ProductFilters,label:string)=><label key={key}>{label}<input type="number" min={0} step="any" className="ts-field" aria-label={label} value={value[key]} onChange={event=>patch(key,event.target.value)}/></label>;
 const values=(items:(string|undefined)[])=>[...new Set(items.filter((item):item is string=>!!item))].sort((a,b)=>a.localeCompare(b,"pt-BR")).map(item=>[item,item] as const);
 return <details className="ts-refine"><summary>Refinar busca {Object.values(value).some(Boolean)?"· filtros aplicados":""}</summary><div className="ts-refine-grid">
 {types.length>1?<label>Tipo de produto<select className="ts-field" aria-label="Tipo de produto no site" value={value.type} onChange={event=>onChange({...EMPTY_PRODUCT_FILTERS,type:event.target.value})}><option value="">Todos</option>{types.map(type=><option key={type} value={type}>{({GENERAL:"Geral",APPAREL:"Vestuário",VEHICLE:"Veículos",REAL_ESTATE:"Imóveis"} as Record<string,string>)[type]??type}</option>)}</select></label>:null}
 {num("minPrice","Preço mínimo (R$)")}{num("maxPrice","Preço máximo (R$)")}
 {vehicles.length&&(!value.type||value.type==="VEHICLE")?<>{select("vehicleKind","Categoria do veículo",Object.entries(VEHICLE_KIND_LABELS))}{select("make","Marca do veículo",values(products.map(p=>p.vehicle?.make)))}{select("model","Modelo do veículo",values(vehicles.map(p=>p.vehicle?.model)))}{select("fuel","Combustível",values(vehicles.map(p=>p.vehicle?.fuel)))}{select("transmission","Transmissão",values(vehicles.map(p=>p.vehicle?.transmission)))}{num("minYear","Ano mínimo")}{num("maxYear","Ano máximo")}{num("maxMileage","Quilometragem máxima (km)")}</>:null}
 {estates.length&&(!value.type||value.type==="REAL_ESTATE")?<>{select("propertyKind","Tipo de imóvel",Object.entries(PROPERTY_KIND_LABELS))}{select("purpose","Finalidade",[["sale","Venda"],["rent","Aluguel mensal"]])}{select("city","Cidade do imóvel",values(products.map(p=>p.realEstate?.address.city)))}{select("neighborhood","Bairro",values(estates.map(p=>p.realEstate?.address.neighborhood)))}{num("minBedrooms","Mínimo de quartos")}{num("minParking","Mínimo de vagas")}{num("minArea","Área mínima (m²)")}{num("maxArea","Área máxima (m²)")}</>:null}
 </div><button type="button" className="ts-button ts-button-secondary" onClick={()=>onChange({...EMPTY_PRODUCT_FILTERS})}>Limpar filtros</button></details>;
}
