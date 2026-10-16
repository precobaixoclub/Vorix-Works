/**
 * Transcrição do Zoom (arquivo WebVTT das gravações em nuvem): cada bloco tem o intervalo e, em
 * geral, "Nome da pessoa: texto". Puro: sem I/O.
 */

export type ZoomTranscriptSegment = { startMs: number; endMs: number; text: string; speaker?: string };

// WebVTT aceita "HH:MM:SS.mmm" e também "MM:SS.mmm".
const TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;
const toMs = (value: string) => {
  const match = TIME.exec(value);
  if (!match) return undefined;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
};

export function parseZoomVtt(vtt: string): ZoomTranscriptSegment[] {
  const segments: ZoomTranscriptSegment[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex]!.split("-->");
    const startMs = toMs(rawStart ?? "");
    const endMs = toMs(rawEnd ?? "");
    if (startMs === undefined || endMs === undefined) continue;
    const body = lines.slice(timingIndex + 1).join(" ").trim();
    if (!body) continue;
    const speakerMatch = /^([^:]{1,80}):\s+(.+)$/.exec(body);
    segments.push({ startMs, endMs: Math.max(startMs, endMs), ...(speakerMatch ? { speaker: speakerMatch[1]!.trim(), text: speakerMatch[2]!.trim() } : { text: body }) });
  }
  return segments;
}
