import React from "react";
import { Composition, registerRoot } from "remotion";
import { MotionPlanComposition } from "./MotionSceneRenderer.jsx";

// Root Remotion — uma única composição genérica ("motion-plan"), cuja duração/fps/resolução são
// calculados dinamicamente a partir de `inputProps.instructions` (que o adapter monta a partir de
// `MotionRenderInstructions`, já resolvido pelo Motion Render Pipeline + Motion Variant Generator).
// Nunca hardcoded: cada Motion Plan pode ter duração/formato diferentes.

const DEFAULT_INSTRUCTIONS = { width: 1080, height: 1920, fps: 30, totalDurationInFrames: 30, scenes: [] };

function calculateMetadata({ props }) {
  const instructions = props.instructions ?? DEFAULT_INSTRUCTIONS;
  return {
    durationInFrames: Math.max(1, instructions.totalDurationInFrames),
    fps: instructions.fps,
    width: instructions.width,
    height: instructions.height,
  };
}

export const RemotionRoot = () => {
  return (
    <Composition
      id="motion-plan"
      component={MotionPlanComposition}
      durationInFrames={DEFAULT_INSTRUCTIONS.totalDurationInFrames}
      fps={DEFAULT_INSTRUCTIONS.fps}
      width={DEFAULT_INSTRUCTIONS.width}
      height={DEFAULT_INSTRUCTIONS.height}
      defaultProps={{ instructions: DEFAULT_INSTRUCTIONS }}
      calculateMetadata={calculateMetadata}
    />
  );
};

registerRoot(RemotionRoot);
