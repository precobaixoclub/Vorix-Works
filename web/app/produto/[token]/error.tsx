"use client";
export default function ProductError({ reset }: { reset: () => void }) {
  return <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-slate-900"><div className="max-w-md text-center"><h1 className="text-2xl font-semibold">Não foi possível carregar o produto</h1><p className="mt-3 text-sm text-slate-600">Tente novamente em alguns instantes.</p><button onClick={reset} className="mt-5 rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white">Tentar novamente</button></div></main>;
}
