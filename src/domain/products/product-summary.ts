import type {ProductDetails} from "./product-details.js";
const kinds:Record<string,string>={house:"Casa",condo_house:"Casa em condomínio",townhouse:"Sobrado",apartment:"Apartamento",studio:"Studio",land:"Terreno",commercial:"Imóvel comercial",warehouse:"Galpão",rural:"Imóvel rural"};
export function productSpecializationSummary(details:ProductDetails|undefined):string|undefined{
 if(details?.type==="VEHICLE"&&details.vehicle){const v=details.vehicle;return [v.make,v.model,v.version,v.modelYear?String(v.modelYear):undefined,v.mileage===undefined?undefined:`${v.mileage.toLocaleString("pt-BR")} km`].filter(Boolean).join(" · ").slice(0,500);}
 if(details?.type==="REAL_ESTATE"&&details.realEstate){const r=details.realEstate,area=r.usableArea??r.builtArea??r.landArea??r.totalArea;return [kinds[r.kind],r.purpose==="rent"?"Aluguel mensal":"Venda",area?`${area.toLocaleString("pt-BR")} m²`:undefined,r.bedrooms===undefined?undefined:`${r.bedrooms} quartos`,r.address.neighborhood,r.address.city,r.address.state].filter(Boolean).join(" · ").slice(0,500);}
 return undefined;
}
