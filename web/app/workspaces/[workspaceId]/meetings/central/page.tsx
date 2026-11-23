"use client";

import { Suspense } from "react";
import { MeetingsCentral } from "@/components/meetings/MeetingsCentral";

/** Gravações — a biblioteca única de reuniões do workspace (visões por `?visao=`). */
export default function MeetingsCentralPage() {
  return <Suspense><MeetingsCentral /></Suspense>;
}
