/**
 * Lógica pura do navegador remoto de login (sem DOM): o que vai para o recorder a cada tecla, como
 * ler o frame recebido e para onde o WebSocket conecta. Nada aqui guarda o que é digitado.
 */

/** Teclas repassadas por nome; o resto vira texto. */
export const SPECIAL_KEYS: ReadonlySet<string> = new Set(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Shift"]);

export type ViewerKeyMessage = { t: "key"; a: "down" | "up"; key: string } | { t: "text"; v: string };

/** Tecla pressionada → mensagem (ou nada: atalhos com Ctrl/⌘ ficam no navegador local; colar é à parte). */
export function keyDownMessage(event: { key: string; ctrlKey?: boolean; metaKey?: boolean }): ViewerKeyMessage | undefined {
  if (event.ctrlKey || event.metaKey) return undefined;
  if (SPECIAL_KEYS.has(event.key)) return { t: "key", a: "down", key: event.key };
  if (event.key.length === 1) return { t: "text", v: event.key };
  return undefined;
}

export function keyUpMessage(event: { key: string }): ViewerKeyMessage | undefined {
  return SPECIAL_KEYS.has(event.key) ? { t: "key", a: "up", key: event.key } : undefined;
}

/** Colar: texto limitado (o recorder recusa mais que isso). */
export function pasteMessage(text: string): ViewerKeyMessage | undefined {
  const value = text.slice(0, 512);
  return value ? { t: "text", v: value } : undefined;
}

/** Frame binário = 4 bytes (largura, altura; uint16 big-endian) + JPEG. */
export function parseFrame(buffer: ArrayBuffer): { width: number; height: number; jpeg: ArrayBuffer } | undefined {
  if (buffer.byteLength <= 4) return undefined;
  const view = new DataView(buffer);
  return { width: view.getUint16(0), height: view.getUint16(2), jpeg: buffer.slice(4) };
}

export function streamUrl(apiBaseUrl: string, streamPath: string): string {
  return `${apiBaseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}${streamPath}`;
}
