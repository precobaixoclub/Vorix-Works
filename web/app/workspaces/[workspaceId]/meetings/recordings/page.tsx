"use client";

import { MeetingsCentral } from "@/components/meetings/MeetingsCentral";

/** Gravações — a Central com o filtro de gravação fixo; acesso às gravações sem passar pela Agenda. */
export default function MeetingsRecordingsPage() {
  return <MeetingsCentral mode="recordings" />;
}
