import type {InboxUseCaseDeps} from "../inbox/inbox-use-cases.js";
import type {InboxConversation} from "../../domain/inbox/inbox.model.js";
/** Conversa do mesmo tenant/workspace; qualquer outra coisa é "não encontrada" (nunca vaza existência). */
export async function mustConversationInWorkspace(deps:Pick<InboxUseCaseDeps,"conversationRepository">,input:{tenantId:string;workspaceId:string;conversationId:string}):Promise<InboxConversation>{
 const conversation=await deps.conversationRepository.getById(input.conversationId);
 if(!conversation||conversation.tenantId!==input.tenantId||conversation.workspaceId!==input.workspaceId)throw Error("CONVERSATION_PRODUCT_NOT_FOUND: conversa não encontrada.");
 return conversation;
}
