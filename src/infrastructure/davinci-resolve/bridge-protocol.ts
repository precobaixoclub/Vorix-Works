/**
 * Protocolo da ponte Vorix ↔ DaVinci Resolve (`lua/VorixBridge.lua`).
 *
 * A ponte só conhece as operações abaixo, com argumentos tipados. Não existe operação "executar
 * código": nenhum Lua, Python, comando de sistema ou caminho chega à ponte vindo do pedido do
 * usuário. Mídia é referenciada por `jobId` + nome de arquivo simples, e a própria ponte monta o
 * caminho dentro da raiz de jobs que foi gravada nela na instalação.
 *
 * Esta validação roda dos dois lados: aqui antes de enviar e de novo dentro da ponte Lua.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

export type Keyframe = { f: number; v: number };

export type StyleClipArgs = {
  ref: string;
  durationFrames: number;
  /** Movimento relativo (Fusion Transform): escala e deslocamento do centro (0.5 = centro). */
  size?: Keyframe[];
  centerX?: Keyframe[];
  centerY?: Keyframe[];
  /** Opacidade do clipe (0–1) para transições com sobreposição. */
  alpha?: Keyframe[];
  /** Escurecimento para preto (0 = normal, 1 = preto) para dip to black. */
  dip?: Keyframe[];
};

export type TextLayerArgs = {
  text: string;
  /** Altura da fonte como fração da altura do quadro. */
  size: number;
  colorHex: string;
  bandHex?: string;
  bold: boolean;
  fontFamily: string;
  /** Centro do texto em coordenadas normalizadas (0–1, y para cima como no Fusion). */
  x: number;
  y: number;
  /** Largura máxima do bloco como fração da largura (quebra de linha feita antes de enviar). */
  bandHeight: number;
  alpha: Keyframe[];
  dy?: Keyframe[];
  scale?: Keyframe[];
};

export type BuildTextLayerArgs = { ref: string; durationFrames: number; layers: TextLayerArgs[] };

export type BridgeOperation =
  | { op: "ping"; args: Record<string, never> }
  | { op: "create_project"; args: { name: string; width: number; height: number; fps: number } }
  | { op: "import_media"; args: { jobId: string; files: string[] } }
  | { op: "create_timeline"; args: { name: string } }
  | { op: "add_track"; args: { type: "video" | "audio" } }
  | { op: "append_clip"; args: { ref: string; jobId: string; fileName: string; startFrame: number; endFrame: number; trackIndex: number; recordFrame: number; mediaType: 1 | 2 } }
  | { op: "set_clip_properties"; args: { ref: string; props: Partial<Record<ClipPropertyKey, number>> } }
  | { op: "style_clip"; args: StyleClipArgs }
  | { op: "build_text_layer"; args: BuildTextLayerArgs }
  | { op: "set_render"; args: { jobId: string; fileName: string; width: number; height: number; fps: number } }
  | { op: "start_render"; args: Record<string, never> }
  | { op: "render_status"; args: { renderJobId: string } }
  | { op: "stop_render"; args: Record<string, never> }
  | { op: "save_project"; args: Record<string, never> }
  | { op: "close_project"; args: Record<string, never> }
  | { op: "stop_bridge"; args: Record<string, never> };

export type BridgeOpName = BridgeOperation["op"];

export const BRIDGE_OPS: readonly BridgeOpName[] = [
  "ping",
  "create_project",
  "import_media",
  "create_timeline",
  "add_track",
  "append_clip",
  "set_clip_properties",
  "style_clip",
  "build_text_layer",
  "set_render",
  "start_render",
  "render_status",
  "stop_render",
  "save_project",
  "close_project",
  "stop_bridge",
];

/** Propriedades de clipe que a ponte aceita ajustar (TimelineItem:SetProperty). */
export const CLIP_PROPERTY_LIMITS = {
  ZoomX: [0.1, 10],
  ZoomY: [0.1, 10],
  Pan: [-8000, 8000],
  Tilt: [-8000, 8000],
  Opacity: [0, 100],
} as const;
export type ClipPropertyKey = keyof typeof CLIP_PROPERTY_LIMITS;

export type BridgeRequest = { v: typeof BRIDGE_PROTOCOL_VERSION; id: string; op: BridgeOpName; args: unknown };
export type BridgeResponse = { v: number; id: string; ok: boolean; result?: Record<string, unknown>; error?: string };

