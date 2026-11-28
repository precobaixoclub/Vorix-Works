import React from "react";
import { Composition, registerRoot } from "remotion";
import { useFonts, type Common } from "./lib/theme";
import { DetailReveal, Lineup, ProductHero, type DetailRevealProps, type LineupProps, type ProductHeroProps } from "./templates/product";
import { SoftwareFocus, SpeechCaptions, TitleCard, type SoftwareFocusProps, type SpeechCaptionsProps, type TitleCardProps } from "./templates/software-title-speech";
import { Spot, type SpotProps } from "./templates/spot";
import { Clock, Counter, MaskReveal, Versus, type ClockProps, type CounterProps, type MaskRevealProps, type VersusProps } from "./templates/concept";

/**
 * Uma composição ("Scene") com o template escolhido pelo diretor criativo. Duração, tamanho e fps vêm das
 * props: o worker renderiza cada cena como um clipe e o FFmpeg monta a peça (transições, áudio, legendas
 * da trilha, logo e exportação continuam no motor atual).
 */
export type SceneProps = { width: number; height: number; fps: number; durationInFrames: number } & (
  | ({ template: "product_hero" } & ProductHeroProps)
  | ({ template: "detail_reveal" } & DetailRevealProps)
  | ({ template: "lineup" } & LineupProps)
  | ({ template: "software_focus" } & SoftwareFocusProps)
  | ({ template: "title_card" } & TitleCardProps)
  | ({ template: "speech_captions" } & SpeechCaptionsProps)
  | ({ template: "spot" } & SpotProps)
  | ({ template: "clock" } & ClockProps)
  | ({ template: "counter" } & CounterProps)
  | ({ template: "versus" } & VersusProps)
  | ({ template: "mask_reveal" } & MaskRevealProps)
);

const Scene: React.FC<SceneProps> = (props) => {
  useFonts((props as Common).assetBase);
  switch (props.template) {
    case "product_hero": return <ProductHero {...props} />;
    case "detail_reveal": return <DetailReveal {...props} />;
    case "lineup": return <Lineup {...props} />;
    case "software_focus": return <SoftwareFocus {...props} />;
    case "title_card": return <TitleCard {...props} />;
    case "speech_captions": return <SpeechCaptions {...props} />;
    case "spot": return <Spot {...props} />;
    case "clock": return <Clock {...props} />;
    case "counter": return <Counter {...props} />;
    case "versus": return <Versus {...props} />;
    case "mask_reveal": return <MaskReveal {...props} />;
  }
};

const Root: React.FC = () => (
  <Composition
    id="Scene"
    component={Scene as unknown as React.FC<Record<string, unknown>>}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    defaultProps={{ template: "title_card", lines: ["Vorix"], assetBase: "", brand: { name: "Vorix", primary: "#9333EA", accent: "#B990FC", light: "#F5F5F4", dark: "#111111", display: "Barlow Condensed" }, width: 1080, height: 1920, fps: 30, durationInFrames: 90 }}
    calculateMetadata={({ props }) => {
      const p = props as unknown as SceneProps;
      return { width: p.width, height: p.height, fps: p.fps, durationInFrames: p.durationInFrames };
    }}
  />
);

registerRoot(Root);
