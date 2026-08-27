/**
 * useModalWidth — versão PORTÁVEL (sem dependência do AuthContext do projeto de origem).
 * ---------------------------------------------------------------------------
 * Original: src/hooks/useModalWidth.ts (usa `useAuth()` para escopar a chave do
 * localStorage por usuário). Aqui o id do usuário é um PARÂMETRO, para o hook
 * poder ser copiado para qualquer projeto.
 *
 * Zoom de largura de modal, persistido POR USUÁRIO e POR MODAL. A largura é uma
 * PORCENTAGEM da viewport e cada clique move `step` pontos (5% por padrão): o
 * ajuste é fino, sem os saltos de níveis discretos (max-w-3xl → max-w-5xl
 * pulava centenas de pixels de uma vez).
 *
 * A ALTURA fica automática (o modal cresce com o conteúdo até um teto), então
 * só a largura é controlada aqui.
 */
import { useState } from 'react';

interface UseModalWidthOptions {
  /** Largura inicial em % da viewport quando não há preferência salva. */
  defaultPercent?: number;
  /** Chave base do localStorage — escopada por usuário internamente. */
  storageKey?: string;
  /** Id do usuário logado (ou undefined). Escopa a chave: `chave:userId`. */
  userId?: string | null;
  /** Passo de cada clique, em pontos percentuais. Default 5. */
  step?: number;
  /** Limites da faixa, em % da viewport. */
  min?: number;
  max?: number;
}

const DEFAULT_MIN = 30;
const DEFAULT_MAX = 95;
const DEFAULT_STEP = 5;

export function useModalWidth({
  defaultPercent = 60,
  storageKey,
  userId,
  step = DEFAULT_STEP,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
}: UseModalWidthOptions) {
  const scopedKey = storageKey ? `${storageKey}:${userId ?? 'anon'}` : undefined;

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const [percent, setPercent] = useState(() => {
    const fallback = clamp(defaultPercent);
    if (!scopedKey || typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(scopedKey);
      if (raw == null) return fallback;
      const parsed = parseFloat(raw);
      return Number.isNaN(parsed) ? fallback : clamp(parsed);
    } catch {
      return fallback;
    }
  });

  const change = (next: number) => {
    const clamped = clamp(next);
    setPercent(clamped);
    if (scopedKey) {
      try {
        window.localStorage.setItem(scopedKey, String(clamped));
      } catch {
        // localStorage indisponível (modo privado) — ignora.
      }
    }
  };

  return {
    hasZoom: true,
    percent,
    /** Largura a aplicar no style do modal (vence o max-w das classes). */
    widthStyle: { width: `${percent}vw`, maxWidth: `${percent}vw` } as React.CSSProperties,
    canZoomOut: percent > min,
    canZoomIn: percent < max,
    zoomOut: () => change(percent - step),
    zoomIn: () => change(percent + step),
  };
}
