/** Espelha `CreativeBrandProfile` (`src/application/creative-engine/build-creative-context.ts`,
 * backend) — mesma forma. `null` (não `undefined`) quando o workspace não tem nenhum dado de
 * marca cadastrado ainda: nunca inventa um perfil vazio com campos zerados. */
export type BrandProfile = {
  brandName?: string;
  positioning?: string;
  businessDescription?: string;
  targetAudience?: string;
  productsOrServices?: string[];
  differentiators?: string[];
  toneOfVoice?: string;
  brandColors?: string[];
  visualIdentityNotes?: string;
};

/** Só os campos que a UI de "Editar perfil" desta etapa sabe escrever — os demais (produtos,
 * diferenciais, identidade visual) continuam só leitura até haver uma fonte real de edição. */
export type BrandProfilePatch = {
  positioning?: string;
  toneOfVoice?: string;
  businessDescription?: string;
  targetAudience?: string;
};
