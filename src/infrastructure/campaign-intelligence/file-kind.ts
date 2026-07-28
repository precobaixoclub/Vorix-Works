import type { CampaignFileKind } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";

/** Roteamento de extensão → pipeline (seção 2) — cada tipo aceito tem um pipeline próprio dedicado. */
const EXTENSION_TO_KIND: Record<string, CampaignFileKind> = {
  ".png": "photo", ".jpg": "photo", ".jpeg": "photo", ".webp": "photo", ".gif": "photo", ".svg": "svg",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
  ".pdf": "pdf",
  ".ppt": "ppt", ".pptx": "ppt",
  ".doc": "docx", ".docx": "docx",
  ".xls": "xlsx", ".xlsx": "xlsx",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio",
  ".zip": "zip",
};

export function detectFileKind(extension: string): CampaignFileKind {
  return EXTENSION_TO_KIND[extension.toLowerCase()] ?? "unsupported";
}
