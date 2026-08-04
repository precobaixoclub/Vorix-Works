"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { AssetCard } from "@/features/assets/components/AssetCard";
import { RegisterAssetModal } from "@/features/assets/components/RegisterAssetModal";
import { archiveAsset, deleteAsset } from "@/features/assets/api";
import { useAssets } from "@/features/assets/hooks";
import { ASSET_KINDS, ASSET_KIND_LABEL, type AssetKind } from "@/features/assets/types";

export default function AssetsPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<AssetKind | undefined>(undefined);
  const [isRegistering, setIsRegistering] = useState(false);
  const { data: assets, isLoading, error, mutate } = useAssets(workspace.id, { search: search || undefined, kind: kindFilter });

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Materiais da Marca"
        description="Logo, fotos, vídeos, brand book, fontes e referências que a IA vai usar para criar campanhas, roteiros e artes automaticamente."
        actions={<Button onClick={() => setIsRegistering(true)}>+ Enviar Material</Button>}
      />

      <div className="mb-6 rounded-lg border border-surface-raised bg-surface-raised/40 p-4 text-sm text-ink-muted">
        <p className="mb-1 font-medium text-ink">Para que serve esta biblioteca?</p>
        <p>
          Tudo o que você sobe aqui vira memória visual da marca. Quando você pedir no Chat “faça um post com o logo”
          ou “usa aquela foto do produto”, a IA busca automaticamente nesta biblioteca — sem precisar reexplicar cores,
          fontes ou reenviar arquivos a cada campanha.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar por nome…"
          aria-label="Pesquisar ativos por nome"
          className="max-w-xs"
        />
        <button
          type="button"
          onClick={() => setKindFilter(undefined)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !kindFilter ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"
          }`}
        >
          Todos
        </button>
        {ASSET_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setKindFilter(kind)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              kindFilter === kind ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"
            }`}
          >
            {ASSET_KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !assets || assets.length === 0 ? (
        <EmptyState
          title="Nenhum material cadastrado"
          description="Envie o primeiro material da marca (logo, foto, brand book...) para que a IA possa usá-lo ao criar campanhas."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onArchive={async () => {
                await archiveAsset(workspace.id, asset.id);
                mutate();
              }}
              onDelete={async () => {
                await deleteAsset(workspace.id, asset.id);
                mutate();
              }}
            />
          ))}
        </div>
      )}

      {isRegistering ? (
        <RegisterAssetModal
          workspaceId={workspace.id}
          onClose={() => setIsRegistering(false)}
          onRegistered={() => {
            setIsRegistering(false);
            mutate();
          }}
        />
      ) : null}
    </main>
  );
}
