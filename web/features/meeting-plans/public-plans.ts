/**
 * Dados públicos dos planos de gravação (página /produtos/meetings/planos). Espelham o catálogo do
 * backend (`src/domain/meetings/meeting-plans.model.ts`) — `tests/meeting-plans.test.mjs` falha se
 * os dois divergirem.
 */

/** A produção grava hoje só o ÁUDIO (MEETINGS_RECORDER_CAPTURE_VIDEO=false). Ligar a captura de
 * vídeo é uma decisão de custo (ver a análise financeira) — só então o texto pode falar em "tela". */
export const SCREEN_CAPTURE_ENABLED = false;

export const PUBLIC_MEETING_TRIAL = { days: 7, hours: 5 } as const;

export const PUBLIC_MEETING_PLANS = [
  { code: "individual", name: "Individual", price: "R$ 19,90", hours: 20, retentionDays: 90, concurrent: 1, shared: false, description: "Para quem grava as próprias reuniões." },
  { code: "professional", name: "Profissional", price: "R$ 39,90", hours: 60, retentionDays: 180, concurrent: 1, shared: false, description: "Mais horas e retenção maior para uma rotina intensa de reuniões." },
  { code: "teams", name: "Equipes", price: "R$ 79,90", hours: 150, retentionDays: 365, concurrent: 2, shared: true, description: "Horas compartilhadas pela equipe, com as permissões do Vorix." },
] as const;

export const PUBLIC_MEETING_RULES = { exportWindowDays: 30, noticeDays: [15, 3], maxRecordingHours: 4 } as const;
