import { renderPlatformEmail } from "./platform-email-template.js";

export const PLATFORM_EMAIL_EVENTS = [
  "account_created", "subscription_started", "plan_changed", "cancellation_requested", "subscription_cancelled",
  "payment_failed", "publication_failed", "publication_action_required",
] as const;

export type PlatformEmailEvent = typeof PLATFORM_EMAIL_EVENTS[number];
export type PlatformEmailStatus = "pending" | "sending" | "accepted" | "failed" | "cancelled";

export type PlatformEmailSettings = {
  enabled: boolean;
  fromEmail: string | null;
  recipients: string[];
  events: PlatformEmailEvent[];
};

export type PlatformEmailHistoryItem = {
  id: string;
  event: PlatformEmailEvent | "test";
  subject: string;
  recipient: string;
  status: PlatformEmailStatus;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

export type PlatformEmailJob = PlatformEmailHistoryItem & {
  fromEmail: string;
  body: string;
  path: string | null;
  leaseToken: string;
};

export type PlatformEmailAlertsRepository = {
  settings(): Promise<PlatformEmailSettings & { apiKey?: string }>;
  save(input: PlatformEmailSettings & { apiKey?: string }): Promise<void>;
  enqueueTest(): Promise<number>;
  history(): Promise<PlatformEmailHistoryItem[]>;
  claim(): Promise<PlatformEmailJob | undefined>;
  settle(input: {
    job: PlatformEmailJob;
    status: "pending" | "accepted" | "failed";
    providerId?: string;
    error?: string;
    retryAfterSeconds?: number;
  }): Promise<void>;
};

export type TransactionalEmailSender = {
  send(input: { apiKey: string; job: PlatformEmailJob; text: string; html?: string }): Promise<
    { accepted: true; providerId: string } | { accepted: false; retryable: boolean; message: string }
  >;
};

export class PlatformEmailAlerts {
  constructor(
    private readonly repository: PlatformEmailAlertsRepository,
    private readonly sender: TransactionalEmailSender,
    private readonly webOrigin: string | undefined,
  ) {}

  async settings() {
    const { apiKey, ...settings } = await this.repository.settings();
    return { ...settings, hasApiKey: Boolean(apiKey) };
  }

  async save(input: PlatformEmailSettings & { apiKey?: string }) {
    await this.repository.save(input);
    return this.settings();
  }

  enqueueTest() { return this.repository.enqueueTest(); }

  history() { return this.repository.history(); }

  async dispatch(): Promise<void> {
    const { apiKey } = await this.repository.settings();
    if (!apiKey) return;
    for (let i = 0; i < 10; i++) {
      const job = await this.repository.claim();
      if (!job) break;
      const path = job.path;
      const link = this.webOrigin && path && /^\/(admin|workspaces)\//.test(path) && !/[\\\r\n]/.test(path)
        ? new URL(path, this.webOrigin).href : undefined;
      const { html, text } = renderPlatformEmail({ event: job.event, subject: job.subject, body: job.body, link, sentAt: new Date(job.createdAt) });
      const result = await this.sender.send({ apiKey, job, text, html });
      if (result.accepted) {
        await this.repository.settle({ job, status: "accepted", providerId: result.providerId });
      } else {
        const retry = result.retryable && job.attempts < 5;
        await this.repository.settle({ job, status: retry ? "pending" : "failed", error: result.message,
          retryAfterSeconds: retry ? 30 * 2 ** (job.attempts - 1) : undefined });
      }
    }
  }
}
