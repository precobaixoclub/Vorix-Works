import type { Metadata } from "next";

export function publicMetadata(title: string, description: string, path: string): Metadata {
  return {
    title, description, alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: "Vorix", locale: "pt_BR", type: "website", images: [{ url: "/public-og", width: 1200, height: 630, alt: "Vorix — Conversas e Meetings" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/public-og"] },
  };
}
