import { buildBaselineScript } from '../dist/skills/bruno-video-script/index.js';
import { computeShotDiversityReport } from '../dist/shared/utils/cinematic-reference-library.js';

const context = {
  records: [],
  modules: {
    BrandContext: [{ id: 'b1', module: 'BrandContext', clientId: 'rumo', title: 'Brand', status: 'active', currentVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', payload: { clientId: 'rumo', brandName: 'Rumo ao Altar', promise: 'Casamentos organizados.', toneOfVoice: 'leve divertido persuasivo' }, versions: [], history: [], tags: [] }],
    AudienceContext: [{ id: 'a1', module: 'AudienceContext', clientId: 'rumo', title: 'Audience', status: 'active', currentVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', payload: { clientId: 'rumo', targetAudience: 'Noivos e convidados' }, versions: [], history: [], tags: [] }],
    ContentContext: [],
    PublishingContext: [],
  }
};

const input = {
  clientId: 'rumo',
  originalRequest: 'Todo casamento merece um lugar oficial. Mostre RSVP, lista de presentes, álbum colaborativo, cronograma e informações para convidados. Produto: https://rumoaoaltar.com.br',
  joaoStrategy: {
    overallStrategy: 'Consciência de site oficial de casamento',
    objective: 'Seu casamento merece um site oficial.',
    targetAudience: 'Noivos e convidados de casamento',
    channel: 'instagram',
    format: 'reels',
    toneOfVoice: 'leve divertido persuasivo wedding',
    angle: 'identificacao',
    centralPromise: 'Seu casamento merece um site oficial.',
    valueProposition: 'Tudo organizado em um único lugar para noivos e convidados.',
    keyMessages: ['RSVP organizado.', 'Lista de presentes.', 'Álbum colaborativo.', 'Cronograma e informações.'],
    recommendedCta: 'Conheça o Rumo ao Altar',
  },
  channel: 'instagram',
  format: 'reels',
  videoObjective: 'Convencer noivos a criarem um site oficial do casamento',
  desiredDurationSeconds: 30,
};

const script = buildBaselineScript(input, context);
const shots = script.scenes.flatMap((s) => s.shots);
const report = computeShotDiversityReport(shots);

const mediaCounts = {};
for (const s of shots) {
  const k = s.assetRequirement.preferredMediaKind;
  mediaCounts[k] = (mediaCounts[k] || 0) + 1;
}
const purposeCounts = {};
for (const s of shots) {
  purposeCounts[s.purpose] = (purposeCounts[s.purpose] || 0) + 1;
}

console.log('=== VALIDAÇÃO REAL — AGENCY FILM PIPELINE 2.0 ===');
console.log('Prompt: "Todo casamento merece um lugar oficial." — produto: https://rumoaoaltar.com.br');
console.log('');
console.log('CENAS:', script.scenes.length);
for (const scene of script.scenes) {
  console.log(`  Cena ${scene.order} (${scene.name}, ${scene.durationSeconds}s) — ${scene.shots.length} shot(s):`);
  for (const shot of scene.shots) {
    console.log(`    Shot ${shot.order} [${shot.purpose}] ${shot.durationSeconds}s — ${shot.cinematography.shotType} | motion: ${shot.motion.action} | asset: ${shot.assetRequirement.preferredMediaKind}`);
  }
}
console.log('');
console.log('=== MÉTRICAS DE SHOTS ===');
console.log('Total de Shots:', report.totalShots);
console.log('Tipos de plano distintos:', report.distinctShotTypes);
console.log('Propósitos distintos:', report.distinctPurposes);
console.log('Ações de motion distintas:', report.distinctMotionActions);
console.log('Entradas distintas:', report.distinctEntrances);
console.log('Transições distintas:', report.distinctTransitions);
console.log('Runs de shotType repetido (>=2 consecutivos):', report.repeatedShotTypeRuns.length);
console.log('Shots com aparência slideshow:', report.slideshowLikeShots.length, `(${Math.round(report.slideshowLikeRatio * 100)}%)`);
console.log('');
console.log('=== DIVERSIDADE DE MÍDIA ===');
console.log('Kinds distintos:', Object.keys(mediaCounts).length);
console.log('Contagem por kind:', JSON.stringify(mediaCounts));
console.log('');
console.log('=== DIVERSIDADE NARRATIVA ===');
console.log('Contagem por propósito:', JSON.stringify(purposeCounts));
