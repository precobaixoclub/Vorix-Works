import type { MediaProviderPort, MediaProviderSearchHit } from "../../application/ports/media-provider.port.js";
import type { ShotIntent } from "../../shared/utils/shot-intent.js";
import type { MicroShot } from "../../shared/utils/scene-composition/microshot.model.js";
import { expandQueries, type RankedQuery } from "../../shared/utils/scene-composition/query-expansion.js";
import { rankCandidatesByShotIntent, type ScoredCandidate } from "../footage-acquisition/shot-intent-requirements.js";
import type { RejectionHistoryEntry } from "../footage-acquisition/rejection-history.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — MULTI-ASSET RETRIEVAL (seção 4 da sprint). "Ao invés de
 * buscar um asset. Buscar vários candidatos." Reaproveita `rankCandidatesByShotIntent` (já existe,
 * já devolve um array ordenado inteiro, nunca só o vencedor — `media-acquisition.ts` é quem hoje
 * descarta tudo depois do primeiro `break`, não esta função de ranking) — a novidade real aqui é
 * rodar VÁRIAS consultas (Query Expansion) por MICROPLANO (não por Shot inteiro) e devolver a
 * lista ranqueada completa de cada um, sem cortar para 1.
 */

const MAX_QUERIES_PER_MICROSHOT = 5;

export type MicroShotCandidates = {
  microShotId: string;
  queries: RankedQuery[];
  candidates: ScoredCandidate[];
};

function mediaTypeFor(intent: ShotIntent, microShot: MicroShot): "photo" | "video" {
  if (intent.assetType === "video" || intent.assetType === "b_roll" || intent.assetType === "cinemagraph") return "video";
  return microShot.preferredCamera === "screen" ? "video" : "photo";
}

export async function retrieveCandidatesForMicroShot(input: {
  microShot: MicroShot;
  intent: ShotIntent;
  provider: MediaProviderPort;
  usedAuthors: Set<string>;
  rejectionHistory?: RejectionHistoryEntry[];
  candidatesPerQuery?: number;
}): Promise<MicroShotCandidates> {
  const { microShot, intent, provider, usedAuthors, rejectionHistory } = input;
  const queries = expandQueries(microShot, intent).slice(0, MAX_QUERIES_PER_MICROSHOT);
  const candidatesPerQuery = input.candidatesPerQuery ?? 8;

  const hitsByExternalId = new Map<string, MediaProviderSearchHit>();
  for (const query of queries) {
    const type = mediaTypeFor(intent, microShot);
    const hits = await provider.search({ text: query.text, type, limit: candidatesPerQuery, shotId: microShot.parentShot });
    for (const hit of hits) hitsByExternalId.set(hit.externalId, hit);
  }

  const candidates = rankCandidatesByShotIntent([...hitsByExternalId.values()], intent, usedAuthors, rejectionHistory ?? []);
  return { microShotId: microShot.id, queries, candidates };
}

export async function retrieveCandidatesForAllMicroShots(input: {
  microShots: MicroShot[];
  intent: ShotIntent;
  provider: MediaProviderPort;
  usedAuthors: Set<string>;
  rejectionHistory?: RejectionHistoryEntry[];
  candidatesPerQuery?: number;
}): Promise<MicroShotCandidates[]> {
  const results: MicroShotCandidates[] = [];
  for (const microShot of input.microShots) {
    results.push(await retrieveCandidatesForMicroShot({ ...input, microShot }));
  }
  return results;
}
