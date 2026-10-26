"use client";

import { ChannelIcon } from "@/components/ChannelIcon";
import { cn } from "@/lib/utils";
import { NETWORK_LABEL, NETWORK_TONE, TONE_CLASS, type Tone } from "./presentation";
import type { SocialNetwork } from "./types";

/** Ícone da rede numa placa com o acento da rede (vocabulário fechado do design system). */
export function NetworkMark({ network, size = "md", className }: { network: SocialNetwork; size?: "sm" | "md" | "lg"; className?: string }) {
  const tone = TONE_CLASS[NETWORK_TONE[network]];
  const box = size === "sm" ? "h-6 w-6 rounded-md" : size === "lg" ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-lg";
  const icon = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center border", box, tone.badge, className)}>
      <ChannelIcon channel={network} label={NETWORK_LABEL[network]} iconClassName={icon} />
    </span>
  );
}

export function StatePill({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[tone].badge, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_CLASS[tone].dot)} />
      {label}
    </span>
  );
}

export function AccountAvatar({ name, avatarUrl, network }: { name: string; avatarUrl?: string; network: SocialNetwork }) {
  if (!avatarUrl) return <NetworkMark network={network} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt={name} className="h-9 w-9 shrink-0 rounded-full border border-border object-cover" referrerPolicy="no-referrer" />
  );
}
