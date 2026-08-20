"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { archiveAsset, deleteAsset } from "@/features/assets/api";
import { AssetCard } from "@/features/assets/components/AssetCard";
import { EditAssetModal } from "@/features/assets/components/EditAssetModal";
import { LogoConfigCard } from "@/features/assets/components/LogoConfigCard";
import { RegisterAssetModal } from "@/features/assets/components/RegisterAssetModal";
import { useAssets } from "@/features/assets/hooks";
import type { Asset, AssetKind, AssetMaterialType } from "@/features/assets/types";
import { EditBrandProfileModal } from "@/features/brand-profile/components/EditBrandProfileModal";
import { useBrandProfile } from "@/features/brand-profile/hooks";
import { ProductionSettingsPanel } from "@/features/production-settings/components/ProductionSettingsPanel";
import { useProductionSettings } from "@/features/production-settings/hooks";

/**
 * Migração "Marca & Materiais" — consolida em uma única tela (rota preservada em `/knowledge`
 * para não quebrar links existentes) o que antes eram 3 experiências fragmentadas: "Marca"
 * (dados mockados), "Materiais" (`/assets`) e "Diretrizes Criativas" (dentro de Produção). Cada
 * aba é só uma vitrine de UX sobre dados/rotas que já existiam — nenhuma fonte de verdade nova.
 */

type TabId = "profile" | "guidelines" | "materials";

const TABS: { id: TabId; label: string }[] = [
  { id: "profile", label: "Perfil da Marca" },
  { id: "guidelines", label: "Diretrizes Criativas" },
  { id: "materials", label: "Materiais" },
];

type MaterialFilterId = "all" | "logos" | "produtos" | "screenshots" | "referencias" | "fotos" | "fundos" | "outros";

const MATERIAL_FILTERS: { id: MaterialFilterId; label: string; kinds?: AssetKind[]; materialTypes?: AssetMaterialType[] }[] = [
  { id: "all", label: "Todos" },
  { id: "logos", label: "Logos", kinds: ["logo"], materialTypes: ["logo_principal", "logo_secundaria"] },
  { id: "produtos", label: "Produtos", kinds: ["product"], materialTypes: ["produto"] },
  { id: "screenshots", label: "Screenshots", kinds: ["mockup"], materialTypes: ["screenshot_site", "screenshot_app"] },
  { id: "referencias", label: "Referências", kinds: ["reference"], materialTypes: ["referencia_visual", "campanha"] },
  { id: "fotos", label: "Fotos", kinds: ["photo"], materialTypes: ["foto_institucional"] },
  { id: "fundos", label: "Fundos", materialTypes: ["fundo"] },
  { id: "outros", label: "Outros", kinds: ["video", "font", "brand_book", "document"], materialTypes: ["selo", "icone", "outro"] },
];

export default function KnowledgePage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: TabId = rawTab === "guidelines" || rawTab === "materials" ? rawTab : "profile";

  function setTab(tab: TabId) {
    router.replace(`/workspaces/${workspace.id}/knowledge?tab=${tab}`, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">Marca</h1>
        <p className="mt-1 text-sm text-ink-muted">Identidade, diretrizes criativas e materiais que a IA usa para criar conteúdo desta marca.</p>
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" ? <BrandProfileTab workspaceId={workspace.id} onGoToTab={setTab} /> : null}
      {activeTab === "guidelines" ? <GuidelinesTab workspaceId={workspace.id} /> : null}
      {activeTab === "materials" ? <MaterialsTab workspaceId={workspace.id} /> : null}
    </main>
  );
}

function BrandSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-raised p-5">
      <p className="mb-3 text-sm font-semibold text-ink">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function BrandField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-faint">{label}</p>
      {value ? <p className="mt-0.5 text-sm text-ink">{value}</p> : <p className="mt-0.5 text-sm text-ink-faint">Não configurado.</p>}
    </div>
  );
}

