import type {
  MotionDesignRequestInput,
  MotionFormat,
  MotionPlan,
  MotionRhythm,
  MotionSourceImage,
  MotionStoryboardBeat,
  MotionVisualIdentity,
} from "../../shared/utils/motion-design/motion-design.types.js";

// Re-exportados por conveniência para quem consome só a Skill (ex.: futuro Render Engine) sem
// precisar importar diretamente de `shared/utils/motion-design` — mesmo padrão de outras Skills
// que reexportam tipos de shared libraries usados na sua própria assinatura pública.
export type { MotionFormat, MotionRhythm, MotionSourceImage, MotionStoryboardBeat, MotionVisualIdentity, MotionPlan };

/**
 * Entrada pública da Skill Motion Design Engine — corresponde 1:1 às "Entradas" descritas no
 * briefing da sprint: imagens geradas, duração da campanha, formato, storyboard, identidade
 * visual e ritmo desejado. `clientId`/`tenantId` são opcionais e existem apenas para
 * rastreabilidade em log/eventos — esta Skill não consulta Clara nem Valentina: identidade visual
 * e ritmo chegam diretamente na entrada, exatamente como o briefing pediu.
 */
export type MotionDesignEngineRequestInput = MotionDesignRequestInput & {
  clientId?: string;
  tenantId?: string;
};

/**
 * Saída pública da Skill — o Motion Plan completo (com strategy, scenes, metadata e validation já
 * embutidos, ver `MotionPlan`) mais um resumo de alto nível para quem só quer o essencial sem
 * percorrer o plano inteiro.
 */
export type MotionDesignEngineOutput = {
  motionPlan: MotionPlan;
  summary: {
    presetUsed: string;
    presetConfidence: "low" | "medium" | "high";
    totalScenes: number;
    totalDurationSeconds: number;
    valid: boolean;
    errorCount: number;
    warningCount: number;
  };
};
