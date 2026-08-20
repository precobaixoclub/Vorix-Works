export type PublicationQueueJob = {
  id: string;
  publicationId: string;
  tenantId: string;
  workspaceId: string;
  kind: "publish" | "retry" | "scheduled";
  enqueuedAt: string;
  runAfter?: string;
};

export type PublicationQueuePort = {
  enqueue(job: PublicationQueueJob): Promise<void>;
  dequeue(now?: string, filter?: { tenantId?: string; workspaceId?: string }): Promise<PublicationQueueJob | undefined>;
  size(): Promise<number>;
  list(): Promise<readonly PublicationQueueJob[]>;
};

export class InMemoryPublicationQueue implements PublicationQueuePort {
  private readonly jobs: PublicationQueueJob[] = [];

  async enqueue(job: PublicationQueueJob): Promise<void> {
    if (this.jobs.some((candidate) => candidate.id === job.id)) return;
    this.jobs.push(job);
  }

  async dequeue(now = new Date().toISOString(), filter: { tenantId?: string; workspaceId?: string } = {}): Promise<PublicationQueueJob | undefined> {
    const index = this.jobs.findIndex((job) =>
      (!job.runAfter || job.runAfter <= now)
      && (!filter.tenantId || job.tenantId === filter.tenantId)
      && (!filter.workspaceId || job.workspaceId === filter.workspaceId),
    );
    if (index < 0) return undefined;
    const [job] = this.jobs.splice(index, 1);
    return job;
  }

  async size(): Promise<number> {
    return this.jobs.length;
  }

  async list(): Promise<readonly PublicationQueueJob[]> {
    return [...this.jobs];
  }
}

export class FuturePublicationQueueAdapter implements PublicationQueuePort {
  async enqueue(_job: PublicationQueueJob): Promise<void> {
    throw new Error("PUBLICATION_QUEUE_NOT_CONFIGURED: FutureQueueAdapter é apenas contrato para integração futura.");
  }
  async dequeue(): Promise<PublicationQueueJob | undefined> {
    throw new Error("PUBLICATION_QUEUE_NOT_CONFIGURED: FutureQueueAdapter é apenas contrato para integração futura.");
  }
  async size(): Promise<number> {
    return 0;
  }
  async list(): Promise<readonly PublicationQueueJob[]> {
    return [];
  }
}
