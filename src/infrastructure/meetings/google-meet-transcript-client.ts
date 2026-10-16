import type { GoogleMeetNativeTranscript, GoogleMeetTranscriptPort } from "../../application/meetings/meet-native-import.js";

/**
 * Google Meet REST API (v2) — transcrição NATIVA do Meet (quando a reunião teve "Transcrição"
 * ligada numa conta Google Workspace). Lê só texto + quem falou: escopo
 * `https://www.googleapis.com/auth/meetings.space.readonly` (sem Drive, sem baixar arquivo).
 */
type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
type Transcript = { name: string; state?: string; startTime?: string; endTime?: string };
type TranscriptEntry = { participant?: string; text?: string; languageCode?: string; startTime?: string; endTime?: string };
type Participant = { signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } };

export class GoogleMeetApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class GoogleMeetTranscriptClient implements GoogleMeetTranscriptPort {
  constructor(private readonly input: { apiBaseUrl?: string; httpClient?: typeof fetch } = {}) {}

  async findTranscript(input: { accessToken: string; meetingCode: string; notBefore?: string; notAfter?: string; around?: string }): Promise<GoogleMeetNativeTranscript | { unavailable: "no_access" | "not_found" | "not_ready"; message: string }> {
    const records: ConferenceRecord[] = [];
    try {
      let pageToken: string | undefined;
      do {
        const url = new URL(`${this.base()}/conferenceRecords`);
        url.searchParams.set("filter", `space.meeting_code = "${input.meetingCode}"`);
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const page = await this.get<{ conferenceRecords?: ConferenceRecord[]; nextPageToken?: string }>(url, input.accessToken);
        records.push(...(page.conferenceRecords ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && records.length < 500);
    } catch (error) {
      if (error instanceof GoogleMeetApiError && (error.status === 401 || error.status === 403)) {
        return { unavailable: "no_access", message: "Reconecte o Google em Meetings → Integrações para permitir a leitura das transcrições do Meet." };
      }
      throw error;
    }
    const notBefore = input.notBefore ? Date.parse(input.notBefore) : 0;
    const notAfter = input.notAfter ? Date.parse(input.notAfter) : Number.POSITIVE_INFINITY;
    const around = input.around ? Date.parse(input.around) : undefined;
    const candidates = records
      .filter((record) => record.endTime && Date.parse(record.endTime) >= notBefore && Date.parse(record.startTime ?? record.endTime) <= notAfter)
      // Reunião recorrente: a ocorrência mais próxima do horário agendado primeiro.
      .sort((a, b) => (around !== undefined ? Math.abs(Date.parse(a.startTime ?? "") - around) - Math.abs(Date.parse(b.startTime ?? "") - around) : Date.parse(b.startTime ?? "") - Date.parse(a.startTime ?? "")));
    if (!candidates.length) return { unavailable: records.length ? "not_ready" : "not_found", message: records.length ? "A reunião ainda não terminou no Google Meet." : "O Google Meet não tem registro desta reunião para a sua conta." };

    for (const record of candidates) {
      const transcripts = (await this.get<{ transcripts?: Transcript[] }>(new URL(`${this.base()}/${record.name}/transcripts`), input.accessToken)).transcripts ?? [];
      const transcript = transcripts.find((item) => item.state === "FILE_GENERATED" || item.state === "ENDED");
      if (!transcript) continue;
      const entries: TranscriptEntry[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL(`${this.base()}/${transcript.name}/entries`);
        url.searchParams.set("pageSize", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const page = await this.get<{ transcriptEntries?: TranscriptEntry[]; nextPageToken?: string }>(url, input.accessToken);
        entries.push(...(page.transcriptEntries ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && entries.length < 20_000);

      const names = new Map<string, string>();
      for (const participant of new Set(entries.map((entry) => entry.participant).filter((name): name is string => !!name))) {
        try {
          const info = await this.get<Participant>(new URL(`${this.base()}/${participant}`), input.accessToken);
          const display = info.signedinUser?.displayName ?? info.anonymousUser?.displayName ?? info.phoneUser?.displayName;
          if (display) names.set(participant, display);
        } catch {
          // Participante sem nome legível: fica "Participante N".
        }
      }
      const origin = Date.parse(record.startTime ?? transcript.startTime ?? entries[0]?.startTime ?? new Date().toISOString());
      const anonymous = new Map<string, string>();
      const label = (participant?: string) => {
        if (!participant) return undefined;
        if (names.has(participant)) return names.get(participant);
        if (!anonymous.has(participant)) anonymous.set(participant, `Participante ${anonymous.size + 1}`);
        return anonymous.get(participant);
      };
      return {
        conferenceRecord: record.name,
        transcriptName: transcript.name,
        startedAt: new Date(origin).toISOString(),
        ...(record.endTime ? { endedAt: record.endTime } : {}),
        language: entries.find((entry) => entry.languageCode)?.languageCode?.slice(0, 2) ?? "pt",
        entries: entries
          .filter((entry) => entry.text?.trim() && entry.startTime)
          .map((entry) => {
            const startMs = Math.max(0, Date.parse(entry.startTime!) - origin);
            const endMs = Math.max(startMs, entry.endTime ? Date.parse(entry.endTime) - origin : startMs);
            const speaker = label(entry.participant);
            return { startMs, endMs, text: entry.text!.trim(), ...(speaker ? { speaker } : {}) };
          }),
      };
    }
    return { unavailable: "not_found", message: "Esta reunião não teve a transcrição do Google Meet ligada (ou ela ainda está sendo gerada)." };
  }

  private async get<T>(url: URL, accessToken: string): Promise<T> {
    const response = await (this.input.httpClient ?? fetch)(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) throw new GoogleMeetApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    return json;
  }

  private base(): string {
    return this.input.apiBaseUrl ?? "https://meet.googleapis.com/v2";
  }
}
