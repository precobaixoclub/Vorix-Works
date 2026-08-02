import { delay, generateId } from "@/lib/mock";
import type { Asset, AssetKind } from "./types";

/** Dados simulados — Sprint 04 (Fase 4: "ainda sem upload real"). "Enviar" só registra metadados
 * (nome/tipo/tags), do mesmo jeito que `AssetLibraryRepositoryPort.registerAsset` já faz no
 * backend — nenhum byte de arquivo é aceito ou armazenado aqui, propositalmente. */

const assetsByWorkspace = new Map<string, Asset[]>();
const seeded = new Set<string>();

function seed(workspaceId: string): void {
  if (seeded.has(workspaceId)) return;
  seeded.add(workspaceId);
  const now = Date.now();
  const seedData: Array<Pick<Asset, "kind" | "name" | "tags">> = [
    { kind: "logo", name: "logo-principal.svg", tags: ["marca"] },
    { kind: "photo", name: "campanha-verao-01.jpg", tags: ["campanha", "verão"] },
    { kind: "brand_book", name: "brand-book-2026.pdf", tags: ["identidade"] },
    { kind: "video", name: "reels-lancamento.mp4", tags: ["reels"] },
  ];
  assetsByWorkspace.set(
    workspaceId,
    seedData.map((item, index) => ({
      id: generateId("asset"),
      workspaceId,
      status: "active",
      createdAt: new Date(now - (seedData.length - index) * 1000 * 60 * 60 * 20).toISOString(),
      updatedAt: new Date(now - (seedData.length - index) * 1000 * 60 * 60 * 20).toISOString(),
      ...item,
    })),
  );
}

export async function listAssets(workspaceId: string, filter?: { kind?: AssetKind; search?: string }): Promise<Asset[]> {
  await delay();
  seed(workspaceId);
  const all = assetsByWorkspace.get(workspaceId) ?? [];
  return all
    .filter((asset) => (filter?.kind ? asset.kind === filter.kind : true))
    .filter((asset) => (filter?.search ? asset.name.toLowerCase().includes(filter.search.toLowerCase()) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function registerAsset(workspaceId: string, input: { kind: AssetKind; name: string; tags?: string[] }): Promise<Asset> {
  await delay();
  seed(workspaceId);
  const timestamp = new Date().toISOString();
  const asset: Asset = {
    id: generateId("asset"),
    workspaceId,
    kind: input.kind,
    name: input.name,
    status: "active",
    tags: input.tags ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  assetsByWorkspace.set(workspaceId, [asset, ...(assetsByWorkspace.get(workspaceId) ?? [])]);
  return asset;
}

export async function archiveAsset(workspaceId: string, assetId: string): Promise<void> {
  await delay(150);
  const assets = assetsByWorkspace.get(workspaceId) ?? [];
  assetsByWorkspace.set(
    workspaceId,
    assets.map((asset) => (asset.id === assetId ? { ...asset, status: "archived", updatedAt: new Date().toISOString() } : asset)),
  );
}

export async function deleteAsset(workspaceId: string, assetId: string): Promise<void> {
  await delay(150);
  const assets = assetsByWorkspace.get(workspaceId) ?? [];
  assetsByWorkspace.set(
    workspaceId,
    assets.filter((asset) => asset.id !== assetId),
  );
}
