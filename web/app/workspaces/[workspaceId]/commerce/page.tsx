import {redirect} from "next/navigation";
export default async function LegacyCommercePage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;redirect(`/workspaces/${encodeURIComponent(workspaceId)}/site`);}
