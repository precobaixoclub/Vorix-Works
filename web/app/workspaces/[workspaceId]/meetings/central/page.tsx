"use client";

import { MeetingsCentral } from "@/components/meetings/MeetingsCentral";

/** Central de Reuniões — todas as reuniões do workspace, de qualquer origem. */
export default function MeetingsCentralPage() {
  return <MeetingsCentral mode="all" />;
}
