/**
 * Composições de cena do motor de vídeo (filtros FFmpeg). Calculadas UMA vez por cena, na base em
 * supersampling; o movimento acontece depois (zoompan/overlay). Nada aqui altera cor nem conteúdo da
 * foto: a mídia só é escalada, recortada pelo foco e posicionada — fidelidade do produto preservada.
 *
 * Também devolve a área livre de cada composição (painel do `split`) para os textos irem para lá.
 */

import type { EditClip, EditLook, EditSceneLayout, VideoAspect } from "../../domain/video-editing/video-edit-plan.js";

const n = (value: number, digits = 4) => String(Math.round(value * 10 ** digits) / 10 ** digits);
const even = (value: number) => 2 * Math.round(value / 2);
const hex = (value: string) => `0x${value.slice(1).toUpperCase()}`;
const rgb = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];

export type Rect = { x: number; y: number; w: number; h: number };

/** Cor de fundo da marca escura demais para servir de cenário (vira "vazio preto"). */
function darkLook(look: EditLook): boolean {
  const [r, g, b] = rgb(look.backgroundHex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40;
}

/** Gradiente vertical da marca como fonte (sem entrada). */
function gradientSource(look: EditLook, cw: number, ch: number, label: string): string {
  const [r0, g0, b0] = rgb(look.backgroundHex);
  // Cor clara escurece pouco (senão vira cinza); cor escura ganha mais profundidade.
  const [lr, lg, lb] = rgb(look.backgroundHex);
  const factor = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb > 150 ? 0.88 : 0.72;
  const [r1, g1, b1] = rgb(look.backgroundHex).map((v) => Math.round(v * factor)) as [number, number, number];
  const channel = (a: number, b: number) => `'${a}+(${b - a})*Y/H'`;
  return `color=c=${hex(look.backgroundHex)}:s=${cw}x${ch}:d=1,format=rgb24,geq=r=${channel(r0, r1)}:g=${channel(g0, g1)}:b=${channel(b0, b1)}[${label}]`;
}

/** Máscara de cantos arredondados (alfa) para um stream do tamanho exato do retângulo. */
function roundedAlpha(radius: number, alpha = "255"): string {
  const r = n(radius, 1);
  return `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${alpha}*lte(hypot(max(0\\,abs(X-W/2)-(W/2-${r}))\\,max(0\\,abs(Y-H/2)-(H/2-${r})))\\,${r})'`;
}

/** Sombra suave de um retângulo arredondado, já posicionada sobre `under`. */
function shadow(rect: Rect, radius: number, blur: number, under: string, out: string, offset: number): string[] {
  const pad = Math.round(blur * 3);
  const w = even(rect.w + pad * 2);
  const h = even(rect.h + pad * 2);
  return [
    `color=c=black:s=${w}x${h}:d=1,format=rgba,geq=r=0:g=0:b=0:a='120*lte(hypot(max(0\\,abs(X-W/2)-(${n(rect.w / 2 - radius, 1)}))\\,max(0\\,abs(Y-H/2)-(${n(rect.h / 2 - radius, 1)})))\\,${n(radius, 1)})',gblur=sigma=${n(blur, 1)}[sh${out}]`,
    `[${under}][sh${out}]overlay=x=${Math.round(rect.x - pad)}:y=${Math.round(rect.y - pad + offset)}[${out}]`,
  ];
}

/** Retângulo que cabe a mídia (proporção `ratio` = w/h) dentro de `box`, centrado em (cx, cy). */
function fitRect(ratio: number, boxW: number, boxH: number, cx: number, cy: number): Rect {
  const w = Math.min(boxW, boxH * ratio);
  const h = w / ratio;
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: even(w), h: even(h) };
}

