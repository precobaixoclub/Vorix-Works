import { BookOpen, Bookmark, FileText, Folder, Image as ImageIcon, Monitor, Package, Palette, Type, Video, type LucideIcon } from "lucide-react";
import { Card, CardBody } from "@/components/Card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { ASSET_KIND_LABEL, ASSET_MATERIAL_TYPE_LABEL, ASSET_USAGE_PRIORITY_LABEL, type Asset } from "../types";

const KIND_ICON: Record<string, LucideIcon> = {
  logo: ImageIcon,
  photo: ImageIcon,
  video: Video,
  product: Package,
  mockup: Monitor,
  visual_identity: Palette,
  font: Type,
  brand_book: BookOpen,
  reference: Bookmark,
  document: FileText,
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
  const KindIcon = KIND_ICON[asset.kind] ?? Folder;

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex aspect-video min-h-28 items-center justify-center overflow-hidden rounded-lg bg-background text-muted-foreground sm:h-24 sm:min-h-0 sm:aspect-auto">
          {canPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <KindIcon className="h-8 w-8" aria-hidden="true" />
          )}
        </div>
        <div>
          <p className="truncate text-sm font-medium text-foreground">{asset.name}</p>
          <p className="text-xs text-muted-foreground">{ASSET_KIND_LABEL[asset.kind]}</p>
        </div>
        {asset.materialType || asset.usagePriority ? (
          <div className="flex flex-wrap gap-1">
            {asset.materialType ? (
              <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10">{ASSET_MATERIAL_TYPE_LABEL[asset.materialType]}</Badge>
            ) : null}
            {asset.usagePriority ? (
              <Badge variant="secondary">{ASSET_USAGE_PRIORITY_LABEL[asset.usagePriority]}</Badge>
            ) : null}
          </div>
        ) : null}
        {asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground/70">Adicionado em {formatDate(asset.createdAt)}</p>
        <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-xs">
          <button type="button" onClick={onEdit} className="min-h-9 cursor-pointer font-medium text-primary hover:underline">
            Editar
          </button>
          <button type="button" onClick={onArchive} className="min-h-9 cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            Arquivar
          </button>
          <button type="button" onClick={onDelete} className="min-h-9 cursor-pointer font-medium text-danger hover:text-danger/80">
            Excluir
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
