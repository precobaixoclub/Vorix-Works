import type { AIProviderPort } from "../ports/ai-provider.port.js";

/**
 * Resposta automática gerada por IA — módulo Instagram DM Automation, Fase 5. Chama um `text`
 * Provider (`OpenAiIcaroTextProvider`, uma instância DEDICADA — nunca a mesma usada pelo Ícaro do
 * pipeline de conteúdo, mesmo raciocínio do comentário de topo de `openai-icaro-text-provider.ts`:
 * "nunca a mesma instância reaproveitada por conveniência entre dois papéis") diretamente, sem
 * passar pelo `IcaroAIBrain` — não há tarefa pra rotear entre múltiplos providers aqui, é uma
 * chamada de texto avulsa e isolada.
 */

const MAX_REPLY_CHARS = 900;

export type GenerateAiDmReplyInput = {
  incomingMessage: string;
  /** Instrução extra da regra de automação (ex.: "responda em tom informal, mencione que o
   * catálogo está no link da bio"). */
  instructions?: string;
  /** Nome da conta/negócio, pra contexto do modelo — nunca inventa a marca sozinho. */
  accountName?: string;
};

export async function generateAiDmReply(provider: AIProviderPort, input: GenerateAiDmReplyInput): Promise<string> {
  const prompt = [
    `Você responde mensagens diretas do Instagram em nome de "${input.accountName ?? "a conta"}".`,
    "Escreva uma resposta curta (1-3 frases), em português, tom natural e cordial — nunca robótico, nunca genérico demais.",
    "Nunca invente preço, prazo, disponibilidade ou qualquer fato que você não tenha recebido explicitamente nas instruções abaixo.",
    input.instructions ? `Instruções específicas desta automação: ${input.instructions}` : undefined,
    `Mensagem recebida: "${input.incomingMessage}"`,
    "Responda só com o texto da mensagem, sem aspas, sem prefixos como \"Resposta:\".",
  ].filter(Boolean).join("\n");

  const response = await provider.execute({
    taskType: "text_generation",
    prompt,
    model: "",
    temperature: 0.6,
    maxTokens: 220,
    timeoutMs: 15_000,
  });

  const content = typeof response.content === "string" ? response.content.trim() : "";
  if (!content) throw new Error("INSTAGRAM_DM_AI_REPLY_EMPTY: o provider de IA não retornou texto.");
  return content.length > MAX_REPLY_CHARS ? `${content.slice(0, MAX_REPLY_CHARS - 1)}…` : content;
}