/** Área da foto e do painel no `split` (proporção do quadro). */
export function splitAreas(aspect: VideoAspect, W: number, H: number): { photo: Rect; panel: Rect } {
  if (aspect === "9:16") return { photo: { x: 0, y: 0, w: W, h: even(H * 0.6) }, panel: { x: 0, y: even(H * 0.6), w: W, h: H - even(H * 0.6) } };
  if (aspect === "1:1") return { photo: { x: 0, y: 0, w: even(W * 0.56), h: H }, panel: { x: even(W * 0.56), y: 0, w: W - even(W * 0.56), h: H } };
  return { photo: { x: W - even(W * 0.55), y: 0, w: even(W * 0.55), h: H }, panel: { x: 0, y: 0, w: W - even(W * 0.55), h: H } };
}

/** Onde os textos de uma cena podem ficar (em pixels do quadro final); `undefined` = quadro inteiro. */
export function textArea(layout: EditSceneLayout | undefined, aspect: VideoAspect, W: number, H: number): Rect | undefined {
  if (layout === "stage") return { x: 0, y: even(H * 0.68), w: W, h: even(H * 0.18) };
  return layout === "split" ? splitAreas(aspect, W, H).panel : undefined;
}

export type LayoutBase = {
  /** filter_complex que produz `[b]` (base) e, no parallax, `[f]` (primeiro plano RGBA no tamanho final). */
  chain: string;
  parallaxForeground: boolean;
};

/**
 * Base da cena a partir da imagem `[0:v]` (dimensões `iw`×`ih` conhecidas) num canvas cw×ch.
 * `ratio` = largura/altura da imagem original.
 */
