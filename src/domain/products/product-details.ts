import { z } from "zod";

export const PRODUCT_TYPES = ["GENERAL", "APPAREL", "VEHICLE"] as const;
const short = z.string().trim().max(160);
export const productOptionSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), name: short.min(1), values: z.array(short.min(1)).min(1).max(50) }).strict();
const attributeValue = z.union([short, z.number().finite(), z.boolean()]);
export const productDetailsSchema = z.object({
  type: z.enum(PRODUCT_TYPES).default("GENERAL"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).optional(),
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), attributeValue).default({}),
  options: z.array(productOptionSchema).max(4).default([]),
  apparel: z.object({ gender: short.optional(), collection: short.optional(), material: short.optional() }).strict().optional(),
  vehicle: z.object({ make: short.min(1), model: short.min(1), version: short.optional(), manufactureYear: z.number().int().min(1886).max(2200).optional(), modelYear: z.number().int().min(1886).max(2200).optional(), mileage: z.number().nonnegative().max(1e9).optional(), fuel: short.optional(), transmission: short.optional(), color: short.optional(), doors: z.number().int().min(1).max(10).optional(), condition: z.enum(["new", "used"]).optional(), features: z.array(short).max(50).default([]), notes: z.string().max(4000).optional() }).strict().optional(),
  siteVisible: z.boolean().default(false), catalogVisible: z.boolean().default(true), canPurchaseOnline: z.boolean().default(false),
  seo: z.object({ title: z.string().max(160).optional(), description: z.string().max(320).optional() }).strict().default({}),
  media: z.array(z.object({ url: z.string().max(2000), alt: z.string().max(200).default("") }).strict()).max(6).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.options.map(option => option.key)).size !== value.options.length) ctx.addIssue({ code: "custom", message: "Cada opção precisa de uma chave diferente.", path: ["options"] });
  for (const option of value.options) if (new Set(option.values).size !== option.values.length) ctx.addIssue({ code: "custom", message: "Remova valores repetidos da opção.", path: ["options"] });
  if (value.options.reduce((n, option) => n * option.values.length, 1) > 500) ctx.addIssue({ code: "custom", message: "Use no máximo 500 combinações por produto.", path: ["options"] });
  if (value.type === "VEHICLE" && !value.vehicle) ctx.addIssue({ code: "custom", message: "Informe marca e modelo do veículo.", path: ["vehicle"] });
});
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
