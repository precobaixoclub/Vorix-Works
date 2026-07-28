import type { IcaroAIRequest, IcaroAIResponse } from "./icaro.types.js";

export type IcaroBrainPort = {
  request(request: IcaroAIRequest): Promise<IcaroAIResponse>;
};