export function layoutBase(layout: EditSceneLayout, clip: EditClip, look: EditLook, aspect: VideoAspect, cw: number, ch: number, ratio: number, W: number, H: number): LayoutBase {
  const s = cw / W;
  const radius = Math.round(0.03 * Math.min(cw, ch));
  const blur = Math.round(0.018 * Math.min(cw, ch));
  const shadowOffset = Math.round(0.012 * ch);
  const fx = clip.framing.focusX;
  const fy = clip.framing.focusY;
  const fillTo = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:x='(iw-ow)*${n(fx)}':y='(ih-oh)*${n(fy)}'`;

  if (layout === "framed") {
    const box = aspect === "9:16" ? [0.84, 0.6, 0.46] : aspect === "1:1" ? [0.72, 0.74, 0.48] : [0.46, 0.82, 0.5];
    const rect = fitRect(ratio, cw * box[0]!, ch * box[1]!, cw / 2, ch * box[2]!);
    return {
      parallaxForeground: false,
      chain: [
        // Marca escura: o fundo é a própria foto desfocada (profundidade) em vez de um vazio quase preto.
        ...(darkLook(look)
          ? [`[0:v]split=2[fsrc][fcard]`, `[fsrc]scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},scale=${even(cw / 24)}:${even(ch / 24)},gblur=sigma=10,scale=${cw}:${ch}:flags=bicubic,eq=brightness=-0.16:saturation=0.75,format=rgb24[bg]`]
          : [gradientSource(look, cw, ch, "bg")]),
        ...shadow(rect, radius, blur, "bg", "bgs", shadowOffset),
        `[${darkLook(look) ? "fcard" : "0:v"}]scale=${rect.w}:${rect.h}:flags=lanczos,format=rgba,${roundedAlpha(radius)}[card]`,
        `[bgs][card]overlay=x=${rect.x}:y=${rect.y},format=rgb24,setsar=1[b]`,
      ].join(";"),
    };
  }

  if (layout === "split") {
    const { photo, panel } = splitAreas(aspect, W, H);
    const P = { x: Math.round(photo.x * s), y: Math.round(photo.y * s), w: even(photo.w * s), h: even(photo.h * s) };
    const Q = { x: Math.round(panel.x * s), y: Math.round(panel.y * s), w: even(panel.w * s), h: even(panel.h * s) };
    const line = Math.max(4, Math.round(0.006 * Math.min(cw, ch)));
    const vertical = aspect === "9:16";
    return {
      parallaxForeground: false,
      chain: [
        clip.framing.fit === "fit" ? gradientSource(look, cw, ch, "bg") : `color=c=${hex(look.backgroundHex)}:s=${cw}x${ch}:d=1,format=rgb24[bg]`,
        // Captura de tela (enquadramento "fit") entra inteira, com margem, sobre a cor da marca; foto preenche.
        ...(clip.framing.fit === "fit"
          ? (() => {
              const m = Math.round(0.05 * Math.min(P.w, P.h));
              const r = fitRect(ratio, P.w - m * 2, P.h - m * 2, P.x + P.w / 2, P.y + P.h / 2);
              return [...shadow(r, radius * 0.6, blur, "bg", "bgs", shadowOffset), `[0:v]scale=${r.w}:${r.h}:flags=lanczos,format=rgba,${roundedAlpha(radius * 0.6)}[ph]`, `[bgs][ph]overlay=x=${r.x}:y=${r.y}[bp]`];
            })()
          : [`[0:v]${fillTo(P.w, P.h)},format=rgb24[ph]`, `[bg][ph]overlay=x=${P.x}:y=${P.y}[bp]`]),
        `color=c=${hex(look.accentHex)}:s=${vertical ? `${Q.w}x${line}` : `${line}x${Q.h}`}:d=1,format=rgb24[ln]`,
        `[bp][ln]overlay=x=${vertical ? Q.x : aspect === "1:1" ? Q.x : Q.x + Q.w - line}:y=${vertical ? Q.y : Q.y},setsar=1[b]`,
      ].join(";"),
    };
  }

  if (layout === "inset") {
    const d = even(0.42 * Math.min(cw, ch));
    const ring = Math.max(6, Math.round(0.008 * Math.min(cw, ch)));
    const zoom = 2.2;
    const cx = fy < 0.5 ? cw * 0.72 : cw * 0.72;
    const cy = fy < 0.5 ? ch * 0.7 : ch * 0.28;
    const x = Math.round(cx - d / 2);
    const y = Math.round(cy - d / 2);
    const src = even(d / zoom);
    return {
      parallaxForeground: false,
      chain: [
        `[0:v]${fillTo(cw, ch)},format=rgb24,split=2[full][zsrc]`,
        `[full]eq=brightness=-0.05[dim]`,
        `[zsrc]crop=${src}:${src}:x='max(0\\,min(iw-${src}\\,iw*${n(fx)}-${src / 2}))':y='max(0\\,min(ih-${src}\\,ih*${n(fy)}-${src / 2}))',scale=${d}:${d}:flags=lanczos,format=rgba,${roundedAlpha(d / 2)}[lens]`,
        `color=c=white:s=${d + ring * 2}x${d + ring * 2}:d=1,format=rgba,${roundedAlpha((d + ring * 2) / 2)}[ring]`,
        ...shadow({ x: x - ring, y: y - ring, w: d + ring * 2, h: d + ring * 2 }, (d + ring * 2) / 2, blur, "dim", "dims", shadowOffset),
        `[dims][ring]overlay=x=${x - ring}:y=${y - ring}[dr]`,
        `[dr][lens]overlay=x=${x}:y=${y},format=rgb24,setsar=1[b]`,
      ].join(";"),
    };
  }

  if (layout === "parallax" || layout === "stage") {
    // Fundo: a própria foto ampliada, desfocada e escurecida (vira campo de cor); primeiro plano: a foto
    // num cartão arredondado com sombra, já no tamanho final e com alfa, para o overlay em movimento.
    const box = aspect === "9:16" ? [0.88, 0.7, 0.5] : aspect === "1:1" ? [0.74, 0.76, 0.5] : [0.46, 0.82, 0.5];
    const stage = layout === "stage";
    const rect = stage ? fitRect(ratio, W * 0.9, H * 0.61, W / 2, H * 0.36)
      : fitRect(ratio, W * box[0]!, H * box[1]!, W / 2, H * box[2]!);
    const r1 = Math.round(0.03 * Math.min(W, H));
    const b1 = Math.round(0.018 * Math.min(W, H));
    const pad = b1 * 3;
    return {
      parallaxForeground: true,
      chain: [
        ...(stage ? [gradientSource(look, cw, ch, "b")] : [
          `[0:v]split=2[pa][pb]`,
          `[pa]scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},scale=${even(cw / 24)}:${even(ch / 24)},gblur=sigma=10,scale=${cw}:${ch}:flags=bicubic,eq=brightness=-0.12:saturation=0.8,format=rgb24,setsar=1[b]`,
        ]),
        `color=c=black@0.0:s=${W}x${H}:d=1,format=rgba[canvas]`,
        `color=c=black:s=${even(rect.w + pad * 2)}x${even(rect.h + pad * 2)}:d=1,format=rgba,geq=r=0:g=0:b=0:a='130*lte(hypot(max(0\\,abs(X-W/2)-(${n(rect.w / 2 - r1, 1)}))\\,max(0\\,abs(Y-H/2)-(${n(rect.h / 2 - r1, 1)})))\\,${r1})',gblur=sigma=${b1}[psh]`,
        `[canvas][psh]overlay=x=${rect.x - pad}:y=${rect.y - pad + Math.round(0.012 * H)}:format=auto[cs]`,
        `[${stage ? "0:v" : "pb"}]scale=${rect.w}:${rect.h}:flags=lanczos,format=rgba,${roundedAlpha(r1)}[pcard]`,
        `[cs][pcard]overlay=x=${rect.x}:y=${rect.y}:format=auto,format=rgba[f]`,
      ].join(";"),
    };
  }

  // device_phone / device_laptop: captura real dentro do aparelho desenhado.
  const phone = layout === "device_phone";
  const body: Rect = phone
    ? (() => {
        const h = ch * (aspect === "9:16" ? 0.74 : 0.84);
        const w = h * (9 / 19.5);
        return { x: Math.round(cw / 2 - w / 2), y: Math.round(ch * (aspect === "9:16" ? 0.47 : 0.5) - h / 2), w: even(w), h: even(h) };
      })()
    : (() => {
        const w = cw * (aspect === "16:9" ? 0.7 : aspect === "9:16" ? 0.86 : 0.88);
        const h = w / 1.6;
        return { x: Math.round(cw / 2 - w / 2), y: Math.round(ch * (aspect === "9:16" ? 0.52 : 0.46) - h / 2), w: even(w), h: even(h) };
      })();
  const bezel = Math.round(body.w * (phone ? 0.04 : 0.025));
  const bodyRadius = Math.round(body.w * (phone ? 0.14 : 0.03));
  const screen: Rect = { x: body.x + bezel, y: body.y + bezel, w: even(body.w - bezel * 2), h: even(body.h - bezel * 2 - (phone ? 0 : bezel)) };
  const screenRadius = Math.max(4, bodyRadius - bezel);
  const base = phone ? [] : [
    `color=c=0x3A3A40:s=${even(body.w * 1.14)}x${even(Math.max(8, body.h * 0.045))}:d=1,format=rgba,${roundedAlpha(Math.max(4, body.h * 0.0225))}[lb]`,
    `[dev][lb]overlay=x=${Math.round(body.x - body.w * 0.07)}:y=${body.y + body.h - 2}[dev2]`,
  ];
  return {
    parallaxForeground: false,
    chain: [
      gradientSource(look, cw, ch, "bg"),
      ...shadow(body, bodyRadius, blur * 1.4, "bg", "bgs", shadowOffset * 1.5),
      `color=c=0x0E0E10:s=${body.w}x${body.h}:d=1,format=rgba,${roundedAlpha(bodyRadius)}[shell]`,
      `[bgs][shell]overlay=x=${body.x}:y=${body.y}[dev0]`,
      `[0:v]${fillTo(screen.w, screen.h)},format=rgba,${roundedAlpha(screenRadius)}[scr]`,
      `[dev0][scr]overlay=x=${screen.x}:y=${screen.y}${phone ? "" : "[dev]"}${phone ? ",format=rgb24,setsar=1[b]" : ""}`,
      ...(phone ? [] : [...base, `[dev2]format=rgb24,setsar=1[b]`]),
    ].join(";"),
  };
}
