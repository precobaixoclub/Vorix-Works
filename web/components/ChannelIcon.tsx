"use client";

import { Camera, Globe2, Megaphone, MessageCircle, Music2, UsersRound, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChannelKey = "instagram" | "facebook" | "tiktok" | "youtube" | "whatsapp" | "meta" | string;

export const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  whatsapp: "WhatsApp",
  meta: "Meta",
};

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  instagram: Camera,
  facebook: UsersRound,
  tiktok: Music2,
  youtube: Video,
  whatsapp: MessageCircle,
  meta: Megaphone,
};

export function channelLabel(channel: ChannelKey | undefined): string {
  if (!channel) return "Canal";
  return CHANNEL_LABELS[channel.toLowerCase()] ?? channel;
}

export function ChannelIcon({
  channel,
  label,
  showLabel = false,
  className,
  iconClassName,
}: {
  channel: ChannelKey | undefined;
  label?: string;
  showLabel?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const normalized = channel?.toLowerCase() ?? "";
  const Icon = CHANNEL_ICONS[normalized] ?? Globe2;
  const text = label ?? channelLabel(normalized);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} aria-hidden />
      {showLabel ? <span className="truncate">{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}
