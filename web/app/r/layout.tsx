import type { Metadata } from "next";

/** Links de reunião compartilhada nunca entram em buscadores. */
export const metadata: Metadata = { title: "Reunião compartilhada · Vorix", robots: { index: false, follow: false } };

export default function SharedMeetingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
