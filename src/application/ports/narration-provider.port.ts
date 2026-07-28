export type NarrationVoiceProfile = {
  language: string;
  genderPreference?: "female" | "male" | "neutral";
  tone: string;
  pace: number;
};

export type NarrationSegmentRequest = {
  sceneId: string;
  startTime: number;
  endTime: number;
  text: string;
  emotion: string;
  emphasis: string[];
  pauseAfterMs?: number;
  speed?: number;
  volume?: number;
  pronunciationHints?: Record<string, string>;
};

export type NarrationProviderRequest = {
  executionId: string;
  language: string;
  voiceProfile: NarrationVoiceProfile;
  narrationScript: string;
  segments: NarrationSegmentRequest[];
  expectedRelativePath: string;
  providerInstructions: string[];
};

export type NarrationProviderResult = {
  status: "completed" | "failed" | "needs_assisted_generation";
  relativePath?: string;
  absolutePath?: string;
  mimeType?: string;
  durationSeconds?: number;
  sampleRateHz?: number;
  warnings: string[];
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type NarrationProviderPort = {
  generate(input: NarrationProviderRequest): Promise<NarrationProviderResult>;
};
