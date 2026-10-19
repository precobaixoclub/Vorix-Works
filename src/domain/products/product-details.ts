import { z } from "zod";
import {vehicleDetailsSchema,realEstateDetailsSchema} from "./product-specializations.js";

export const PRODUCT_TYPES = ["GENERAL", "APPAREL", "VEHICLE", "REAL_ESTATE"] as const;
const short = z.string().trim().max(160);
export const productOptionSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), name: short.min(1), values: z.array(short.min(1)).min(1).max(50) }).strict();
const attributeValue = z.union([short, z.number().finite(), z.boolean()]);
export const productDetailsSchema = z.preprocess(raw=>{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return raw;
 const value={...raw} as Record<string,unknown>,type=value.type??"GENERAL";
 if(type!=="VEHICLE")delete value.vehicle;
 if(type!=="REAL_ESTATE")delete value.realEstate;
 if(type!=="APPAREL")delete value.apparel;
 if(type==="VEHICLE"&&value.vehicle&&typeof value.vehicle==="object"){
  const vehicle={...value.vehicle} as Record<string,unknown>;
  if(vehicle.kind==="motorcycle")for(const key of["doors","seats","bodyType","driveType","armoured"])delete vehicle[key];
  value.vehicle=vehicle;
 }
 if(type==="REAL_ESTATE"&&value.realEstate&&typeof value.realEstate==="object"){
  const estate={...value.realEstate} as Record<string,unknown>,kind=estate.kind;
  if(!["house","condo_house","townhouse","apartment","studio","rural"].includes(String(kind)))for(const key of["bedrooms","suites","furnishing","petsAllowed"])delete estate[key];
  if(kind==="land")for(const key of["usableArea","builtArea","bathrooms","parkingSpaces","floor","floors","constructionYear","sunPosition","features"])delete estate[key];
  if(["apartment","studio","commercial"].includes(String(kind)))for(const key of["landArea","builtArea","floors"])delete estate[key];
  else delete estate.floor;
  if(estate.purpose==="rent")for(const key of["acceptsFinancing","acceptsTrade"])delete estate[key];
  value.realEstate=estate;
 }
 return value;
},z.object({
  type: z.enum(PRODUCT_TYPES).default("GENERAL"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).optional(),
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), attributeValue).default({}),
  options: z.array(productOptionSchema).max(4).default([]),
  apparel: z.object({ gender: short.optional(), collection: short.optional(), material: short.optional() }).strict().optional(),
  vehicle: vehicleDetailsSchema.optional(),
  realEstate: realEstateDetailsSchema.optional(),
  siteVisible: z.boolean().default(false), catalogVisible: z.boolean().default(true), canPurchaseOnline: z.boolean().default(false),
  seo: z.object({ title: z.string().max(160).optional(), description: z.string().max(320).optional() }).strict().default({}),
  media: z.array(z.object({ url: z.string().max(2000), alt: z.string().max(200).default("") }).strict()).max(30).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.options.map(option => option.key)).size !== value.options.length) ctx.addIssue({ code: "custom", message: "Cada opção precisa de uma chave diferente.", path: ["options"] });
  for (const option of value.options) if (new Set(option.values).size !== option.values.length) ctx.addIssue({ code: "custom", message: "Remova valores repetidos da opção.", path: ["options"] });
  if (value.options.reduce((n, option) => n * option.values.length, 1) > 500) ctx.addIssue({ code: "custom", message: "Use no máximo 500 combinações por produto.", path: ["options"] });
  if (value.type === "VEHICLE" && !value.vehicle) ctx.addIssue({ code: "custom", message: "Informe marca e modelo do veículo.", path: ["vehicle"] });
  if (value.type === "REAL_ESTATE" && !value.realEstate) ctx.addIssue({code:"custom",message:"Preencha a ficha do imóvel.",path:["realEstate"]});
  if ((value.type==="REAL_ESTATE"||value.type==="VEHICLE")&&value.options.length)ctx.addIssue({code:"custom",message:"Veículos e imóveis devem ter um cadastro próprio por unidade, sem combinações de tamanho ou cor.",path:["options"]});
}));
export type ProductDetails = z.infer<typeof productDetailsSchema>;
export const defaultProductDetails = (): ProductDetails => productDetailsSchema.parse({});
export const slugifyProductText = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160);

export type ProductCategory = { id: string; tenantId: string; workspaceId: string; name: string; slug: string; parentId?: string; active: boolean; siteVisible: boolean; position: number; imageUrl?: string };
export type ProductBrand = { id: string; tenantId: string; workspaceId: string; name: string; slug: string; active: boolean; logoUrl?: string };
export type AttributeDefinition = { id: string; tenantId: string; workspaceId: string; categoryId?: string; key: string; label: string; kind: "text" | "number" | "boolean" | "select"; choices: string[]; required: boolean; unit?: string; active: boolean };

export function optionCombinations(options: readonly z.infer<typeof productOptionSchema>[]): Record<string, string>[] {
  if (!options.length) return [];
  return options.reduce<Record<string, string>[]>((combinations, option) => combinations.flatMap(combination => option.values.map(value => ({ ...combination, [option.key]: value }))), [{}]);
}

export function validateVariantSelection(options: ProductDetails["options"], values: Record<string, string>): void {
  if (Object.keys(values).length !== options.length || options.some(option => !option.values.includes(values[option.key] ?? ""))) throw new Error("PRODUCT_VALIDATION: selecione exatamente um valor válido de cada opção.");
}

export function validateAttributeValues(definitions: readonly AttributeDefinition[], values: ProductDetails["attributes"]): void {
  for (const definition of definitions.filter(item => item.active)) {
    const value = values[definition.key];
    if (value === undefined || value === "") { if (definition.required) throw new Error(`PRODUCT_VALIDATION: informe ${definition.label}.`); continue; }
    const valid = definition.kind === "select" ? typeof value === "string" && definition.choices.includes(value) : typeof value === (definition.kind === "text" ? "string" : definition.kind);
    if (!valid) throw new Error(`PRODUCT_VALIDATION: valor inválido para ${definition.label}.`);
  }
  if (Object.keys(values).some(key => !definitions.some(definition => definition.key === key))) throw new Error("PRODUCT_VALIDATION: cadastre a especificação antes de preencher seu valor.");
}
