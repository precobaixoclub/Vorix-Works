import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getApiBaseUrl } from "@/lib/api-error";
import { formatCurrencyCents } from "@/lib/format";
import type { SharedProduct } from "@/features/crm/public-product";

const load = cache(async (token: string): Promise<SharedProduct | null> => {
  if (!/^[A-Za-z0-9_-]{40,2000}$/.test(token)) return null;
  const response = await fetch(`${getApiBaseUrl()}/v1/public/products?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Não foi possível carregar o produto. Tente novamente.");
  return (await response.json()).data;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const product = await load((await params).token);
  if (!product) return { title: "Produto indisponível", robots: { index: false, follow: false } };
  const title = `${product.name} — ${product.issuerName}`;
  return { title: { absolute: title }, description: product.description.slice(0, 160), robots: { index: false, follow: false }, referrer: "no-referrer", openGraph: { title, description: product.description.slice(0, 160), images: product.images.slice(0, 1) }, twitter: { card: "summary_large_image", title, images: product.images.slice(0, 1) } };
}

export default async function SharedProductPage({ params }: { params: Promise<{ token: string }> }) {
  const product = await load((await params).token);
  if (!product) notFound();
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 border-b border-slate-200 pb-5">
          <p className="break-words text-lg font-semibold">{product.issuerName}</p>
          <p className="mt-1 text-sm text-slate-500">Detalhes do produto</p>
        </header>
        <article className="grid gap-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 md:grid-cols-2">
          {product.images.length > 0 ? (
            <div className="min-w-0 space-y-4">
              <img src={product.images[0]} alt={product.name} className="aspect-square w-full rounded-xl bg-slate-50 object-contain p-3" />
              {product.images.length > 1 ? <div className="grid grid-cols-2 gap-3">{product.images.slice(1).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${product.name} — foto ${index + 2}`} className="aspect-square w-full rounded-lg border border-slate-200 object-contain p-2" loading="lazy" /></a>)}</div> : null}
            </div>
          ) : null}
          <div className={`min-w-0 ${product.images.length ? "" : "md:col-span-2"}`}>
            <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
            {product.selectedVariant ? <p className="mt-2 break-words text-slate-600">Opção: {product.selectedVariant}</p> : null}
            {product.sku ? <p className="mt-2 break-words text-sm text-slate-500">Referência: {product.sku}</p> : null}
            <p className="mt-5 text-3xl font-semibold tracking-tight">{formatCurrencyCents(product.priceCents, product.currency)}</p>
            {product.description ? <section className="mt-7 border-t border-slate-200 pt-5"><h2 className="text-base font-semibold">Descrição</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{product.description}</p></section> : null}
            {product.variants.length > 1 ? <section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-base font-semibold">Opções disponíveis</h2><ul className="mt-3 space-y-2">{product.variants.map((variant, index) => <li key={index} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="break-words">{variant.label}</span><span>{formatCurrencyCents(variant.priceCents, product.currency)}</span></li>)}</ul></section> : null}
          </div>
        </article>
      </div>
    </main>
  );
}
