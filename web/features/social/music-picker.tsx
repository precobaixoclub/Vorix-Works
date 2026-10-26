"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { searchSocialMusic } from "./api";
import type { SocialMusicSelection, SocialMusicTrack, SocialPostFormat } from "./types";

export function SocialMusicPicker({ workspaceId, accountId, format, segment, value, onChange }: { workspaceId: string; accountId: string; format: SocialPostFormat; segment: boolean; value?: SocialMusicSelection; onChange: (value?: SocialMusicSelection) => void }) {
  const [query, setQuery] = useState(""); const [tracks, setTracks] = useState<SocialMusicTrack[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function search() {
    if (!query.trim()) return;
    setBusy(true); setError("");
    try { const result = await searchSocialMusic(workspaceId, accountId, format, query); setTracks(result.tracks); if (!result.tracks.length) setError("Nenhuma música disponível para esta busca."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível buscar músicas."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-lg border p-3">
    <p className="text-sm font-medium">Adicionar música</p>
    <p className="text-xs text-muted-foreground">Músicas disponíveis para esta conta e formato. A disponibilidade pode variar por país e direitos.</p>
    <div className="flex gap-2"><Input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} aria-label="Pesquisar músicas disponíveis" /><Button variant="secondary" disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? "Buscando…" : "Pesquisar"}</Button></div>
    {error ? <p role="status" className="text-sm text-muted-foreground">{error}</p> : null}
    <ul className="max-h-64 space-y-2 overflow-auto">{tracks.map(track => <li key={track.musicId} className="flex items-center gap-2">
      {track.coverUrl ? <img src={track.coverUrl} alt="" className="h-10 w-10 rounded object-cover" /> : null}
      <div className="min-w-0 flex-1"><p className="truncate text-sm">{track.title}</p><p className="text-xs text-muted-foreground">{track.artist}</p>{track.previewUrl ? <audio controls preload="none" src={track.previewUrl} aria-label={`Ouvir ${track.title}`} className="h-8 max-w-full" /> : null}</div>
      <Button size="sm" variant="secondary" onClick={() => onChange({ musicId: track.musicId, title: track.title, artist: track.artist, coverUrl: track.coverUrl, durationSec: track.durationSec })}>{value?.musicId === track.musicId ? "Selecionada" : "Selecionar"}</Button>
    </li>)}</ul>
    {value ? <div className="space-y-2 text-sm"><p>{value.title}{value.artist ? ` · ${value.artist}` : ""}</p>{segment && tracks.find(track => track.musicId === value.musicId)?.supportsSegment ? <div className="flex gap-2"><label>Início (s)<Input type="number" min={0} max={value.durationSec} value={value.segmentStartSec ?? 0} onChange={event => onChange({ ...value, segmentStartSec: Math.max(0, Number(event.target.value)) })} /></label><label>Duração (s)<Input type="number" min={1} max={90} value={value.segmentDurationSec ?? 15} onChange={event => onChange({ ...value, segmentDurationSec: Math.max(1, Math.min(90, Number(event.target.value))) })} /></label></div> : null}<Button size="sm" variant="secondary" onClick={() => onChange(undefined)}>Remover música</Button></div> : null}
  </div>;
}
