import { Card, CardBody } from "@/components/Card";
import { formatDate } from "@/lib/format";
import { ASSET_KIND_LABEL, type Asset } from "../types";

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

export function AssetCard({ asset, onArchive, onDelete }: { asset: Asset; onArchive: () => void; onDelete: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex h-24 items-center justify-center rounded-lg bg-surface-sunken text-3xl">{KIND_ICON[asset.kind] ?? "📁"}</div>
        <div>
          <p className="truncate text-sm font-medium text-ink">{asset.name}</p>
          <p className="text-xs text-ink-muted">{ASSET_KIND_LABEL[asset.kind]}</p>
        </div>
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
        <div className="flex gap-2 border-t border-border pt-2 text-xs">
          <button type="button" onClick={onArchive} className="cursor-pointer font-medium text-ink-muted hover:text-ink">
            Arquivar
          </button>
          <button type="button" onClick={onDelete} className="cursor-pointer font-medium text-red-600 hover:text-red-700">
            Excluir
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
