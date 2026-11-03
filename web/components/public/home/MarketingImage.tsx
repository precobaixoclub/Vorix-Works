type Props = {
  asset: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
  sizes?: string;
  photo?: boolean;
};

/** Variantes locais explícitas: a home não depende de hotlinks nem do otimizador em runtime. */
export function MarketingImage({
  asset,
  alt,
  width = 1440,
  height = 960,
  priority = false,
  className,
  sizes = "(max-width: 767px) 92vw, 650px",
  photo = false,
}: Props) {
  const widths = asset.endsWith("/mobile")
    ? [390]
    : asset.startsWith("hero/")
      ? [640, 960, 1280]
      : asset === "people/reuniao"
        ? [480, 800]
        : photo
          ? [480, 800, 1120]
          : [640, 960, 1120];
  const srcset = (format: string) =>
    widths
      .map((value) => `/marketing/home/${asset}-${value}.${format} ${value}w`)
      .join(", ");
  const fallback = asset.endsWith("/mobile") ? 390 : photo ? 800 : 960;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={srcset("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcset("webp")} sizes={sizes} />
      <img
        src={`/marketing/home/${asset}-${fallback}.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </picture>
  );
}
