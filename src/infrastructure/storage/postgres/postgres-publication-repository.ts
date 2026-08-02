import type { Pool } from "pg";
import type {
  CreatePublicationEventInput,
  CreatePublicationPlanInput,
  ListPublicationFilter,
  PublicationRepositoryPort,
} from "../../../application/ports/publication-repository.port.js";
import type {
  PublicationApproval,
  PublicationAttempt,
  PublicationCandidate,
  PublicationCredentialReference,
  PublicationDeadLetter,
  PublicationDetail,
  PublicationEvent,
  PublicationFailure,
  PublicationLock,
  PublicationOutboxMessage,
  PublicationPayloadReference,
  PublicationPlan,
  PublicationReceipt,
  PublicationReceiptVerification,
  PublicationReconciliation,
  PublicationSchedule,
  PublicationScheduleState,
  PublicationState,
  PublicationTarget,
} from "../../../domain/publication/publication.model.js";

type PlanRow = {
  id: string; tenant_id: string; workspace_id: string; state: string; mode: string; idempotency_key: string; source_execution_run_id: string | null;
  source_artifacts: PublicationPlan["sourceArtifacts"]; policy: PublicationPlan["policy"]; correlation_id: string; causation_id: string | null; trace_id: string;
  scheduled_at: Date | null; timezone: string | null; created_at: Date; updated_at: Date; approved_at: Date | null; published_at: Date | null; cancelled_at: Date | null; version: number;
};
type CandidateRow = { id: string; publication_id: string; tenant_id: string; workspace_id: string; content: Record<string, unknown>; assets: PublicationCandidate["assets"]; metadata: Record<string, unknown>; created_at: Date };
type TargetRow = { id: string; publication_id: string; candidate_id: string; tenant_id: string; workspace_id: string; channel: string; provider: string; mode: string; status: string; idempotency_key: string; created_at: Date; updated_at: Date };
type ApprovalRow = { id: string; publication_id: string; tenant_id: string; workspace_id: string; approved_by_user_id: string; reason: string; notes: string | null; created_at: Date };
type AttemptRow = { id: string; publication_id: string; target_id: string; tenant_id: string; workspace_id: string; provider: string; channel: string; attempt_number: number; state: string; idempotency_key: string; started_at: Date; finished_at: Date | null; failure: PublicationFailure | null };
type ReceiptRow = { id: string; publication_id: string; target_id: string; attempt_id: string; tenant_id: string; workspace_id: string; provider: string; provider_publication_id: string; provider_request_id: string | null; external_identifiers: Record<string, string> | null; channel: string; published_at: Date; status: string; url: string; checksum: string; correlation_id: string; trace_id: string; idempotency_key: string; created_at: Date };
type EventRow = { id: string; publication_id: string; event_type: string; target_id: string | null; attempt_id: string | null; receipt_id: string | null; correlation_id: string | null; causation_id: string | null; trace_id: string | null; created_at: Date; payload: Record<string, unknown> | null };
type FailureRow = { failure: PublicationFailure };
type ScheduleRow = { id: string; publication_id: string; tenant_id: string; workspace_id: string; scheduled_at: Date; timezone: string; status: string; created_at: Date; updated_at: Date };
type LockRow = { publication_id: string; owner_id: string; acquired_at: Date; expires_at: Date };
type DeadLetterRow = { id: string; outbox_message_id: string | null; publication_id: string; target_id: string | null; provider_id: string | null; tenant_id: string; workspace_id: string; reason: string; last_error: PublicationFailure; attempts: number; last_failure_code: string | null; last_safe_message: string | null; dead_lettered_at: Date | null; recovery_status: string | null; created_at: Date };
type PayloadReferenceRow = { id: string; publication_id: string; target_id: string; tenant_id: string; workspace_id: string; version: number; content_checksum: string; payload: Record<string, unknown>; assets: PublicationPayloadReference["assets"]; size_bytes: number; created_at: Date };
type OutboxRow = { outbox_message_id: string; publication_id: string; target_id: string; attempt_id: string; tenant_id: string; workspace_id: string; provider_id: string; credential_reference_id: string | null; idempotency_key: string; payload_reference: string; status: string; attempt_count: number; available_at: Date; claimed_by: string | null; claimed_at: Date | null; lease_expires_at: Date | null; fencing_token: number; last_failure_code: string | null; retry_after: Date | null; created_at: Date; updated_at: Date };
type CredentialReferenceRow = { credential_reference_id: string; tenant_id: string; workspace_id: string; provider_id: string; status: string; environment: string | null; provider_subject_id: string | null; scopes: string[] | null; expires_at: Date | null; last_refreshed_at: Date | null; revoked_at: Date | null; created_at: Date; updated_at: Date };
type ReconciliationRow = { id: string; publication_id: string; target_id: string; attempt_id: string; outbox_message_id: string; tenant_id: string; workspace_id: string; provider_id: string; status: string; provider_request_id: string | null; idempotency_key: string; created_at: Date; updated_at: Date };
type ReceiptVerificationRow = { id: string; receipt_id: string; publication_id: string; target_id: string; tenant_id: string; workspace_id: string; provider_id: string; verified_at: Date; verification_status: string; external_status: string | null; checksum: string; details_code: string | null };

