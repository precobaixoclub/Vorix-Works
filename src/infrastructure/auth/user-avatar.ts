import sharp from "sharp";

/** Armazena apenas uma miniatura reprocessada, sem SVG, URLs externas ou metadados do arquivo. */
export async function normalizeUserAvatar(value: string | null | undefined): Promise<string | null | undefined> {
  if (value === undefined || value === null) return value;
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("IDENTITY_VALIDATION_ERROR: escolha uma foto PNG, JPG, WebP ou GIF.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("IDENTITY_VALIDATION_ERROR: a foto deve ter até 2 MB.");
  try {
    const photo = await sharp(bytes, { limitInputPixels: 16_000_000 }).rotate().resize(256, 256, { fit: "cover", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return `data:image/webp;base64,${photo.toString("base64")}`;
  } catch {
    throw new Error("IDENTITY_VALIDATION_ERROR: não foi possível ler esta foto. Escolha outra imagem.");
  }
}
