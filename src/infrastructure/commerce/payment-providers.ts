import {randomUUID} from "node:crypto";
import type {CreateProviderPaymentInput,PaymentProviderContext,PaymentProviderPort,ProviderPaymentState} from "../../application/ports/commerce-ports.js";
import type {PaymentStatus} from "../../domain/commerce/order.model.js";

/**
 * Pagamento de TESTE (homologação/QA). Nunca cobra ninguém: cria uma cobrança pendente marcada como
 * sandbox. A confirmação só acontece por uma ação autenticada do lojista (simular aprovação), que
 * passa pelo MESMO caminho de atualização de um webhook real.
 */
export class SandboxPaymentProvider implements PaymentProviderPort{
 readonly key="SANDBOX" as const;readonly methods=["SANDBOX","PIX"] as const;readonly partialRefund=true;
 async createPayment(_context:PaymentProviderContext,input:CreateProviderPaymentInput):Promise<ProviderPaymentState>{
  const id=`sandbox-${randomUUID()}`;
  return {providerPaymentId:id,status:"PENDING",instructions:{sandbox:true,expiresAt:input.expiresAt,pixQrCode:`SANDBOX-VORIX-PEDIDO-${input.orderNumber}-NAO-PAGAR`}};
 }
 async getPayment(_context:PaymentProviderContext,providerPaymentId:string):Promise<ProviderPaymentState>{return {providerPaymentId,status:"PENDING"};}
 async refund(_context:PaymentProviderContext,providerPaymentId:string):Promise<ProviderPaymentState>{return {providerPaymentId,status:"REFUNDED"};}
 async cancel(_context:PaymentProviderContext,providerPaymentId:string):Promise<ProviderPaymentState>{return {providerPaymentId,status:"CANCELLED"};}
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
const MP_STATUS:Record<string,PaymentStatus>={approved:"APPROVED",authorized:"PENDING",pending:"PENDING",in_process:"PENDING",in_mediation:"PENDING",rejected:"FAILED",cancelled:"CANCELLED",refunded:"REFUNDED",charged_back:"REFUNDED"};
/** Mercado Pago com a conta do LOJISTA (access token do próprio cliente do Vorix, guardado no cofre). */
export class MercadoPagoPaymentProvider implements PaymentProviderPort{
 readonly key="MERCADO_PAGO" as const;readonly methods=["PIX","CARD"] as const;
 /** POST /v1/payments/{id}/refunds aceita `amount` menor que o total (estorno parcial). */
 readonly partialRefund=true;
 constructor(private readonly options:{fetch?:FetchLike;baseUrl?:string}={}){}
 private async call(context:PaymentProviderContext,path:string,init:RequestInit&{idempotencyKey?:string}={}){
  const token=context.credentials?.accessToken;if(!token)throw Error("PAYMENT_PROVIDER_NOT_CONFIGURED: conecte a conta do Mercado Pago.");
  const response=await (this.options.fetch??fetch)(`${this.options.baseUrl??"https://api.mercadopago.com"}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(init.idempotencyKey?{"X-Idempotency-Key":init.idempotencyKey}:{})},signal:AbortSignal.timeout(20000)});
  const body=(await response.json().catch(()=>({}))) as Record<string,any>;
  if(!response.ok)throw Error(`PAYMENT_PROVIDER_ERROR: ${response.status} ${typeof body?.message==="string"?body.message.slice(0,200):"falha no Mercado Pago"}`);
  return body as Record<string,any>;
 }
 private state(body:Record<string,any>):ProviderPaymentState{
  const data=body.point_of_interaction?.transaction_data;
  return {providerPaymentId:String(body.id),status:MP_STATUS[String(body.status)]??"PENDING",failureReason:body.status==="rejected"?String(body.status_detail??"rejected"):undefined,
   instructions:data?{pixQrCode:data.qr_code,pixQrCodeBase64:data.qr_code_base64,pixTicketUrl:data.ticket_url,expiresAt:body.date_of_expiration??undefined}:undefined};
 }
 async createPayment(context:PaymentProviderContext,input:CreateProviderPaymentInput){
  if(input.currency!=="BRL")throw Error("PAYMENT_VALIDATION: o Mercado Pago Brasil aceita pagamentos em reais (BRL).");
  const [firstName,...rest]=input.customer.name.trim().split(/\s+/);
  const payer={email:input.customer.email,first_name:firstName,last_name:rest.join(" ")||undefined,...(input.customer.document?{identification:{type:input.customer.document.length===14?"CNPJ":"CPF",number:input.customer.document}}:{})};
  const base={transaction_amount:input.amountCents/100,description:input.description.slice(0,200),external_reference:input.orderId,notification_url:input.notificationUrl,payer};
  const body=input.method==="PIX"
   ?{...base,payment_method_id:"pix",date_of_expiration:input.expiresAt}
   :{...base,token:input.cardToken,installments:input.installments??1,payment_method_id:input.cardPaymentMethodId};
  if(input.method==="CARD"&&!input.cardToken)throw Error("PAYMENT_VALIDATION: os dados do cartão não foram validados. Tente novamente.");
  return this.state(await this.call(context,"/v1/payments",{method:"POST",body:JSON.stringify(body),idempotencyKey:input.idempotencyKey}));
 }
 async getPayment(context:PaymentProviderContext,providerPaymentId:string){return this.state(await this.call(context,`/v1/payments/${encodeURIComponent(providerPaymentId)}`));}
 async refund(context:PaymentProviderContext,providerPaymentId:string,amountCents:number,idempotencyKey?:string){
  // Chave por estorno: dois estornos parciais diferentes nunca são confundidos com repetição.
  await this.call(context,`/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`,{method:"POST",body:JSON.stringify({amount:amountCents/100}),idempotencyKey:idempotencyKey??`refund-${providerPaymentId}`});
  return this.getPayment(context,providerPaymentId);
 }
 async cancel(context:PaymentProviderContext,providerPaymentId:string){return this.state(await this.call(context,`/v1/payments/${encodeURIComponent(providerPaymentId)}`,{method:"PUT",body:JSON.stringify({status:"cancelled"})}));}
}
