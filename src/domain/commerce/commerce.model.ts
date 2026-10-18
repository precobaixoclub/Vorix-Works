/** Fronteira futura: Order é uma venda transacional, não Opportunity nem um novo Customer. */
export type CommerceOrderOrigin={tenantId:string;workspaceId:string;contactId:string;proposalId?:string;acceptedProposalVersion?:number;acceptedContentHash?:string};
export type CommerceOrderLine={productId:string;variantId?:string;quantity:number;unitPriceCents:number;nameSnapshot:string;attributesSnapshot:Readonly<Record<string,string|number|boolean>>};
export const ORDER_STATES=["pending","confirmed","processing","shipped","delivered","cancelled"] as const;
export type CommerceOrderState=(typeof ORDER_STATES)[number];
const transitions:Record<CommerceOrderState,readonly CommerceOrderState[]>={pending:["confirmed","cancelled"],confirmed:["processing","cancelled"],processing:["shipped","cancelled"],shipped:["delivered"],delivered:[],cancelled:[]};
export function assertCommerceTransition(from:CommerceOrderState,to:CommerceOrderState):void{if(from!==to&&!transitions[from].includes(to))throw Error("COMMERCE_TRANSITION_INVALID");}
export type CommerceProviderReference={tenantId:string;paymentProviderKey?:string;paymentSecretRef?:string;shippingProviderKey?:string;shippingSecretRef?:string};
