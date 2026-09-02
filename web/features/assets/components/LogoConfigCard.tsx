"use client";

import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { archiveAsset } from "../api";
import { useAssets } from "../hooks";
import type { Asset } from "../types";
import { RegisterAssetModal } from "./RegisterAssetModal";

/**
 * Configuração dedicada da logo do workspace — antes disso, a logo era só mais um item genérico
 * dentro de "Materiais", sem destaque nem indicação de tamanho/formato recomendado. Continua
 * usando exatamente o mesmo mecanismo (`AssetKind: "logo"`, `findLogoAssetUrl` no backend já
 * lê "a primeira ativa"), só com uma UX guiada: preview grande sobre fundo quadriculado (revela
 * transparência), substituição em 1 clique, e o tamanho indicado. Ao substituir, arquiva a logo
 * anterior automaticamente — nunca deixa duas logos ativas disputando qual o motor de IA lê.
 */
export function LogoConfigCard({ workspaceId }: { workspaceId: string }) {
  const { data: logos, mutate } = useAssets(workspaceId, { kind: "logo" });
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const activeLogo = (logos ?? []).find((asset) => asset.status === "active" && asset.storageRef);
  const previewUrl = activeLogo?.storageRef?.metadata?.url;

  async function handleRegistered(newLogo: Asset) {
    setReplacing(false);
    if (activeLogo && activeLogo.id !== newLogo.id) {
      setBusy(true);
      setError(undefined);
      try {
        await archiveAsset(workspaceId, activeLogo.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Logo enviada, mas não foi possível arquivar a anterior — remova-a manualmente em Materiais.");
      } finally {
        setBusy(false);
      }
    }
    mutate();
  }

  async function handleRemove() {
    if (!activeLogo) return;
    setBusy(true);
    setError(undefined);
    try {
      await archiveAsset(workspaceId, activeLogo.id);
      mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover a logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-foreground">Logo da marca</p>
          <p className="mt-0.5 text-xs text-muted-foreground">A IA usa esta imagem para nunca inventar uma marca diferente da sua.</p>
        </div>
        <Button variant="secondary" onClick={() => setReplacing(true)} disabled={busy}>
          {activeLogo ? "Substituir logo" : "Enviar logo"}
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border"
          style={{
            backgroundImage: "conic-gradient(var(--color-background) 0.25turn, var(--color-card) 0.25turn 0.5turn, var(--color-background) 0.5turn 0.75turn, var(--color-card) 0.75turn)",
            backgroundSize: "16px 16px",
          }}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Logo da marca" className="h-full w-full object-contain p-2" />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/70" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          {activeLogo ? (
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">{activeLogo.name}</p>
              <button type="button" onClick={handleRemove} disabled={busy} className="shrink-0 text-xs font-medium text-muted-foreground hover:text-danger">
                Remover
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma logo cadastrada ainda.</p>
          )}
          <div className="rounded-lg bg-background px-3 py-2.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Tamanho indicado</p>
            <p className="mt-1">PNG com fundo transparente, formato quadrado (proporção 1:1), pelo menos 512×512px. Evite margens em excesso ao redor do símbolo.</p>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      </CardBody>

      {replacing ? (
        <RegisterAssetModal
          workspaceId={workspaceId}
          title={activeLogo ? "Substituir logo" : "Enviar logo"}
          defaultKind="logo"
          lockKind
          defaultMaterialType="logo_principal"
          defaultUsagePriority="required"
          onClose={() => setReplacing(false)}
          onRegistered={handleRegistered}
        />
      ) : null}
    </Card>
  );
}
