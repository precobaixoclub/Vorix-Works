export type SharedProduct = {
  name: string; description: string; sku?: string; priceCents: number; currency: string;
  issuerName: string; images: string[]; selectedVariant?: string;
  variants: { label: string; priceCents: number }[];
};
