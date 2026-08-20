import { Card, CardBody } from "@/components/Card";
import { formatDate } from "@/lib/format";
import { ASSET_KIND_LABEL, ASSET_MATERIAL_TYPE_LABEL, ASSET_USAGE_PRIORITY_LABEL, type Asset } from "../types";

const KIND_ICON: Record<string, string> = {
  logo: "🔷",
  photo: "🖼",
  video: "🎬",
  product: "📦",
  mockup: "🖥",
  visual_identity: "🎨",
  font: "🔤",
  brand_book: "📘",
  reference: "🔖",
  document: "📄",
};

const PREVIEWABLE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);

export function AssetCard({ asset, onEdit, onArchive, onDelete }: { asset: Asset; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const previewUrl = asset.storageRef?.metadata?.url;
  const contentType = asset.storageRef?.metadata?.contentType;
  const canPreview =
    Boolean(previewUrl) &&
    (asset.kind === "logo" ||
      asset.kind === "photo" ||
      asset.kind === "product" ||
      asset.kind === "mockup" ||
      asset.kind === "visual_identity" ||
      Boolean(contentType && PREVIEWABLE_CONTENT_TYPES.has(contentType)));

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex aspect-video min-h-28 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken text-3xl sm:h-24 sm:min-h-0 sm:aspect-auto">
          {canPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            KIND_ICON[asset.kind] ?? "📁"
          )}
        </div>
        <div>
          <p className="truncate text-sm font-medium text-ink">{asset.name}</p>
          <p className="text-xs text-ink-muted">{ASSET_KIND_LABEL[asset.kind]}</p>
        </div>
        {asset.materialType || asset.usagePriority ? (
          <div className="flex flex-wrap gap-1">
            {asset.materialType ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{ASSET_MATERIAL_TYPE_LABEL[asset.materialType]}</span>
            ) : null}
            {asset.usagePriority ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">{ASSET_USAGE_PRIORITY_LABEL[asset.usagePriority]}</span>
            ) : null}
          </div>
        ) : null}
        {asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-[11px] text-ink-faint">Adicionado em {formatDate(asset.createdAt)}</p>
        <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-xs">
          <button type="button" onClick={onEdit} className="min-h-9 cursor-pointer font-medium text-accent hover:underline">
            Editar
          </button>
          <button type="button" onClick={onArchive} className="min-h-9 cursor-pointer font-medium text-ink-muted hover:text-ink">
            Arquivar
          </button>
          <button type="button" onClick={onDelete} className="min-h-9 cursor-pointer font-medium text-red-600 hover:text-red-700">
            Excluir
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
