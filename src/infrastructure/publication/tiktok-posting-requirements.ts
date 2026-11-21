/** TikTok's current account restrictions, fetched before rendering and again before dispatch. */
export const TIKTOK_PRIVACY_LEVELS = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type TikTokPrivacyLevel = typeof TIKTOK_PRIVACY_LEVELS[number];
export type TikTokCreatorInfo = {
  creatorNickname: string;
  creatorUsername: string;
  creatorAvatarUrl?: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

export class TikTokPostingError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

export function parseTikTokCreatorInfo(json: Record<string, unknown>): TikTokCreatorInfo {
  const data = json.data as Record<string, unknown> | undefined;
  const error = json.error as { code?: string } | undefined;
  if (error?.code !== "ok") {
    const code = error?.code ?? "TIKTOK_CREATOR_UNAVAILABLE";
    const messages: Record<string, string> = {
      spam_risk_too_many_posts: "Esta conta atingiu o limite de publicações do TikTok. Tente novamente mais tarde.",
      spam_risk_user_banned_from_posting: "O TikTok bloqueou temporariamente as publicações desta conta.",
      reached_active_user_cap: "O limite de contas publicando pelo aplicativo foi atingido. Tente mais tarde.",
      access_token_invalid: "A conexão com o TikTok expirou. Reconecte a conta em Integrações.",
      scope_not_authorized: "Reconecte sua conta TikTok e autorize a permissão de publicação.",
      rate_limit_exceeded: "O TikTok recebeu muitas consultas. Aguarde um momento e tente novamente.",
    };
    throw new TikTokPostingError(code, messages[code] ?? "Não foi possível consultar as permissões da conta TikTok. Tente novamente.", code === "rate_limit_exceeded" ? 429 : 409);
  }
  const options = Array.isArray(data?.privacy_level_options) ? data.privacy_level_options.filter((value): value is TikTokPrivacyLevel => TIKTOK_PRIVACY_LEVELS.includes(value as TikTokPrivacyLevel)) : [];
  if (!data || typeof data.creator_nickname !== "string" || !options.length ||
      [data.comment_disabled, data.duet_disabled, data.stitch_disabled].some(value => typeof value !== "boolean") ||
      typeof data.max_video_post_duration_sec !== "number" || data.max_video_post_duration_sec <= 0) {
    throw new TikTokPostingError("TIKTOK_CREATOR_UNAVAILABLE", "Não foi possível confirmar as permissões atuais da conta TikTok. Atualize e tente novamente.", 502);
  }
  return {
    creatorNickname: data.creator_nickname,
    creatorUsername: typeof data.creator_username === "string" ? data.creator_username : "",
    ...(typeof data.creator_avatar_url === "string" ? { creatorAvatarUrl: data.creator_avatar_url } : {}),
    privacyLevelOptions: options,
    commentDisabled: data.comment_disabled as boolean,
    duetDisabled: data.duet_disabled as boolean,
    stitchDisabled: data.stitch_disabled as boolean,
    maxVideoPostDurationSec: data.max_video_post_duration_sec,
  };
}

export type TikTokPostChoices = {
  privacyLevel?: string;
  musicUsageAccepted?: boolean;
  commercialContent?: boolean;
  brandOrganic?: boolean;
  brandContent?: boolean;
  videoUrl?: string;
  videoDurationSec?: number;
};

/** Fail closed: no public default, no inferred agreement, including scheduled/other entry points. */
export function validateTikTokPostChoices(post: TikTokPostChoices, creator?: TikTokCreatorInfo): void {
  if (!post.privacyLevel || !TIKTOK_PRIVACY_LEVELS.includes(post.privacyLevel as TikTokPrivacyLevel)) throw new TikTokPostingError("TIKTOK_PRIVACY_REQUIRED", "Escolha quem pode ver esta publicação no TikTok.");
  if (creator && !creator.privacyLevelOptions.includes(post.privacyLevel as TikTokPrivacyLevel)) throw new TikTokPostingError("privacy_level_option_mismatch", "A privacidade escolhida não está disponível nesta conta TikTok. Atualize as opções.");
  if (post.musicUsageAccepted !== true) throw new TikTokPostingError("TIKTOK_MUSIC_CONSENT_REQUIRED", "Confirme os termos de uso de músicas do TikTok antes de publicar.");
  if (post.commercialContent && !post.brandOrganic && !post.brandContent) throw new TikTokPostingError("TIKTOK_DISCLOSURE_REQUIRED", "Informe se o conteúdo promove sua marca, outra marca ou ambas.");
  if (!post.commercialContent && (post.brandOrganic || post.brandContent)) throw new TikTokPostingError("TIKTOK_DISCLOSURE_REQUIRED", "Ative a identificação de conteúdo comercial para informar a marca.");
  if (post.brandContent && post.privacyLevel === "SELF_ONLY") throw new TikTokPostingError("TIKTOK_BRANDED_PRIVATE", "Parcerias com outras marcas não podem usar a visibilidade “Só eu”.");
  if (post.videoUrl) {
    if (!Number.isFinite(post.videoDurationSec) || (post.videoDurationSec ?? 0) <= 0) throw new TikTokPostingError("TIKTOK_VIDEO_DURATION_REQUIRED", "Não foi possível verificar a duração do vídeo. Envie o arquivo novamente.");
    if (creator && post.videoDurationSec! > creator.maxVideoPostDurationSec) throw new TikTokPostingError("TIKTOK_VIDEO_TOO_LONG", `Esta conta TikTok permite vídeos de até ${creator.maxVideoPostDurationSec} segundos.`);
  }
}
