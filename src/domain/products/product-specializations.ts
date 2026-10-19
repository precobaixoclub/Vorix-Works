import {z} from "zod";

const short=z.string().trim().max(160);
const count=z.number().int().nonnegative().max(1000);
const area=z.number().positive().max(1e12);
const cents=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const BRAZIL_STATES=["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;
export const VEHICLE_KINDS=["car","motorcycle","pickup","van","truck","bus","other"] as const;
export const REAL_ESTATE_KINDS=["house","condo_house","townhouse","apartment","studio","land","commercial","warehouse","rural"] as const;

export const vehicleDetailsSchema=z.object({
 make:short.min(1,"Informe a marca do veículo."),model:short.min(1,"Informe o modelo do veículo."),version:short.optional(),
 kind:z.enum(VEHICLE_KINDS).optional(),bodyType:short.optional(),
 manufactureYear:z.number().int().min(1886).max(2200).optional(),modelYear:z.number().int().min(1886).max(2200).optional(),
 mileage:z.number().nonnegative().max(1e9).optional(),fuel:short.optional(),transmission:short.optional(),color:short.optional(),
 doors:z.number().int().min(1).max(10).optional(),seats:z.number().int().min(1).max(100).optional(),
 condition:z.enum(["new","used","semi_new"]).optional(),engine:short.optional(),engineDisplacementCc:z.number().positive().max(100000).optional(),powerHp:z.number().positive().max(10000).optional(),driveType:short.optional(),
 plateEnding:z.string().regex(/^\d?$/,"Informe apenas o último número da placa.").optional(),fipeCode:z.string().trim().max(30).optional(),
 city:short.optional(),state:z.enum(BRAZIL_STATES).optional(),
 firstOwner:z.boolean().optional(),armoured:z.boolean().optional(),ipvaPaid:z.boolean().optional(),licensed:z.boolean().optional(),auctionHistory:z.boolean().optional(),accidentHistory:z.boolean().optional(),acceptsTrade:z.boolean().optional(),acceptsFinancing:z.boolean().optional(),
 features:z.array(short.min(1)).max(50).default([]),notes:z.string().max(4000).optional(),internalNotes:z.string().max(4000).optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.manufactureYear&&value.modelYear&&value.modelYear<value.manufactureYear)ctx.addIssue({code:"custom",path:["modelYear"],message:"O ano do modelo não pode ser anterior ao ano de fabricação."});
});

export const realEstateDetailsSchema=z.object({
 kind:z.enum(REAL_ESTATE_KINDS),purpose:z.enum(["sale","rent"]),
 status:z.enum(["available","reserved","sold","rented","inactive"]).default("available"),
 address:z.object({postalCode:z.string().regex(/^(?:\d{5}-?\d{3})?$/,"Informe um CEP válido." ).optional(),state:z.enum(BRAZIL_STATES),city:short.min(1,"Informe a cidade do imóvel."),neighborhood:short.optional(),street:short.optional(),number:z.string().trim().max(30).optional(),complement:short.optional(),showExactAddress:z.boolean().default(false)}).strict(),
 usableArea:area.optional(),builtArea:area.optional(),landArea:area.optional(),totalArea:area.optional(),
 bedrooms:count.optional(),suites:count.optional(),bathrooms:count.optional(),parkingSpaces:count.optional(),floor:count.optional(),floors:count.optional(),constructionYear:z.number().int().min(1500).max(2200).optional(),
 furnishing:z.enum(["unfurnished","partly_furnished","furnished"]).optional(),condition:z.enum(["new","used","under_construction","renovated"]).optional(),sunPosition:short.optional(),
 condominiumCents:cents.optional(),propertyTaxCents:cents.optional(),propertyTaxPeriod:z.enum(["monthly","yearly"]).optional(),
 petsAllowed:z.boolean().optional(),acceptsFinancing:z.boolean().optional(),acceptsTrade:z.boolean().optional(),
 features:z.array(short.min(1)).max(50).default([]),condominiumFeatures:z.array(short.min(1)).max(50).default([]),
 notes:z.string().max(4000).optional(),internalNotes:z.string().max(4000).optional(),
}).strict().superRefine((value,ctx)=>{
 if(!value.usableArea&&!value.builtArea&&!value.landArea&&!value.totalArea)ctx.addIssue({code:"custom",path:["usableArea"],message:"Informe ao menos uma área do imóvel em m²."});
 if(value.suites!==undefined&&value.bedrooms!==undefined&&value.suites>value.bedrooms)ctx.addIssue({code:"custom",path:["suites"],message:"O número de suítes não pode superar o total de quartos."});
 if(value.propertyTaxCents!==undefined&&!value.propertyTaxPeriod)ctx.addIssue({code:"custom",path:["propertyTaxPeriod"],message:"Informe se o IPTU é mensal ou anual."});
 if(value.status==="sold"&&value.purpose!=="sale"||value.status==="rented"&&value.purpose!=="rent")ctx.addIssue({code:"custom",path:["status"],message:"A situação do imóvel deve corresponder à finalidade escolhida."});
});
export type VehicleDetails=z.infer<typeof vehicleDetailsSchema>;
export type RealEstateDetails=z.infer<typeof realEstateDetailsSchema>;

// O site público nunca recebe notas internas. Endereço exato só entra
// na resposta após a escolha explícita do anunciante.
export function publicVehicleDetails(value:VehicleDetails|undefined){if(!value)return undefined;const {internalNotes,...publicFields}=value;return publicFields;}
export function publicRealEstateDetails(value:RealEstateDetails|undefined){if(!value)return undefined;const {internalNotes,address,...publicFields}=value;const {postalCode,street,number,complement,showExactAddress,...location}=address;return {...publicFields,address:showExactAddress?{...location,street,number,complement}:{...location}};}