export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp|wav|mp3|m4a|aac)$/i;
const OUTPUT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const FONT = /^[A-Za-z0-9 ._-]{1,48}$/;
const MAX_FRAMES = 60 * 60 * 3;
const MAX_KEYFRAMES = 64;
const MAX_TEXT_LAYERS = 80;

export class BridgeArgumentError extends Error {
  constructor(op: string, message: string) {
    super(`Operação ${op} recusada: ${message}`);
    this.name = "BridgeArgumentError";
  }
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function isNum(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function onlyKeys(op: string, args: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new BridgeArgumentError(op, `campo não permitido "${key}"`);
}
function keyframes(op: string, name: string, value: unknown, min: number, max: number, maxFrame: number): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KEYFRAMES) throw new BridgeArgumentError(op, `${name} inválido`);
  let last = -1;
  for (const kf of value) {
    if (!kf || typeof kf !== "object") throw new BridgeArgumentError(op, `${name} inválido`);
    const { f, v } = kf as Keyframe;
    if (!isInt(f, 0, maxFrame) || f <= last || !isNum(v, min, max)) throw new BridgeArgumentError(op, `${name} com quadro/valor fora do limite`);
    last = f;
  }
}

/** Valida uma operação antes de enviá-la. Lança `BridgeArgumentError` ao primeiro problema. */
export function assertValidOperation(operation: BridgeOperation): void {
  const { op } = operation;
  if (!BRIDGE_OPS.includes(op)) throw new BridgeArgumentError(String(op), "operação desconhecida");
  const args = (operation.args ?? {}) as Record<string, unknown>;
  if (typeof args !== "object" || Array.isArray(args)) throw new BridgeArgumentError(op, "argumentos inválidos");
  switch (op) {
    case "ping":
    case "start_render":
    case "stop_render":
    case "save_project":
    case "close_project":
    case "stop_bridge":
      onlyKeys(op, args, []);
      return;
    case "create_project":
      onlyKeys(op, args, ["name", "width", "height", "fps"]);
      if (!NAME_PATTERN.test(String(args.name))) throw new BridgeArgumentError(op, "nome inválido");
      if (!isInt(args.width, 16, 3840) || !isInt(args.height, 16, 3840) || !isInt(args.fps, 1, 60)) throw new BridgeArgumentError(op, "formato fora do limite do DaVinci gratuito");
      return;
    case "import_media":
      onlyKeys(op, args, ["jobId", "files"]);
      if (!JOB_ID_PATTERN.test(String(args.jobId))) throw new BridgeArgumentError(op, "job inválido");
      if (!Array.isArray(args.files) || args.files.length === 0 || args.files.length > 120 || !args.files.every((file) => typeof file === "string" && FILE_PATTERN.test(file) && !file.includes(".."))) throw new BridgeArgumentError(op, "lista de arquivos inválida");
      return;
    case "create_timeline":
      onlyKeys(op, args, ["name"]);
      if (!NAME_PATTERN.test(String(args.name))) throw new BridgeArgumentError(op, "nome inválido");
      return;
    case "add_track":
      onlyKeys(op, args, ["type"]);
      if (args.type !== "video" && args.type !== "audio") throw new BridgeArgumentError(op, "tipo de trilha inválido");
      return;
    case "append_clip":
      onlyKeys(op, args, ["ref", "jobId", "fileName", "startFrame", "endFrame", "trackIndex", "recordFrame", "mediaType"]);
      if (!REF_PATTERN.test(String(args.ref)) || !JOB_ID_PATTERN.test(String(args.jobId)) || !FILE_PATTERN.test(String(args.fileName))) throw new BridgeArgumentError(op, "referência inválida");
      if (!isInt(args.startFrame, 0, MAX_FRAMES * 10) || !isInt(args.endFrame, 0, MAX_FRAMES * 10) || (args.endFrame as number) <= (args.startFrame as number)) throw new BridgeArgumentError(op, "intervalo de quadros inválido");
      if (!isInt(args.trackIndex, 1, 8) || !isInt(args.recordFrame, 0, MAX_FRAMES) || (args.mediaType !== 1 && args.mediaType !== 2)) throw new BridgeArgumentError(op, "posição inválida");
      return;
    case "set_clip_properties": {
      onlyKeys(op, args, ["ref", "props"]);
      if (!REF_PATTERN.test(String(args.ref))) throw new BridgeArgumentError(op, "referência inválida");
      const props = args.props as Record<string, unknown>;
      if (!props || typeof props !== "object" || Object.keys(props).length === 0) throw new BridgeArgumentError(op, "sem propriedades");
      for (const [key, value] of Object.entries(props)) {
        const limits = CLIP_PROPERTY_LIMITS[key as ClipPropertyKey];
        if (!limits) throw new BridgeArgumentError(op, `propriedade não permitida "${key}"`);
        if (!isNum(value, limits[0], limits[1])) throw new BridgeArgumentError(op, `${key} fora do limite`);
      }
      return;
    }
    case "style_clip": {
      onlyKeys(op, args, ["ref", "durationFrames", "size", "centerX", "centerY", "alpha", "dip"]);
      if (!REF_PATTERN.test(String(args.ref)) || !isInt(args.durationFrames, 1, MAX_FRAMES)) throw new BridgeArgumentError(op, "referência inválida");
      const max = args.durationFrames as number;
      keyframes(op, "size", args.size, 0.2, 4, max);
      keyframes(op, "centerX", args.centerX, -1.5, 2.5, max);
      keyframes(op, "centerY", args.centerY, -1.5, 2.5, max);
      keyframes(op, "alpha", args.alpha, 0, 1, max);
      keyframes(op, "dip", args.dip, 0, 1, max);
      return;
    }
    case "build_text_layer": {
      onlyKeys(op, args, ["ref", "durationFrames", "layers"]);
      if (!REF_PATTERN.test(String(args.ref)) || !isInt(args.durationFrames, 1, MAX_FRAMES)) throw new BridgeArgumentError(op, "referência inválida");
      const max = args.durationFrames as number;
      if (!Array.isArray(args.layers) || args.layers.length === 0 || args.layers.length > MAX_TEXT_LAYERS) throw new BridgeArgumentError(op, "camadas de texto inválidas");
      for (const layer of args.layers as TextLayerArgs[]) {
        onlyKeys(op, layer as unknown as Record<string, unknown>, ["text", "size", "colorHex", "bandHex", "bold", "fontFamily", "x", "y", "bandHeight", "alpha", "dy", "scale"]);
        if (typeof layer.text !== "string" || layer.text.length === 0 || layer.text.length > 200 || /[\u0000-\u0009\u000B-\u001F\u007F]/.test(layer.text)) throw new BridgeArgumentError(op, "texto inválido");
        if (!isNum(layer.size, 0.01, 0.2) || !HEX.test(layer.colorHex) || (layer.bandHex !== undefined && !HEX.test(layer.bandHex)) || typeof layer.bold !== "boolean" || !FONT.test(layer.fontFamily)) throw new BridgeArgumentError(op, "estilo inválido");
        if (!isNum(layer.x, 0, 1) || !isNum(layer.y, 0, 1) || !isNum(layer.bandHeight, 0, 1)) throw new BridgeArgumentError(op, "posição inválida");
        keyframes(op, "alpha", layer.alpha, 0, 1, max);
        if (layer.alpha === undefined) throw new BridgeArgumentError(op, "texto sem janela de tempo");
        keyframes(op, "dy", layer.dy, -0.5, 0.5, max);
        keyframes(op, "scale", layer.scale, 0.2, 3, max);
      }
      return;
    }
    case "set_render":
      onlyKeys(op, args, ["jobId", "fileName", "width", "height", "fps"]);
      if (!JOB_ID_PATTERN.test(String(args.jobId)) || !OUTPUT_FILE_PATTERN.test(String(args.fileName))) throw new BridgeArgumentError(op, "destino inválido");
      if (!isInt(args.width, 16, 3840) || !isInt(args.height, 16, 3840) || !isInt(args.fps, 1, 60)) throw new BridgeArgumentError(op, "formato fora do limite do DaVinci gratuito");
      return;
    case "render_status":
      onlyKeys(op, args, ["renderJobId"]);
      if (typeof args.renderJobId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(args.renderJobId)) throw new BridgeArgumentError(op, "id de render inválido");
      return;
  }
}
