"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, UploadCloud, X } from "lucide-react";
import styles from "./studio.module.css";

type Props = {
  kind: "image" | "video";
  urls: readonly string[];
  uploading: boolean;
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
  cover?: boolean;
};

export function StudioMedia({ kind, urls, uploading, onPick, onRemove, cover }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const label = cover ? "Adicionar capa" : kind === "image" ? "Adicionar imagens" : "Adicionar vídeo";
  const accept = kind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/quicktime";
  function pick(files: File[]) {
    if (uploading || files.length === 0) return;
    if (files.some((file) => !accept.split(",").includes(file.type))) {
      setError(kind === "image" ? "Escolha imagens JPG, PNG ou WebP." : "Escolha um vídeo MP4 ou MOV.");
      return;
    }
    setError("");
    onPick(kind === "video" || cover ? files.slice(0, 1) : files);
  }
  function keyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); }
  }
  const triggerProps = { tabIndex: uploading ? -1 : 0, role: "button", "aria-label": label, "aria-disabled": uploading, onClick: () => input.current?.click(), onKeyDown: keyboard };
  return (
    <div className="min-w-0" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); pick(Array.from(event.dataTransfer.files)); }}>
      <input ref={input} type="file" aria-label={label} accept={accept} multiple={kind === "image" && !cover} disabled={uploading} className="sr-only" onChange={(event) => { pick(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
      {urls.length === 0 ? (
        <div {...triggerProps} className={styles.dropzone} data-dragging={dragging} data-disabled={uploading}>
          <span className={styles.dropIcon}>{uploading ? <Loader2 className={styles.spin} /> : <UploadCloud />}</span>
          <p className={styles.dropTitle}>{uploading ? "Enviando seu arquivo…" : <>Arraste {kind === "image" ? "suas imagens" : "seu vídeo"} ou <strong>escolha um arquivo</strong></>}</p>
          <p className={styles.helper}>{kind === "image" ? "JPG, PNG ou WebP" : "MP4 ou MOV · ideal para Reels e Shorts"}{!cover && kind === "image" ? " · uma imagem ou carrossel" : ""}</p>
        </div>
      ) : (
        <>
          <div className={styles.mediaGrid} data-dragging={dragging}>
            {urls.map((url, index) => (
              <div key={`${url}-${index}`} className={styles.mediaTile}>
                {kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`Imagem ${index + 1} da publicação`} />
                ) : <video src={url} muted preload="metadata" aria-label="Vídeo selecionado" />}
                <button type="button" className={styles.remove} disabled={uploading} aria-label={`Remover ${kind === "image" ? "imagem" : "vídeo"} ${index + 1}`} onClick={() => onRemove(index)}><X /></button>
                <span className={styles.mediaIndex}>{kind === "video" ? "Vídeo" : `${index + 1}`}</span>
              </div>
            ))}
            {kind === "image" && !cover ? <div {...triggerProps} className={styles.addTile}>{uploading ? <Loader2 className={styles.spin} size={20} /> : <Plus size={20} />}Adicionar</div> : null}
          </div>
          <div className={styles.mediaFooter}>
            <p className={styles.helper} role="status">{uploading ? "Enviando arquivos…" : kind === "video" ? "Vídeo adicionado" : `${urls.length} ${urls.length === 1 ? "imagem adicionada" : "imagens adicionadas"}`}</p>
            {kind === "video" || cover ? <button type="button" disabled={uploading} className={styles.textButton} onClick={() => input.current?.click()}>Trocar arquivo</button> : <ImagePlus size={16} className="text-muted-foreground" aria-hidden />}
          </div>
        </>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
