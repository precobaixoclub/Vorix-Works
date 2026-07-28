import React from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame } from "remotion";

// MotionSceneRenderer — o único lugar do projeto que conhece a API do Remotion. Recebe apenas
// números já resolvidos (curvas de escala/translação/opacidade, frames de início/duração) — nunca
// nomes de preset ou vocabulário semântico. Toda a decisão de "o que cada preset significa em
// números" já aconteceu em `shared/utils/motion-rendering/motion-animation-parameters.ts`
// (TypeScript, testável, sem nenhuma dependência de Remotion) antes deste componente existir.

const EASING_FN = {
  linear: (t) => t,
  ease_in: (t) => t * t,
  ease_out: (t) => 1 - (1 - t) * (1 - t),
  ease_in_out: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

function withEasing(frame, from, to, durationInFrames, easing) {
  const fn = EASING_FN[easing] || EASING_FN.linear;
  if (durationInFrames <= 0) return to;
  const t = Math.max(0, Math.min(1, frame / durationInFrames));
  return from + (to - from) * fn(t);
}

function SceneLayer({ scene }) {
  const { durationInFrames, imageAbsolutePath, resolvedAnimation } = scene;

  return (
    <AbsoluteFill>
      <BackgroundLayer durationInFrames={durationInFrames} imageAbsolutePath={imageAbsolutePath} params={resolvedAnimation.background} />
      <EdgeOpacity durationInFrames={durationInFrames} entrance={resolvedAnimation.entrance} exit={resolvedAnimation.exit}>
        {scene.textOverlay ? <TextOverlay text={scene.textOverlay} subtitle={scene.subtitle} durationInFrames={durationInFrames} params={resolvedAnimation.text} /> : null}
        {scene.hasIcon ? <IconMark durationInFrames={durationInFrames} params={resolvedAnimation.icon} /> : null}
        {scene.hasCta ? <CtaMark durationInFrames={durationInFrames} params={resolvedAnimation.cta} /> : null}
      </EdgeOpacity>
    </AbsoluteFill>
  );
}

function BackgroundLayer({ durationInFrames, imageAbsolutePath, params }) {
  const frame = useFrameSafe();
  const scale = withEasing(frame, params.scale.from, params.scale.to, durationInFrames, params.scale.easing);
  const translateX = withEasing(frame, params.translate.fromXPercent, params.translate.toXPercent, durationInFrames, params.translate.easing);
  const translateY = withEasing(frame, params.translate.fromYPercent, params.translate.toYPercent, durationInFrames, params.translate.easing);
  const blur = params.blur ? withEasing(frame, params.blur.fromPx, params.blur.toPx, durationInFrames, params.blur.easing) : 0;

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
      }}
    >
      <Img src={imageAbsolutePath} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  );
}

function EdgeOpacity({ durationInFrames, entrance, exit, children }) {
  const frame = useFrameSafe();
  const entranceOpacity = entrance.cut ? 1 : withEasing(frame, entrance.opacity.from, entrance.opacity.to, entrance.durationFrames, entrance.opacity.easing);
  const exitStart = durationInFrames - exit.durationFrames;
  const exitFrame = Math.max(0, frame - exitStart);
  const exitOpacity = exit.cut ? 1 : withEasing(exitFrame, exit.opacity.from, exit.opacity.to, exit.durationFrames, exit.opacity.easing);
  const opacity = Math.min(entranceOpacity, frame >= exitStart ? exitOpacity : 1);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function TextOverlay({ text, subtitle, durationInFrames, params }) {
  const frame = useFrameSafe();
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, params.durationFrames)));
  const offset = params.kind === "slide_up" ? (1 - progress) * params.amplitude : 0;
  const opacity = params.kind === "none" ? 1 : progress;
  const visibleChars = params.kind === "typewriter" ? Math.round(text.length * Math.min(1, frame / Math.max(1, params.durationFrames * 2))) : text.length;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: "12%" }}>
      <div style={{ transform: `translateY(${offset}px)`, opacity, textAlign: "center", padding: "0 8%" }}>
        <div style={{ color: "white", fontFamily: "Georgia, serif", fontSize: 54, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
          {params.kind === "typewriter" ? text.slice(0, visibleChars) : text}
        </div>
        {subtitle ? <div style={{ color: "rgba(255,255,255,0.9)", fontFamily: "sans-serif", fontSize: 30, marginTop: 8 }}>{subtitle}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

function IconMark({ durationInFrames, params }) {
  const frame = useFrameSafe();
  const cycle = params.loop ? frame % Math.max(1, params.durationFrames) : Math.min(frame, params.durationFrames);
  const progress = cycle / Math.max(1, params.durationFrames);
  const bounce = params.kind === "bounce" ? Math.abs(Math.sin(progress * Math.PI)) * params.amplitude : 0;
  const scale = params.kind === "pulse" || params.kind === "pop" ? 1 + (params.amplitude - 1) * Math.abs(Math.sin(progress * Math.PI)) : 1;
  if (params.kind === "none") return null;
  return (
    <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "flex-start", padding: "6% 6%" }}>
      <div style={{ transform: `translateY(${-bounce}px) scale(${scale})`, width: 28, height: 28, borderRadius: "50%", background: "white" }} />
    </AbsoluteFill>
  );
}

function CtaMark({ durationInFrames, params }) {
  const frame = useFrameSafe();
  if (params.kind === "none") return null;
  const cycle = params.loop ? frame % Math.max(1, params.durationFrames) : Math.min(frame, params.durationFrames);
  const progress = cycle / Math.max(1, params.durationFrames);
  const scale = params.kind === "scale" || params.kind === "pulse_loop" ? 1 + (params.amplitude - 1) * Math.abs(Math.sin(progress * Math.PI)) : 1;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: "4%" }}>
      <div
        style={{
          transform: `scale(${scale})`,
          padding: "14px 32px",
          borderRadius: 999,
          background: "white",
          color: "#1B1D22",
          fontFamily: "sans-serif",
          fontWeight: 700,
        }}
      >
        Saiba mais
      </div>
    </AbsoluteFill>
  );
}

// Atalho local para `useCurrentFrame()`, relativo ao `Sequence` em que o layer está montado (cada
// cena vira um `Sequence` próprio, ver `MotionPlanComposition`) — evita repetir o import.
function useFrameSafe() {
  return useCurrentFrame();
}

export function MotionPlanComposition({ instructions }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {instructions.scenes.map((scene) => (
        <Sequence key={scene.order} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <SceneLayer scene={scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
