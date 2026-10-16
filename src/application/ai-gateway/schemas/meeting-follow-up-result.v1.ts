import { z } from "zod";

/** `MeetingFollowUpResultV1` — rascunhos de follow-up (e-mail + WhatsApp). Só estrutural: o texto é
 * um RASCUNHO que a pessoa revisa antes de enviar. */

export const MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION = 1;

const meetingFollowUpResultSchema = z
  .object({
    schemaVersion: z.literal(MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION),
    emailSubject: z.string().min(1).max(200),
    emailBody: z.string().min(1).max(6000),
    whatsappMessage: z.string().min(1).max(1500),
    warnings: z.array(z.string()).max(20),
  })
  .strict();

export type MeetingFollowUpResult = z.infer<typeof meetingFollowUpResultSchema>;

export const MEETING_FOLLOW_UP_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "emailSubject", "emailBody", "whatsappMessage", "warnings"],
  properties: {
    schemaVersion: { const: MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION },
    emailSubject: { type: "string", minLength: 1, maxLength: 200 },
    emailBody: { type: "string", minLength: 1, maxLength: 6000 },
    whatsappMessage: { type: "string", minLength: 1, maxLength: 1500 },
    warnings: { type: "array", maxItems: 20, items: { type: "string" } },
  },
};

export function validateMeetingFollowUpStructure(raw: unknown): { valid: true; data: MeetingFollowUpResult } | { valid: false; errors: readonly string[] } {
  const result = meetingFollowUpResultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}
