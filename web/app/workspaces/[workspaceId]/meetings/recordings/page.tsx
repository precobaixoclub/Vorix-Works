import { redirect } from "next/navigation";

/**
 * Fase 9: "Gravações" e "Reuniões" eram a MESMA lista (a Central) com um filtro fixo. Agora há uma
 * biblioteca só, em `/meetings/central`; o endereço antigo continua valendo e abre a visão "Gravadas".
 */
export default async function MeetingsRecordingsRedirect({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/workspaces/${encodeURIComponent(workspaceId)}/meetings/central?visao=gravadas`);
}
