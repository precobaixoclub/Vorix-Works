/** Reuniões usa a mesma política do app (lib/swr-retry) — nomes mantidos por compatibilidade. */
export { APP_SWR_RETRY as MEETINGS_RETRY, MAX_SWR_RETRIES as MEETINGS_MAX_RETRIES, shouldRetryRequest as shouldRetryMeetingsRequest } from "@/lib/swr-retry";
