import type { ExecutionFailure } from "../../domain/execution/execution.model.js";

export type ExecutionRetryPolicy = {
  maxAttempts: number;
};

export const DEFAULT_EXECUTION_RETRY_POLICY: ExecutionRetryPolicy = { maxAttempts: 2 };

export function canRetryExecutionFailure(failure: ExecutionFailure, attemptNumber: number, policy: ExecutionRetryPolicy = DEFAULT_EXECUTION_RETRY_POLICY): boolean {
  if (!["timeout", "provider_unavailable", "rate_limited"].includes(failure.category) || !failure.retryable) return false;
  return attemptNumber < policy.maxAttempts;
}