function BrandProfileTab({ workspaceId, onGoToTab }: { workspaceId: string; onGoToTab: (tab: TabId) => void }) {
  const workspace = useCurrentWorkspace();
  const { data: profile, isLoading, error, mutate } = useBrandProfile(workspaceId);
  const { data: assets } = useAssets(workspaceId);
  const { data: settings } = useProductionSettings(workspaceId);
  const [editing, setEditing] = useState(false);

  const activeLogo = (assets ?? []).find((asset) => asset.kind === "logo" && asset.status === "active");
  const hasLogo = Boolean(activeLogo?.storageRef);
  const hasDescription = Boolean(profile?.businessDescription);
  const hasGuidelines = Boolean(settings?.productionPrompt);
  const hasMaterials = (assets?.length ?? 0) > 0;
  const isComplete = hasLogo && hasDescription && hasGuidelines && hasMaterials;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
        <Spinner className="h-4 w-4" /> Carregando…
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => mutate()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface-raised p-5">
        <div className="flex items-center gap-3">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeLogo?.storageRef?.metadata?.url} alt="" className="h-14 w-14 rounded-xl bg-surface-sunken object-contain p-1.5" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-sunken text-2xl text-ink-faint" aria-hidden="true">🔷</span>
          )}
          <div>
            <p className="font-display text-lg font-semibold text-ink">{workspace.name}</p>
            {workspace.kind ? <p className="text-sm text-ink-muted">{workspace.kind}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isComplete ? "bg-success-bg text-success" : "bg-surface-sunken text-ink-muted"}`}>
            Perfil da marca: {isComplete ? "Completo" : "Parcial"}
          </span>
          <Button variant="secondary" onClick={() => setEditing(true)}>Editar perfil</Button>
        </div>
      </div>

      <BrandSection title="Sobre a marca">
        <BrandField label="Descrição" value={profile?.businessDescription} />
        <BrandField label="Posicionamento" value={profile?.positioning} />
      </BrandSection>

      <BrandSection title="Público">
        <BrandField label="Público-alvo" value={profile?.targetAudience} />
      </BrandSection>

      <BrandSection title="Diferenciais">
        {profile?.differentiators && profile.differentiators.length > 0 ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-ink">
            {profile.differentiators.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">Nenhum diferencial cadastrado ainda.</p>
        )}
      </BrandSection>

      <BrandSection title="Comunicação">
        <BrandField label="Tom de voz" value={profile?.toneOfVoice} />
      </BrandSection>

      <button type="button" onClick={() => onGoToTab("materials")} className="text-sm font-medium text-accent hover:underline">
        Gerenciar materiais →
      </button>

      {editing ? (
        <EditBrandProfileModal
          workspaceId={workspaceId}
          profile={profile ?? null}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            mutate(updated);
          }}
        />
      ) : null}
    </div>
  );
}

function GuidelinesTab({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface-raised p-5">
        <p className="text-sm font-semibold text-ink">Diretrizes Criativas</p>
        <p className="mt-1 text-sm text-ink-muted">Defina como o GPT deve criar conteúdos para esta marca.</p>
        <p className="mt-3 text-xs text-ink-faint">
          Estas instruções serão aplicadas automaticamente em todas as novas criações deste workspace — o pedido feito na hora da geração continua tendo prioridade quando houver conflito.
        </p>
        <div className="mt-4">
          <ProductionSettingsPanel workspaceId={workspaceId} />
        </div>
      </div>

      <div className="rounded-2xl bg-surface-raised p-5">
        <p className="text-sm font-semibold text-ink">Exemplos de diretrizes</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-muted">
          <li>&ldquo;Priorize fotos e screenshots reais em vez de recriar visualmente.&rdquo;</li>
          <li>&ldquo;Use sempre fundo escuro com detalhes em verde.&rdquo;</li>
          <li>&ldquo;Nunca invente preços ou promoções que não foram informados.&rdquo;</li>
        </ul>
      </div>
    </div>
  );
}

function MaterialsTab({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MaterialFilterId>("all");
  const [isRegistering, setIsRegistering] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | undefined>();
  const [editingAsset, setEditingAsset] = useState<Asset | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);
  const { data: assets, isLoading, error, mutate } = useAssets(workspaceId, { search: search || undefined });

  const activeLogo = (assets ?? []).find((asset) => asset.kind === "logo" && asset.status === "active");

  const visibleAssets = useMemo(() => {
    const list = (assets ?? []).filter((asset) => asset.id !== activeLogo?.id);
    if (filter === "all") return list;
    const def = MATERIAL_FILTERS.find((f) => f.id === filter);
    if (!def) return list;
    return list.filter((asset) => def.kinds?.includes(asset.kind) || (asset.materialType ? def.materialTypes?.includes(asset.materialType) : false));
  }, [assets, activeLogo, filter]);

  function openRegister(file?: File) {
    setDroppedFile(file);
    setIsRegistering(true);
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError(undefined);
    try {
      await action();
      mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação.");
    }
  }

  const isLibraryEmpty = (assets ?? []).length === 0;

  return (
    <div
      className={`space-y-4 rounded-2xl transition-shadow ${dragOver ? "ring-2 ring-accent" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) openRegister(file);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Materiais</p>
          <p className="mt-1 text-sm text-ink-muted">Logos, produtos, screenshots e referências que a IA pode utilizar.</p>
        </div>
        <Button onClick={() => openRegister()}>+ Adicionar material</Button>
      </div>

      <p className="text-xs text-ink-faint">ou arraste um arquivo para qualquer lugar desta área</p>

      <LogoConfigCard workspaceId={workspaceId} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar por nome…"
          aria-label="Pesquisar materiais por nome"
          className="w-full sm:max-w-xs"
        />
        {MATERIAL_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.id ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLibraryEmpty ? (
        <EmptyState
          title="Sua biblioteca está vazia"
          description="Adicione logos, produtos, screenshots ou referências para ajudar a IA a criar conteúdos mais fiéis à sua marca."
          action={<Button onClick={() => openRegister()}>Adicionar primeiro material</Button>}
        />
      ) : visibleAssets.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">Nenhum material encontrado para este filtro.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleAssets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onEdit={() => setEditingAsset(asset)}
              onArchive={() => runAction(() => archiveAsset(workspaceId, asset.id))}
              onDelete={() => runAction(() => deleteAsset(workspaceId, asset.id))}
            />
          ))}
        </div>
      )}

      {isRegistering ? (
        <RegisterAssetModal
          workspaceId={workspaceId}
          initialFile={droppedFile}
          onClose={() => {
            setIsRegistering(false);
            setDroppedFile(undefined);
          }}
          onRegistered={() => {
            setIsRegistering(false);
            setDroppedFile(undefined);
            mutate();
          }}
        />
      ) : null}

      {editingAsset ? (
        <EditAssetModal
          asset={editingAsset}
          onClose={() => setEditingAsset(undefined)}
          onUpdated={() => {
            setEditingAsset(undefined);
            mutate();
          }}
        />
      ) : null}
    </div>
  );
}