export class PostgresPublicationRepository implements PublicationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createPlan(input: CreatePublicationPlanInput): Promise<PublicationDetail> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into publication_plans (id, tenant_id, workspace_id, state, mode, idempotency_key, source_execution_run_id, source_artifacts, policy, correlation_id, causation_id, trace_id, scheduled_at, timezone)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [input.plan.id, input.plan.tenantId, input.plan.workspaceId, input.plan.state, input.plan.mode, input.plan.idempotencyKey, input.plan.sourceExecutionRunId ?? null, JSON.stringify(input.plan.sourceArtifacts), JSON.stringify(input.plan.policy), input.plan.correlationId, input.plan.causationId ?? null, input.plan.traceId, input.plan.scheduledAt ?? null, input.plan.timezone ?? null],
      );
      for (const candidate of input.candidates) {
        await client.query(
          `insert into publication_candidates (id, publication_id, tenant_id, workspace_id, content, assets, metadata)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [candidate.id, candidate.publicationId, candidate.tenantId, candidate.workspaceId, JSON.stringify(candidate.content), JSON.stringify(candidate.assets), JSON.stringify(candidate.metadata)],
        );
      }
      for (const target of input.targets) {
        await client.query(
          `insert into publication_targets (id, publication_id, candidate_id, tenant_id, workspace_id, channel, provider, mode, status, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [target.id, target.publicationId, target.candidateId, target.tenantId, target.workspaceId, target.channel, target.provider, target.mode, target.status, target.idempotencyKey],
        );
      }
      await client.query("commit");
      const detail = await this.getDetail(input.plan.id);
      if (!detail) throw new Error("PUBLICATION_NOT_FOUND: publicação criada não foi encontrada.");
      return detail;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlanById(id: string): Promise<PublicationPlan | undefined> {
    const result = await this.pool.query<PlanRow>("select * from publication_plans where id = $1", [id]);
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  async getPlanByIdempotency(input: { tenantId: string; workspaceId: string; idempotencyKey: string }): Promise<PublicationPlan | undefined> {
    const result = await this.pool.query<PlanRow>("select * from publication_plans where tenant_id = $1 and workspace_id = $2 and idempotency_key = $3", [input.tenantId, input.workspaceId, input.idempotencyKey]);
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  async getDetail(id: string): Promise<PublicationDetail | undefined> {
    const plan = await this.getPlanById(id);
    if (!plan) return undefined;
    const [candidates, targets, approvals, attempts, receipts, events, failures, schedules, deadLetters, outbox, payloadReferences, reconciliations, receiptVerifications] = await Promise.all([
      this.pool.query<CandidateRow>("select * from publication_candidates where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toCandidate)),
      this.pool.query<TargetRow>("select * from publication_targets where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toTarget)),
      this.pool.query<ApprovalRow>("select * from publication_approvals where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toApproval)),
      this.pool.query<AttemptRow>("select * from publication_attempts where publication_id = $1 order by started_at, attempt_number", [id]).then((r) => r.rows.map(toAttempt)),
      this.pool.query<ReceiptRow>("select * from publication_receipts where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toReceipt)),
      this.pool.query<EventRow>("select * from publication_events where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toEvent)),
      this.pool.query<FailureRow>("select failure from publication_failures where publication_id = $1 order by id", [id]).then((r) => r.rows.map((row) => row.failure)),
      this.pool.query<ScheduleRow>("select * from publication_schedules where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toSchedule)),
      this.pool.query<DeadLetterRow>("select * from publication_dead_letters where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toDeadLetter)),
      this.pool.query<OutboxRow>("select * from publication_outbox where publication_id = $1 order by created_at, outbox_message_id", [id]).then((r) => r.rows.map(toOutbox)),
      this.pool.query<PayloadReferenceRow>("select * from publication_payload_references where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toPayloadReference)),
      this.pool.query<ReconciliationRow>("select * from publication_reconciliations where publication_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toReconciliation)),
      this.pool.query<ReceiptVerificationRow>("select * from publication_receipt_verifications where publication_id = $1 order by verified_at, id", [id]).then((r) => r.rows.map(toReceiptVerification)),
    ]);
    return { plan, candidates, targets, approvals, attempts, receipts, events, failures, schedules, deadLetters, outbox, payloadReferences, reconciliations, receiptVerifications };
  }

  async listPlans(filter: ListPublicationFilter): Promise<PublicationPlan[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    if (filter.state) {
      params.push(filter.state);
      conditions.push(`state = $${params.length}`);
    }
    const result = await this.pool.query<PlanRow>(`select * from publication_plans where ${conditions.join(" and ")} order by created_at desc`, params);
    return result.rows.map(toPlan);
  }

  async updatePlanState(input: { id: string; state: PublicationState; expectedVersion?: number; approvedAt?: string; publishedAt?: string; cancelledAt?: string }): Promise<PublicationPlan> {
    const plan = await this.getPlanById(input.id);
    if (!plan) throw new Error(`PUBLICATION_NOT_FOUND: publicação "${input.id}" não existe.`);
    if (input.expectedVersion !== undefined && plan.version !== input.expectedVersion) throw new Error("PUBLICATION_OPTIMISTIC_LOCK_CONFLICT: versão divergente.");
    const result = await this.pool.query<PlanRow>(
      `update publication_plans set state = $2, approved_at = coalesce($3, approved_at), published_at = coalesce($4, published_at), cancelled_at = coalesce($5, cancelled_at), updated_at = now(), version = version + 1 where id = $1 returning *`,
      [input.id, input.state, input.approvedAt ?? null, input.publishedAt ?? null, input.cancelledAt ?? null],
    );
    return toPlan(result.rows[0]);
  }

  async updateTargetStatus(input: { id: string; status: PublicationTarget["status"] }): Promise<PublicationTarget> {
    const result = await this.pool.query<TargetRow>("update publication_targets set status = $2, updated_at = now() where id = $1 returning *", [input.id, input.status]);
    if (!result.rows[0]) throw new Error(`PUBLICATION_TARGET_NOT_FOUND: target "${input.id}" não existe.`);
    return toTarget(result.rows[0]);
  }

  async appendApproval(input: Omit<PublicationApproval, "createdAt">): Promise<PublicationApproval> {
    const result = await this.pool.query<ApprovalRow>(
      `insert into publication_approvals (id, publication_id, tenant_id, workspace_id, approved_by_user_id, reason, notes) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [input.id, input.publicationId, input.tenantId, input.workspaceId, input.approvedByUserId, input.reason, input.notes ?? null],
    );
    return toApproval(result.rows[0]);
  }

  async createAttempt(input: Omit<PublicationAttempt, "startedAt" | "state">): Promise<PublicationAttempt> {
    const result = await this.pool.query<AttemptRow>(
      `insert into publication_attempts (id, publication_id, target_id, tenant_id, workspace_id, provider, channel, attempt_number, state, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9) returning *`,
      [input.id, input.publicationId, input.targetId, input.tenantId, input.workspaceId, input.provider, input.channel, input.attemptNumber, input.idempotencyKey],
    );
    return toAttempt(result.rows[0]);
  }

  async createAttemptWithOutbox(input: {
    attempt: Omit<PublicationAttempt, "startedAt" | "state">;
    event: CreatePublicationEventInput;
    payloadReference: Omit<PublicationPayloadReference, "createdAt">;
    outbox: Omit<PublicationOutboxMessage, "createdAt" | "updatedAt" | "status" | "attemptCount" | "fencingToken">;
  }): Promise<{ attempt: PublicationAttempt; payloadReference: PublicationPayloadReference; outbox: PublicationOutboxMessage; event: PublicationEvent }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const attemptRow = await client.query<AttemptRow>(
        `insert into publication_attempts (id, publication_id, target_id, tenant_id, workspace_id, provider, channel, attempt_number, state, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9) returning *`,
        [input.attempt.id, input.attempt.publicationId, input.attempt.targetId, input.attempt.tenantId, input.attempt.workspaceId, input.attempt.provider, input.attempt.channel, input.attempt.attemptNumber, input.attempt.idempotencyKey],
      );
      const payloadRow = await client.query<PayloadReferenceRow>(
        `insert into publication_payload_references (id, publication_id, target_id, tenant_id, workspace_id, version, content_checksum, payload, assets, size_bytes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [input.payloadReference.id, input.payloadReference.publicationId, input.payloadReference.targetId, input.payloadReference.tenantId, input.payloadReference.workspaceId, input.payloadReference.version, input.payloadReference.contentChecksum, JSON.stringify(input.payloadReference.payload), JSON.stringify(input.payloadReference.assets), input.payloadReference.sizeBytes],
      );
      const outboxRow = await client.query<OutboxRow>(
        `insert into publication_outbox (outbox_message_id, publication_id, target_id, attempt_id, tenant_id, workspace_id, provider_id, credential_reference_id, idempotency_key, payload_reference, status, attempt_count, available_at, fencing_token)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',0,$11,0) returning *`,
        [input.outbox.outboxMessageId, input.outbox.publicationId, input.outbox.targetId, input.outbox.attemptId, input.outbox.tenantId, input.outbox.workspaceId, input.outbox.providerId, input.outbox.credentialReferenceId ?? null, input.outbox.idempotencyKey, input.outbox.payloadReference, input.outbox.availableAt],
      );
      const eventRow = await client.query<EventRow>(
        `insert into publication_events (id, publication_id, event_type, target_id, attempt_id, receipt_id, correlation_id, causation_id, trace_id, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [input.event.id, input.event.publicationId, input.event.eventType, input.event.targetId ?? null, input.event.attemptId ?? null, input.event.receiptId ?? null, input.event.correlationId ?? null, input.event.causationId ?? null, input.event.traceId ?? null, input.event.payload ? JSON.stringify(input.event.payload) : null],
      );
      await client.query("commit");
      return { attempt: toAttempt(attemptRow.rows[0]), payloadReference: toPayloadReference(payloadRow.rows[0]), outbox: toOutbox(outboxRow.rows[0]), event: toEvent(eventRow.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finishAttempt(input: { id: string; state: PublicationAttempt["state"]; failure?: PublicationFailure }): Promise<PublicationAttempt> {
    const result = await this.pool.query<AttemptRow>("update publication_attempts set state = $2, failure = $3, finished_at = now() where id = $1 returning *", [input.id, input.state, input.failure ? JSON.stringify(input.failure) : null]);
    if (!result.rows[0]) throw new Error(`PUBLICATION_ATTEMPT_NOT_FOUND: attempt "${input.id}" não existe.`);
    return toAttempt(result.rows[0]);
  }

  async createReceipts(inputs: readonly Omit<PublicationReceipt, "createdAt">[]): Promise<PublicationReceipt[]> {
    const created: PublicationReceipt[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<ReceiptRow>(
        `insert into publication_receipts (id, publication_id, target_id, attempt_id, tenant_id, workspace_id, provider, provider_publication_id, provider_request_id, external_identifiers, channel, published_at, status, url, checksum, correlation_id, trace_id, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (publication_id, target_id, provider, idempotency_key) do nothing returning *`,
        [input.id, input.publicationId, input.targetId, input.attemptId, input.tenantId, input.workspaceId, input.provider, input.providerPublicationId, input.providerRequestId ?? null, input.externalIdentifiers ? JSON.stringify(input.externalIdentifiers) : null, input.channel, input.publishedAt, input.status, input.url, input.checksum, input.correlationId, input.traceId, input.idempotencyKey],
      );
      created.push(result.rows[0] ? toReceipt(result.rows[0]) : (await this.findReceiptByIdempotency({ publicationId: input.publicationId, targetId: input.targetId, provider: input.provider, idempotencyKey: input.idempotencyKey }))!);
    }
    return created;
  }

  async findReceiptByIdempotency(input: { publicationId: string; targetId: string; provider: string; idempotencyKey: string }): Promise<PublicationReceipt | undefined> {
    const result = await this.pool.query<ReceiptRow>("select * from publication_receipts where publication_id = $1 and target_id = $2 and provider = $3 and idempotency_key = $4", [input.publicationId, input.targetId, input.provider, input.idempotencyKey]);
    return result.rows[0] ? toReceipt(result.rows[0]) : undefined;
  }

  async appendFailure(input: { publicationId: string; failure: PublicationFailure }): Promise<PublicationFailure> {
    await this.pool.query("insert into publication_failures (publication_id, failure) values ($1,$2)", [input.publicationId, JSON.stringify(input.failure)]);
    return input.failure;
  }

  async appendEvent(input: CreatePublicationEventInput): Promise<PublicationEvent> {
    const result = await this.pool.query<EventRow>(
      `insert into publication_events (id, publication_id, event_type, target_id, attempt_id, receipt_id, correlation_id, causation_id, trace_id, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [input.id, input.publicationId, input.eventType, input.targetId ?? null, input.attemptId ?? null, input.receiptId ?? null, input.correlationId ?? null, input.causationId ?? null, input.traceId ?? null, input.payload ? JSON.stringify(input.payload) : null],
    );
    return toEvent(result.rows[0]);
  }

  async createSchedule(input: Omit<PublicationSchedule, "createdAt" | "updatedAt">): Promise<PublicationSchedule> {
    const result = await this.pool.query<ScheduleRow>("insert into publication_schedules (id, publication_id, tenant_id, workspace_id, scheduled_at, timezone, status) values ($1,$2,$3,$4,$5,$6,$7) returning *", [input.id, input.publicationId, input.tenantId, input.workspaceId, input.scheduledAt, input.timezone, input.status]);
    return toSchedule(result.rows[0]);
  }

  async updateScheduleStatus(input: { id: string; status: PublicationScheduleState }): Promise<PublicationSchedule> {
    const result = await this.pool.query<ScheduleRow>("update publication_schedules set status = $2, updated_at = now() where id = $1 returning *", [input.id, input.status]);
    if (!result.rows[0]) throw new Error(`PUBLICATION_SCHEDULE_NOT_FOUND: schedule "${input.id}" não existe.`);
    return toSchedule(result.rows[0]);
  }

  async listSchedules(filter: { tenantId: string; workspaceId: string; status?: PublicationScheduleState }): Promise<PublicationSchedule[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const result = await this.pool.query<ScheduleRow>(`select * from publication_schedules where ${conditions.join(" and ")} order by scheduled_at, id`, params);
    return result.rows.map(toSchedule);
  }

  async listDueSchedules(input: { now: string; limit: number }): Promise<PublicationSchedule[]> {
    const result = await this.pool.query<ScheduleRow>("select * from publication_schedules where status = 'scheduled' and scheduled_at <= $1 order by scheduled_at, id limit $2", [input.now, input.limit]);
    return result.rows.map(toSchedule);
  }

  async acquireLock(input: PublicationLock): Promise<boolean> {
    const result = await this.pool.query<LockRow>(
      `insert into publication_locks (publication_id, owner_id, acquired_at, expires_at) values ($1,$2,$3,$4)
       on conflict (publication_id) do update set owner_id = excluded.owner_id, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
       where publication_locks.expires_at <= excluded.acquired_at returning *`,
      [input.publicationId, input.ownerId, input.acquiredAt, input.expiresAt],
    );
    return result.rowCount === 1;
  }

  async releaseLock(publicationId: string, ownerId: string): Promise<void> {
    await this.pool.query("delete from publication_locks where publication_id = $1 and owner_id = $2", [publicationId, ownerId]);
  }

  async listLocks(): Promise<PublicationLock[]> {
    const result = await this.pool.query<LockRow>("select * from publication_locks order by acquired_at");
    return result.rows.map(toLock);
  }

  async createDeadLetter(input: Omit<PublicationDeadLetter, "createdAt">): Promise<PublicationDeadLetter> {
    const result = await this.pool.query<DeadLetterRow>("insert into publication_dead_letters (id, outbox_message_id, publication_id, target_id, provider_id, tenant_id, workspace_id, reason, last_error, attempts, last_failure_code, last_safe_message, dead_lettered_at, recovery_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13, now()),coalesce($14,'pending')) returning *", [input.id, input.outboxMessageId ?? null, input.publicationId, input.targetId ?? null, input.providerId ?? null, input.tenantId, input.workspaceId, input.reason, JSON.stringify(input.lastError), input.attempts, input.lastFailureCode ?? null, input.lastSafeMessage ?? null, input.deadLetteredAt ?? null, input.recoveryStatus ?? null]);
    return toDeadLetter(result.rows[0]);
  }

  async listDeadLetters(filter: { tenantId: string; workspaceId: string }): Promise<PublicationDeadLetter[]> {
    const result = await this.pool.query<DeadLetterRow>("select * from publication_dead_letters where tenant_id = $1 and workspace_id = $2 order by created_at, id", [filter.tenantId, filter.workspaceId]);
    return result.rows.map(toDeadLetter);
  }

  async reprocessDeadLetter(input: { id: string; tenantId: string; workspaceId: string; now: string }): Promise<PublicationDeadLetter | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<DeadLetterRow>(
        "update publication_dead_letters set recovery_status = 'reprocessed' where id = $1 and tenant_id = $2 and workspace_id = $3 returning *",
        [input.id, input.tenantId, input.workspaceId],
      );
      const letter = result.rows[0] ? toDeadLetter(result.rows[0]) : undefined;
      if (!letter) {
        await client.query("rollback");
        return undefined;
      }
      if (letter.outboxMessageId) {
        await client.query(
          "update publication_outbox set status = 'pending', available_at = $2, claimed_by = null, claimed_at = null, lease_expires_at = null, last_failure_code = null, retry_after = null, updated_at = now() where outbox_message_id = $1",
          [letter.outboxMessageId, input.now],
        );
      }
      if (letter.targetId) await client.query("update publication_targets set status = 'pending', updated_at = now() where id = $1", [letter.targetId]);
      await client.query("update publication_plans set state = 'publishing', updated_at = now(), version = version + 1 where id = $1", [letter.publicationId]);
      await client.query("commit");
      return letter;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPayloadReference(id: string): Promise<PublicationPayloadReference | undefined> {
    const result = await this.pool.query<PayloadReferenceRow>("select * from publication_payload_references where id = $1", [id]);
    return result.rows[0] ? toPayloadReference(result.rows[0]) : undefined;
  }

  async listOutbox(filter: { tenantId?: string; workspaceId?: string; status?: PublicationOutboxMessage["status"] } = {}): Promise<PublicationOutboxMessage[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.tenantId) { params.push(filter.tenantId); conditions.push(`tenant_id = $${params.length}`); }
    if (filter.workspaceId) { params.push(filter.workspaceId); conditions.push(`workspace_id = $${params.length}`); }
    if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
    const result = await this.pool.query<OutboxRow>(`select * from publication_outbox ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by created_at, outbox_message_id`, params);
    return result.rows.map(toOutbox);
  }

  async claimOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<PublicationOutboxMessage[]> {
    const result = await this.pool.query<OutboxRow>(
      `update publication_outbox set status = 'claimed', claimed_by = $1, claimed_at = $2, lease_expires_at = $2::timestamptz + ($3 || ' milliseconds')::interval, fencing_token = fencing_token + 1, updated_at = now()
       where outbox_message_id in (
         select outbox_message_id from publication_outbox
         where (status in ('pending','failed') or (status = 'claimed' and lease_expires_at <= $2))
           and available_at <= $2
           and coalesce(last_failure_code, '') <> 'UNKNOWN_OUTCOME'
         order by available_at, outbox_message_id
         limit $4
         for update skip locked
       ) returning *`,
      [input.workerId, input.now, input.leaseMs, input.limit],
    );
    return result.rows.map(toOutbox);
  }

  async completeOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; receipt?: Omit<PublicationReceipt, "id" | "createdAt">; receiptId?: string }): Promise<{ committed: boolean; receipt?: PublicationReceipt }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<OutboxRow>(
        `update publication_outbox
         set status = 'dispatched', updated_at = now()
         where outbox_message_id = $1
           and claimed_by = $2
           and fencing_token = $3
           and lease_expires_at > $4
           and exists (select 1 from publication_attempts where id = publication_outbox.attempt_id and state = 'running')
         returning *`,
        [input.outboxMessageId, input.workerId, input.fencingToken, input.now],
      );
      const message = result.rows[0] ? toOutbox(result.rows[0]) : undefined;
      if (!message) {
        await client.query("rollback");
        return { committed: false };
      }

      let receipt: PublicationReceipt | undefined;
      if (input.receipt && input.receiptId) {
        const receiptResult = await client.query<ReceiptRow>(
          `insert into publication_receipts (id, publication_id, target_id, attempt_id, tenant_id, workspace_id, provider, provider_publication_id, provider_request_id, external_identifiers, channel, published_at, status, url, checksum, correlation_id, trace_id, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           on conflict (publication_id, target_id, provider, idempotency_key) do update
           set provider_publication_id = publication_receipts.provider_publication_id
           returning *`,
          [input.receiptId, input.receipt.publicationId, input.receipt.targetId, input.receipt.attemptId, input.receipt.tenantId, input.receipt.workspaceId, input.receipt.provider, input.receipt.providerPublicationId, input.receipt.providerRequestId ?? null, input.receipt.externalIdentifiers ? JSON.stringify(input.receipt.externalIdentifiers) : null, input.receipt.channel, input.receipt.publishedAt, input.receipt.status, input.receipt.url, input.receipt.checksum, input.receipt.correlationId, input.receipt.traceId, input.receipt.idempotencyKey],
        );
        receipt = toReceipt(receiptResult.rows[0]);
        await client.query("update publication_attempts set state = 'completed', failure = null, finished_at = now() where id = $1", [message.attemptId]);
        await client.query("update publication_targets set status = 'published', updated_at = now() where id = $1", [message.targetId]);
        const remaining = await client.query<{ count: string }>("select count(*) from publication_targets where publication_id = $1 and status <> 'published'", [message.publicationId]);
        if (Number(remaining.rows[0]?.count ?? 0) === 0) {
          await client.query("update publication_plans set state = 'published', published_at = coalesce(published_at, $2), updated_at = now(), version = version + 1 where id = $1", [message.publicationId, input.now]);
        }
      }
      await client.query("commit");
      return { committed: true, receipt };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async failOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; failure: PublicationFailure; retryAt?: string; deadLetter?: boolean }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const status = input.deadLetter ? "dead_lettered" : "pending";
      const result = await client.query<OutboxRow>(
        `update publication_outbox
         set status = $5,
             attempt_count = attempt_count + 1,
             available_at = coalesce($6, $4),
             retry_after = $6,
             last_failure_code = $7,
             updated_at = now(),
             claimed_by = null,
             claimed_at = null,
             lease_expires_at = null
         where outbox_message_id = $1
           and claimed_by = $2
           and fencing_token = $3
           and lease_expires_at > $4
           and exists (select 1 from publication_attempts where id = publication_outbox.attempt_id and state = 'running')
         returning *`,
        [input.outboxMessageId, input.workerId, input.fencingToken, input.now, status, input.retryAt ?? null, input.failure.code],
      );
      if (!result.rows[0]) {
        await client.query("rollback");
        return false;
      }
      const message = toOutbox(result.rows[0]);
      await client.query("insert into publication_failures (publication_id, failure) values ($1,$2)", [message.publicationId, JSON.stringify(input.failure)]);
      if (input.deadLetter) {
        await client.query("update publication_attempts set state = 'failed', failure = $2, finished_at = now() where id = $1", [message.attemptId, JSON.stringify(input.failure)]);
        await client.query("update publication_targets set status = 'failed', updated_at = now() where id = $1", [message.targetId]);
        await client.query("update publication_plans set state = 'failed', updated_at = now(), version = version + 1 where id = $1", [message.publicationId]);
        await client.query(
          "insert into publication_dead_letters (id, outbox_message_id, publication_id, target_id, provider_id, tenant_id, workspace_id, reason, last_error, attempts, last_failure_code, last_safe_message, dead_lettered_at, recovery_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')",
          [`${message.outboxMessageId}:dead-letter:${message.attemptCount}`, message.outboxMessageId, message.publicationId, message.targetId, message.providerId, message.tenantId, message.workspaceId, input.failure.message, JSON.stringify(input.failure), message.attemptCount, input.failure.code, input.failure.message, input.now],
        );
      }
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboxUnknown(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; reconciliationId: string; providerRequestId?: string; safeMessage: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<OutboxRow>(
        `update publication_outbox
         set status = 'failed',
             last_failure_code = 'UNKNOWN_OUTCOME',
             retry_after = null,
             claimed_by = null,
             claimed_at = null,
             lease_expires_at = null,
             updated_at = now()
         where outbox_message_id = $1
           and claimed_by = $2
           and fencing_token = $3
           and lease_expires_at > $4
           and exists (select 1 from publication_attempts where id = publication_outbox.attempt_id and state = 'running')
         returning *`,
        [input.outboxMessageId, input.workerId, input.fencingToken, input.now],
      );
      if (!result.rows[0]) {
        await client.query("rollback");
        return false;
      }
      const message = toOutbox(result.rows[0]);
      const failure: PublicationFailure = { code: "UNKNOWN_OUTCOME", message: input.safeMessage, category: "provider_unavailable", retryable: false };
      await client.query("update publication_attempts set state = 'unknown_outcome', failure = $2, finished_at = now() where id = $1", [message.attemptId, JSON.stringify(failure)]);
      await client.query("insert into publication_failures (publication_id, failure) values ($1,$2)", [message.publicationId, JSON.stringify(failure)]);
      await client.query("update publication_targets set status = 'unknown_outcome', updated_at = now() where id = $1", [message.targetId]);
      await client.query("update publication_plans set state = 'unknown_outcome', updated_at = now(), version = version + 1 where id = $1", [message.publicationId]);
      await client.query(
        "insert into publication_reconciliations (id, publication_id, target_id, attempt_id, outbox_message_id, tenant_id, workspace_id, provider_id, status, provider_request_id, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)",
        [input.reconciliationId, message.publicationId, message.targetId, message.attemptId, message.outboxMessageId, message.tenantId, message.workspaceId, message.providerId, input.providerRequestId ?? null, message.idempotencyKey],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseExpiredOutbox(now: string): Promise<number> {
    const result = await this.pool.query("update publication_outbox set status = 'pending', claimed_by = null, claimed_at = null, lease_expires_at = null, updated_at = now() where status = 'claimed' and lease_expires_at <= $1", [now]);
    return result.rowCount ?? 0;
  }

  async createCredentialReference(input: Omit<PublicationCredentialReference, "createdAt" | "updatedAt">): Promise<PublicationCredentialReference> {
    const result = await this.pool.query<CredentialReferenceRow>(
      `insert into publication_credential_references (credential_reference_id, tenant_id, workspace_id, provider_id, status, environment, provider_subject_id, scopes, expires_at, last_refreshed_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (credential_reference_id) do update
       set status = excluded.status,
           environment = excluded.environment,
           provider_subject_id = excluded.provider_subject_id,
           scopes = excluded.scopes,
           expires_at = excluded.expires_at,
           last_refreshed_at = excluded.last_refreshed_at,
           revoked_at = excluded.revoked_at,
           updated_at = now()
       returning *`,
      [input.credentialReferenceId, input.tenantId, input.workspaceId, input.providerId, input.status, input.environment ?? null, input.providerSubjectId ?? null, input.scopes ? [...input.scopes] : null, input.expiresAt ?? null, input.lastRefreshedAt ?? null, input.revokedAt ?? null],
    );
    return toCredentialReference(result.rows[0]);
  }

  async listCredentialReferences(filter: { tenantId: string; workspaceId: string; providerId?: string }): Promise<PublicationCredentialReference[]> {
    const result = await this.pool.query<CredentialReferenceRow>("select * from publication_credential_references where tenant_id = $1 and workspace_id = $2 and ($3::text is null or provider_id = $3) order by created_at", [filter.tenantId, filter.workspaceId, filter.providerId ?? null]);
    return result.rows.map(toCredentialReference);
  }

  async createReconciliation(input: Omit<PublicationReconciliation, "createdAt" | "updatedAt">): Promise<PublicationReconciliation> {
    const result = await this.pool.query<ReconciliationRow>("insert into publication_reconciliations (id, publication_id, target_id, attempt_id, outbox_message_id, tenant_id, workspace_id, provider_id, status, provider_request_id, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *", [input.id, input.publicationId, input.targetId, input.attemptId, input.outboxMessageId, input.tenantId, input.workspaceId, input.providerId, input.status, input.providerRequestId ?? null, input.idempotencyKey]);
    return toReconciliation(result.rows[0]);
  }

  async confirmReconciliationPublished(input: { reconciliationId: string; receiptId: string; receipt: Omit<PublicationReceipt, "id" | "createdAt">; now: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const reconciliationResult = await client.query<ReconciliationRow>("select * from publication_reconciliations where id = $1 and status = 'pending' for update", [input.reconciliationId]);
      const reconciliation = reconciliationResult.rows[0] ? toReconciliation(reconciliationResult.rows[0]) : undefined;
      if (!reconciliation) {
        await client.query("rollback");
        return false;
      }
      await client.query<ReceiptRow>(
        `insert into publication_receipts (id, publication_id, target_id, attempt_id, tenant_id, workspace_id, provider, provider_publication_id, provider_request_id, external_identifiers, channel, published_at, status, url, checksum, correlation_id, trace_id, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (publication_id, target_id, provider, idempotency_key) do update
         set provider_publication_id = publication_receipts.provider_publication_id`,
        [input.receiptId, input.receipt.publicationId, input.receipt.targetId, input.receipt.attemptId, input.receipt.tenantId, input.receipt.workspaceId, input.receipt.provider, input.receipt.providerPublicationId, input.receipt.providerRequestId ?? null, input.receipt.externalIdentifiers ? JSON.stringify(input.receipt.externalIdentifiers) : null, input.receipt.channel, input.receipt.publishedAt, input.receipt.status, input.receipt.url, input.receipt.checksum, input.receipt.correlationId, input.receipt.traceId, input.receipt.idempotencyKey],
      );
      await client.query("update publication_attempts set state = 'completed', failure = null, finished_at = now() where id = $1", [reconciliation.attemptId]);
      await client.query("update publication_targets set status = 'published', updated_at = now() where id = $1", [reconciliation.targetId]);
      await client.query("update publication_reconciliations set status = 'confirmed_published', updated_at = now() where id = $1", [reconciliation.id]);
      const remaining = await client.query<{ count: string }>("select count(*) from publication_targets where publication_id = $1 and status <> 'published'", [reconciliation.publicationId]);
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        await client.query("update publication_plans set state = 'published', published_at = coalesce(published_at, $2), updated_at = now(), version = version + 1 where id = $1", [reconciliation.publicationId, input.now]);
      }
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmReconciliationNotPublished(input: { reconciliationId: string; now: string; failure: PublicationFailure }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const reconciliationResult = await client.query<ReconciliationRow>("select * from publication_reconciliations where id = $1 and status = 'pending' for update", [input.reconciliationId]);
      const reconciliation = reconciliationResult.rows[0] ? toReconciliation(reconciliationResult.rows[0]) : undefined;
      if (!reconciliation) {
        await client.query("rollback");
        return false;
      }
      await client.query("update publication_attempts set state = 'failed', failure = $2, finished_at = now() where id = $1", [reconciliation.attemptId, JSON.stringify(input.failure)]);
      await client.query("insert into publication_failures (publication_id, failure) values ($1,$2)", [reconciliation.publicationId, JSON.stringify(input.failure)]);
      await client.query("update publication_targets set status = 'failed', updated_at = now() where id = $1", [reconciliation.targetId]);
      await client.query("update publication_plans set state = 'failed', updated_at = now(), version = version + 1 where id = $1", [reconciliation.publicationId]);
      await client.query("update publication_reconciliations set status = 'confirmed_not_published', updated_at = now() where id = $1", [reconciliation.id]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateReconciliationStatus(input: { id: string; status: PublicationReconciliation["status"] }): Promise<PublicationReconciliation> {
    const result = await this.pool.query<ReconciliationRow>("update publication_reconciliations set status = $2, updated_at = now() where id = $1 returning *", [input.id, input.status]);
    if (!result.rows[0]) throw new Error(`PUBLICATION_RECONCILIATION_NOT_FOUND: reconciliation "${input.id}" não existe.`);
    return toReconciliation(result.rows[0]);
  }

  async listReconciliations(filter: { tenantId: string; workspaceId: string; status?: PublicationReconciliation["status"] }): Promise<PublicationReconciliation[]> {
    const result = await this.pool.query<ReconciliationRow>("select * from publication_reconciliations where tenant_id = $1 and workspace_id = $2 and ($3::text is null or status = $3) order by created_at, id", [filter.tenantId, filter.workspaceId, filter.status ?? null]);
    return result.rows.map(toReconciliation);
  }

  async createReceiptVerification(input: Omit<PublicationReceiptVerification, "verifiedAt">): Promise<PublicationReceiptVerification> {
    const result = await this.pool.query<ReceiptVerificationRow>("insert into publication_receipt_verifications (id, receipt_id, publication_id, target_id, tenant_id, workspace_id, provider_id, verification_status, external_status, checksum, details_code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *", [input.id, input.receiptId, input.publicationId, input.targetId, input.tenantId, input.workspaceId, input.providerId, input.verificationStatus, input.externalStatus ?? null, input.checksum, input.detailsCode ?? null]);
    return toReceiptVerification(result.rows[0]);
  }

  async listReceiptVerifications(filter: { tenantId: string; workspaceId: string; publicationId?: string }): Promise<PublicationReceiptVerification[]> {
    const result = await this.pool.query<ReceiptVerificationRow>("select * from publication_receipt_verifications where tenant_id = $1 and workspace_id = $2 and ($3::text is null or publication_id = $3) order by verified_at, id", [filter.tenantId, filter.workspaceId, filter.publicationId ?? null]);
    return result.rows.map(toReceiptVerification);
  }
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toPlan(row: PlanRow): PublicationPlan {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, state: row.state as PublicationState, mode: row.mode as never, idempotencyKey: row.idempotency_key, sourceExecutionRunId: row.source_execution_run_id ?? undefined, sourceArtifacts: row.source_artifacts, policy: row.policy, correlationId: row.correlation_id, causationId: row.causation_id ?? undefined, traceId: row.trace_id, scheduledAt: iso(row.scheduled_at), timezone: row.timezone ?? undefined, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at), approvedAt: iso(row.approved_at), publishedAt: iso(row.published_at), cancelledAt: iso(row.cancelled_at), version: row.version };
}
function toCandidate(row: CandidateRow): PublicationCandidate {
  return { id: row.id, publicationId: row.publication_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, content: row.content, assets: row.assets, metadata: row.metadata, createdAt: requiredIso(row.created_at) };
}
function toTarget(row: TargetRow): PublicationTarget {
  return { id: row.id, publicationId: row.publication_id, candidateId: row.candidate_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, channel: row.channel as never, provider: row.provider as never, mode: row.mode as never, status: row.status as never, idempotencyKey: row.idempotency_key, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toApproval(row: ApprovalRow): PublicationApproval {
  return { id: row.id, publicationId: row.publication_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, approvedByUserId: row.approved_by_user_id, reason: row.reason, notes: row.notes ?? undefined, createdAt: requiredIso(row.created_at) };
}
function toAttempt(row: AttemptRow): PublicationAttempt {
  return { id: row.id, publicationId: row.publication_id, targetId: row.target_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, provider: row.provider as never, channel: row.channel as never, attemptNumber: row.attempt_number, state: row.state as never, idempotencyKey: row.idempotency_key, startedAt: requiredIso(row.started_at), finishedAt: iso(row.finished_at), failure: row.failure ?? undefined };
}
function toReceipt(row: ReceiptRow): PublicationReceipt {
  return { id: row.id, publicationId: row.publication_id, targetId: row.target_id, attemptId: row.attempt_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, provider: row.provider as never, providerPublicationId: row.provider_publication_id, providerRequestId: row.provider_request_id ?? undefined, externalIdentifiers: row.external_identifiers ?? undefined, channel: row.channel as never, publishedAt: requiredIso(row.published_at), status: row.status as never, url: row.url, checksum: row.checksum, correlationId: row.correlation_id, traceId: row.trace_id, idempotencyKey: row.idempotency_key, createdAt: requiredIso(row.created_at) };
}
function toEvent(row: EventRow): PublicationEvent {
  return { id: row.id, publicationId: row.publication_id, eventType: row.event_type as never, targetId: row.target_id ?? undefined, attemptId: row.attempt_id ?? undefined, receiptId: row.receipt_id ?? undefined, correlationId: row.correlation_id ?? undefined, causationId: row.causation_id ?? undefined, traceId: row.trace_id ?? undefined, createdAt: requiredIso(row.created_at), payload: row.payload ?? undefined };
}
function toSchedule(row: ScheduleRow): PublicationSchedule {
  return { id: row.id, publicationId: row.publication_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scheduledAt: requiredIso(row.scheduled_at), timezone: row.timezone, status: row.status as PublicationScheduleState, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toLock(row: LockRow): PublicationLock {
  return { publicationId: row.publication_id, ownerId: row.owner_id, acquiredAt: requiredIso(row.acquired_at), expiresAt: requiredIso(row.expires_at) };
}
function toDeadLetter(row: DeadLetterRow): PublicationDeadLetter {
  return { id: row.id, outboxMessageId: row.outbox_message_id ?? undefined, publicationId: row.publication_id, targetId: row.target_id ?? undefined, providerId: row.provider_id as never ?? undefined, tenantId: row.tenant_id, workspaceId: row.workspace_id, reason: row.reason, lastError: row.last_error, attempts: row.attempts, lastFailureCode: row.last_failure_code ?? undefined, lastSafeMessage: row.last_safe_message ?? undefined, deadLetteredAt: iso(row.dead_lettered_at), recoveryStatus: row.recovery_status as never ?? undefined, createdAt: requiredIso(row.created_at) };
}
function toPayloadReference(row: PayloadReferenceRow): PublicationPayloadReference {
  return { id: row.id, publicationId: row.publication_id, targetId: row.target_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, version: row.version, contentChecksum: row.content_checksum, payload: row.payload, assets: row.assets, sizeBytes: row.size_bytes, createdAt: requiredIso(row.created_at) };
}
function toOutbox(row: OutboxRow): PublicationOutboxMessage {
  return { outboxMessageId: row.outbox_message_id, publicationId: row.publication_id, targetId: row.target_id, attemptId: row.attempt_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, credentialReferenceId: row.credential_reference_id ?? undefined, idempotencyKey: row.idempotency_key, payloadReference: row.payload_reference, status: row.status as never, attemptCount: row.attempt_count, availableAt: requiredIso(row.available_at), claimedBy: row.claimed_by ?? undefined, claimedAt: iso(row.claimed_at), leaseExpiresAt: iso(row.lease_expires_at), fencingToken: row.fencing_token, lastFailureCode: row.last_failure_code ?? undefined, retryAfter: iso(row.retry_after), createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toCredentialReference(row: CredentialReferenceRow): PublicationCredentialReference {
  return { credentialReferenceId: row.credential_reference_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, status: row.status as never, environment: row.environment as never ?? undefined, providerSubjectId: row.provider_subject_id ?? undefined, scopes: row.scopes ?? undefined, expiresAt: iso(row.expires_at), lastRefreshedAt: iso(row.last_refreshed_at), revokedAt: iso(row.revoked_at), createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toReconciliation(row: ReconciliationRow): PublicationReconciliation {
  return { id: row.id, publicationId: row.publication_id, targetId: row.target_id, attemptId: row.attempt_id, outboxMessageId: row.outbox_message_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, status: row.status as never, providerRequestId: row.provider_request_id ?? undefined, idempotencyKey: row.idempotency_key, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toReceiptVerification(row: ReceiptVerificationRow): PublicationReceiptVerification {
  return { id: row.id, receiptId: row.receipt_id, publicationId: row.publication_id, targetId: row.target_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, verifiedAt: requiredIso(row.verified_at), verificationStatus: row.verification_status as never, externalStatus: row.external_status ?? undefined, checksum: row.checksum, detailsCode: row.details_code ?? undefined };
}
