"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Label, Textarea } from "@/components/Field";
import { updateProductionSettings } from "../api";
import { useProductionSettings } from "../hooks";
import { CREATIVE_FREEDOM_LABEL, CREATIVE_FREEDOM_OPTIONS, TEXT_DENSITY_LABEL, TEXT_DENSITY_OPTIONS, type CreativeFreedom, type TextDensity } from "../types";

const SELECT_CLASSES = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-accent-soft";
const MAX_PROMPT_LENGTH = 8000;

/**
 * Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — instruções
 * criativas permanentes do workspace, editáveis a qualquer momento sem deploy. Toda nova geração
 * real (via motor GPT) inclui este texto verbatim no `creative_context`, com prioridade só abaixo
 * do pedido feito na hora da geração.
 */
export function ProductionSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const { data: settings, isLoading, mutate } = useProductionSettings(workspaceId);

  const [productionPrompt, setProductionPrompt] = useState("");
  const [preferRealAssets, setPreferRealAssets] = useState(true);
  const [allowFictionalInterfaces, setAllowFictionalInterfaces] = useState(false);
  const [allowGeneratedPeople, setAllowGeneratedPeople] = useState(true);
  const [textDensity, setTextDensity] = useState<TextDensity>("balanced");
  const [creativeFreedom, setCreativeFreedom] = useState<CreativeFreedom>("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<string | undefined>();
  const [savedVersion, setSavedVersion] = useState<number | undefined>();

  useEffect(() => {
    if (!settings) return;
    setProductionPrompt(settings.productionPrompt ?? "");
    setPreferRealAssets(settings.preferRealAssets);
    setAllowFictionalInterfaces(settings.allowFictionalInterfaces);
    setAllowGeneratedPeople(settings.allowGeneratedPeople);
    setTextDensity(settings.textDensity);
    setCreativeFreedom(settings.creativeFreedom);
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await updateProductionSettings(workspaceId, {
        productionPrompt: productionPrompt.trim() || undefined,
        preferRealAssets,
        allowFictionalInterfaces,
        allowGeneratedPeople,
        textDensity,
        creativeFreedom,
      });
      await mutate(updated);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
      setSavedVersion(updated.version);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as diretrizes.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-ink-muted">Carregando diretrizes…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="production-prompt">Prompt de Produção / Diretrizes Criativas</Label>
        <Textarea
          id="production-prompt"
          rows={8}
          maxLength={MAX_PROMPT_LENGTH}
          value={productionPrompt}
          onChange={(e) => setProductionPrompt(e.target.value)}
          placeholder='Ex.: "Crie peças modernas, tecnológicas e de alto impacto. Priorize fundo preto/grafite, verde neon, amarelo e branco. Utilize screenshots reais do site quando disponíveis. Não invente interfaces se houver screenshot real. Em campanhas de produto, destaque produto, preço e desconto."'
        />
        <p className={`mt-1 text-right text-xs ${productionPrompt.length >= MAX_PROMPT_LENGTH ? "text-red-600" : "text-ink-faint"}`}>
          {productionPrompt.length}/{MAX_PROMPT_LENGTH}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Essas instruções são usadas automaticamente em TODAS as novas gerações deste workspace — o pedido feito na hora da geração continua tendo prioridade quando houver conflito.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="text-density">Quantidade de texto preferida</Label>
          <select id="text-density" value={textDensity} onChange={(e) => setTextDensity(e.target.value as TextDensity)} className={SELECT_CLASSES}>
            {TEXT_DENSITY_OPTIONS.map((option) => (
              <option key={option} value={option}>{TEXT_DENSITY_LABEL[option]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="creative-freedom">Nível de liberdade criativa</Label>
          <select id="creative-freedom" value={creativeFreedom} onChange={(e) => setCreativeFreedom(e.target.value as CreativeFreedom)} className={SELECT_CLASSES}>
            {CREATIVE_FREEDOM_OPTIONS.map((option) => (
              <option key={option} value={option}>{CREATIVE_FREEDOM_LABEL[option]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={preferRealAssets} onChange={(e) => setPreferRealAssets(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Priorizar sempre assets reais (fotos/screenshots/logo reais) em vez de recriar visualmente
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={allowFictionalInterfaces} onChange={(e) => setAllowFictionalInterfaces(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Permitir interfaces fictícias (telas/apps inventados) quando não houver screenshot real
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={allowGeneratedPeople} onChange={(e) => setAllowGeneratedPeople(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Permitir pessoas geradas por IA na peça
        </label>
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-3">
        <p className="mb-2 text-xs font-medium text-ink-muted">Contexto que a IA receberá (resumo)</p>
        <ul className="list-inside list-disc space-y-1 text-xs text-ink-muted">
          <li>{preferRealAssets ? "Priorizar assets reais sobre recriação visual." : "Sem preferência forçada por assets reais."}</li>
          <li>{allowFictionalInterfaces ? "Interfaces fictícias permitidas quando necessário." : "Nunca inventar uma interface fictícia de site/app."}</li>
          <li>{allowGeneratedPeople ? "Pessoas geradas por IA permitidas." : "Não gerar pessoas/rostos artificiais."}</li>
          <li>{TEXT_DENSITY_LABEL[textDensity]}.</li>
          <li>{CREATIVE_FREEDOM_LABEL[creativeFreedom]}.</li>
          {productionPrompt.trim() ? <li>Suas diretrizes de texto livre acima, incluídas verbatim.</li> : null}
        </ul>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar diretrizes"}</Button>
        {savedAt ? <p className="text-xs text-ink-muted">Salvo às {savedAt} (versão {savedVersion})</p> : null}
      </div>
    </div>
  );
}
