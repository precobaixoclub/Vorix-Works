import type { BriefingAnswerType, BriefingQuestion } from "../../domain/briefing/briefing.model.js";

export type CreateBriefingQuestionInput = {
  briefingId: string;
  fieldKeys: readonly string[];
  text: string;
  reason: string;
  priority: number;
  answerType: BriefingAnswerType;
  options?: readonly string[];
};

export type BriefingQuestionRepositoryPort = {
  create(input: CreateBriefingQuestionInput): Promise<BriefingQuestion>;
  getById(id: string): Promise<BriefingQuestion | undefined>;
  /** No máximo uma pergunta `pending` por briefing nesta sprint (o Planner nunca cria a segunda enquanto a primeira está aberta). */
  getPendingByBriefing(briefingId: string): Promise<BriefingQuestion | undefined>;
  listByBriefing(briefingId: string): Promise<BriefingQuestion[]>;
  markAnswered(id: string): Promise<BriefingQuestion>;
  markSuperseded(id: string): Promise<BriefingQuestion>;
};
