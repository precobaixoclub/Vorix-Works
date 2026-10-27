import type {Pool} from "pg";
import type {SiteAnalyticsQuery,SiteAnalyticsRepositoryPort} from "../../../application/ports/site-analytics-repository.port.js";
import {conversionRate,type AnalyticsGroup,type AnalyticsMetric,type SiteAnalyticsReport} from "../../../domain/sites/site-analytics.js";

const ENTITY_TYPES=["INTENT","INTENT_LINKED","CONTACT","CONTACT_OPPORTUNITY","CONVERSATION","OPPORTUNITY","OPPORTUNITY_WON","SALE","ORDER"];
function activityQuery(input:SiteAnalyticsQuery){
 const {scope,filters,range}=input;
 const params:unknown[]=[scope.tenantId,scope.workspaceId,range.start,range.end,filters.siteId??null,scope.global,scope.ownerUserIds,scope.teamIds,range.timezone,filters.productId??null,filters.categoryId??null,filters.source??null,filters.campaign??null];
 const sql=`with recursive category_tree as (
 select id from product_categories where tenant_id=$1 and workspace_id=$2 and id=$11
 union all select c.id from product_categories c join category_tree p on c.parent_id=p.id where c.tenant_id=$1 and c.workspace_id=$2
 ), visible_intents as (
 select s.*,d.created_at opportunity_at,d.status deal_status,d.closed_at,d.won_at,d.final_value_cents,d.value_cents,d.currency deal_currency,d.final_snapshot
 from sales_intents s join tenant_sites site on site.id=s.site_id and site.tenant_id=s.tenant_id and site.workspace_id=s.workspace_id
 left join deals d on d.id=s.deal_id and d.tenant_id=s.tenant_id and d.workspace_id=s.workspace_id
 left join inbox_conversations c on c.id=s.conversation_id and c.tenant_id=s.tenant_id and c.workspace_id=s.workspace_id
 where s.tenant_id=$1 and s.workspace_id=$2 and ($5::text is null or s.site_id=$5)
 and ($6::boolean or d.owner_user_id=any($7::text[]) or d.team_id=any($8::text[]) or c.assigned_user_id=any($7::text[]) or c.current_team_id=any($8::text[]))
 ), intent_items as (
 select s.*,item.value as item,item.ordinality=1 as primary_row,
 coalesce(item.value->>'productId',s.product_id,'') product_key,
 case when s.anonymous_session_id is not null then s.site_id||':a:'||s.anonymous_session_id else '' end actor,
 coalesce(case when coalesce(nullif(s.utm_source,''),nullif(s.utm_medium,''),nullif(s.utm_campaign,''),nullif(s.utm_content,''),nullif(s.utm_term,'')) is null then entry.dimensions else jsonb_strip_nulls(jsonb_build_object('referrer',entry.dimensions->'referrer')) end,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('source',nullif(s.utm_source,''),'medium',nullif(s.utm_medium,''),'campaign',nullif(s.utm_campaign,''),'content',nullif(s.utm_content,''),'term',nullif(s.utm_term,''))) dimensions
 from visible_intents s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.snapshot->'items')='array' and jsonb_array_length(s.snapshot->'items')>0 then s.snapshot->'items' else '[{}]'::jsonb end) with ordinality item(value,ordinality)
 left join lateral(select b.dimensions from site_analytics_buckets b where b.site_id=s.site_id and b.tenant_id=$1 and b.workspace_id=$2 and b.actor='a:'||s.anonymous_session_id and b.type='SITE_VIEW' and b.bucket<=s.created_at and b.bucket>s.created_at-interval '30 days' order by b.bucket desc limit 1)entry on true
 ), raw_activity as (
 select b.site_id,b.bucket as at,b.type,b.actor,b.product_key,b.dimensions,b.count as n,''::text entity,true primary_row,null::numeric amount,''::text currency,null::numeric product_amount
 from site_analytics_buckets b where b.tenant_id=$1 and b.workspace_id=$2 and b.bucket >=$3::timestamptz and b.bucket<$4::timestamptz and ($5::text is null or b.site_id=$5)
 and ($6::boolean or (exists(select 1 from visible_intents s where s.site_id=b.site_id and 'a:'||s.anonymous_session_id=b.actor) and not exists(select 1 from site_analytics_identities m where m.site_id=b.site_id and 'a:'||m.anonymous_session_id=b.actor and m.ambiguous)))
 union all
 select i.site_id,stage.at,stage.type,case when i.actor='' then '' else substring(i.actor from length(i.site_id)+2) end,i.product_key,i.dimensions,1,stage.entity,i.primary_row,null::numeric,'',null::numeric from intent_items i
 cross join lateral (values
 ('INTENT',i.created_at,i.id),
 ('INTENT_LINKED',case when i.contact_id is not null then i.created_at end,i.id),
 ('CONTACT',case when i.contact_id is not null then coalesce(i.converted_at,i.created_at) end,i.contact_id),
 ('CONVERSATION',case when i.conversation_id is not null or i.attendance_id is not null then coalesce(i.converted_at,i.created_at) end,coalesce(i.attendance_id,i.conversation_id)),
 ('OPPORTUNITY',i.opportunity_at,i.deal_id),
 ('OPPORTUNITY_WON',case when i.deal_status='won' then i.opportunity_at end,i.deal_id),
 ('CONTACT_OPPORTUNITY',case when i.deal_id is not null then i.opportunity_at end,i.contact_id)
 ) stage(type,at,entity) where stage.at is not null and stage.entity is not null
 union all
 select i.site_id,coalesce(i.closed_at,i.won_at),'SALE',case when i.actor='' then '' else substring(i.actor from length(i.site_id)+2) end,i.product_key,i.dimensions,1,'crm:'||i.deal_id,i.primary_row,
 case when i.primary_row then coalesce(i.final_value_cents,i.value_cents)::numeric end,i.deal_currency,
 case when i.primary_row and jsonb_array_length(i.snapshot->'items')=1 and jsonb_array_length(coalesce(i.final_snapshot->'items','[]'::jsonb))=1 and i.final_snapshot->'items'->0->>'productId'=i.product_key then coalesce(i.final_value_cents,i.value_cents)::numeric end
 from intent_items i where i.deal_status='won'
 and not exists(select 1 from sales_intents other where other.tenant_id=i.tenant_id and other.workspace_id=i.workspace_id and other.deal_id=i.deal_id and (other.created_at,other.id)<(i.created_at,i.id))
 and not exists(select 1 from site_analytics_order_facts o where o.tenant_id=$1 and o.workspace_id=$2 and o.opportunity_id=i.deal_id and o.paid_at is not null)
 union all
 select o.site_id,stage.at,stage.type,coalesce(o.actor,''),coalesce(item.product_id,''),coalesce(case when o.utm='{}'::jsonb then entry.dimensions else jsonb_strip_nulls(jsonb_build_object('referrer',entry.dimensions->'referrer')) end,'{}'::jsonb)||o.utm,1,'order:'||o.order_id,item.primary_row,
 case when stage.type='SALE' and item.primary_row then o.amount_cents::numeric end,coalesce(o.currency,''),case when stage.type='SALE' then item.amount end
 from site_analytics_order_facts o
 left join commerce_orders co on co.id=o.order_id and co.tenant_id=o.tenant_id and co.workspace_id=o.workspace_id
 -- Checkout orders attribute each cart line to its product (line total, without shipping); a discounted order gets no per-product estimate.
 cross join lateral(select x.product_id,x.amount,x.n=1 primary_row from(
  select i.product_id,case when co.discount_cents=0 then i.total_cents::numeric end amount,row_number() over(order by i.position,i.id) n from commerce_order_items i where i.order_id=co.id
  union all select o.product_id,case when o.product_id is not null then o.amount_cents::numeric end,1 where not exists(select 1 from commerce_order_items i where i.order_id=co.id)
 )x)item
 cross join lateral(values('ORDER',coalesce(o.created_at,o.paid_at)),('SALE',case when o.cancelled_at is null then o.paid_at end))stage(type,at)
 left join lateral(select b.dimensions from site_analytics_buckets b where b.site_id=o.site_id and b.tenant_id=$1 and b.workspace_id=$2 and b.actor=o.actor and b.type='SITE_VIEW' and b.bucket<=coalesce(o.created_at,o.paid_at) and b.bucket>coalesce(o.created_at,o.paid_at)-interval '30 days' order by b.bucket desc limit 1)entry on true
 where o.tenant_id=$1 and o.workspace_id=$2 and ($5::text is null or o.site_id=$5) and stage.at is not null
 and ($6::boolean or exists(select 1 from visible_intents i where i.deal_id=o.opportunity_id) or exists(select 1 from deals d where d.id=o.opportunity_id and d.tenant_id=$1 and d.workspace_id=$2 and (d.owner_user_id=any($7::text[]) or d.team_id=any($8::text[]))))
 ), product_actors as (
 select distinct r.site_id,r.actor from raw_activity r join products p on p.id=r.product_key and p.tenant_id=$1 and p.workspace_id=$2
 where r.at >=$3::timestamptz and r.at<$4::timestamptz and ($10::text is null or p.id=$10) and ($11::text is null or p.category_id in(select id from category_tree))
 ), activity as (
 select r.*,case when r.actor<>'' then r.site_id||':'||r.actor end visitor,
 to_char(r.at at time zone $9,'YYYY-MM-DD') as day_key,
 coalesce(nullif(r.dimensions->>'source',''),nullif(r.dimensions->>'referrer',''),'direct') source
 from raw_activity r where r.at >=$3::timestamptz and r.at<$4::timestamptz
 and ($12::text is null or coalesce(nullif(r.dimensions->>'source',''),nullif(r.dimensions->>'referrer',''),'direct')=$12)
 and ($13::text is null or r.dimensions->>'campaign'=$13)
 and (($10::text is null and $11::text is null) or exists(select 1 from products p where p.id=r.product_key and p.tenant_id=$1 and p.workspace_id=$2 and ($10::text is null or p.id=$10) and ($11::text is null or p.category_id in(select id from category_tree))) or (r.type='SITE_VIEW' and exists(select 1 from product_actors p where p.site_id=r.site_id and p.actor=r.actor)))
 )`;
 return {sql,params};
}
type GroupRow={kind:string;key:string;type:string;currency:string;count:string;visitors:string;amount:string|null;dimensions?:Record<string,string>};
function group(rows:GroupRow[],key:string,label=key):AnalyticsGroup{
 const result:AnalyticsGroup={key,label,metrics:{},revenue:{}};
 for(const row of rows){if(row.type==="REVENUE"){if(row.currency&&row.amount!==null)result.revenue[row.currency]=(result.revenue[row.currency]??0)+Number(row.amount);continue;}const metric=result.metrics[row.type]??={count:0,visitors:0};metric.count+=Number(row.count);metric.visitors+=Number(row.visitors);}
 return result;
}
const metric=(g:{metrics:Record<string,AnalyticsMetric>},key:string)=>g.metrics[key]??{count:0,visitors:0};
export class PostgresSiteAnalyticsRepository implements SiteAnalyticsRepositoryPort{
 constructor(private readonly pool:Pool){}
 async report(input:SiteAnalyticsQuery):Promise<SiteAnalyticsReport>{
  const {sql,params}=activityQuery(input);
  const count=`case when type=any(array[${ENTITY_TYPES.map(v=>`'${v}'`).join(",")}]) then count(distinct entity) else coalesce(sum(n),0) end`;
  const acquisitionKey="jsonb_build_object('source',source,'medium',dimensions->>'medium','campaign',dimensions->>'campaign','content',dimensions->>'content','term',dimensions->>'term','referrer',dimensions->>'referrer')::text";
  const aggregate=(kind:string,key:string,condition:string,amount="amount")=>{
   const dimensions=kind==="source"?`${key}::jsonb`:"null::jsonb";
   return `select '${kind}' kind,${key} key,type,''::text currency,${count}::text count,count(distinct visitor)::text visitors,null::text amount,${dimensions} dimensions from activity where ${condition} group by ${key},type
    union all select '${kind}',${key},'REVENUE',currency,'0','0',sum(${amount})::text,${dimensions} from activity where ${condition} and type='SALE' and ${amount} is not null and currency<>'' group by ${key},currency`;
  };
  const financialAmount=input.filters.productId||input.filters.categoryId?"product_amount":"amount";
  const result=await this.pool.query<GroupRow>(`${sql} ${[aggregate("total","''::text","true",financialAmount),aggregate("day","day_key","true",financialAmount),aggregate("product","product_key","product_key<>''","product_amount"),aggregate("source",acquisitionKey,"true",financialAmount)].join(" union all ")}`,params);
  const total=group(result.rows.filter(r=>r.kind==="total"),"total");
  const groups=(kind:string)=>{const map=new Map<string,GroupRow[]>();for(const row of result.rows.filter(r=>r.kind===kind)){const list=map.get(row.key)??[];list.push(row);map.set(row.key,list);}return [...map].map(([key,rows])=>group(rows,key));};
  const products=groups("product"),acquisition=groups("source"),series=groups("day");
  const names=products.length?await this.pool.query("select id,name from products where tenant_id=$1 and workspace_id=$2 and id=any($3::text[])",[input.scope.tenantId,input.scope.workspaceId,products.map(p=>p.key)]):{rows:[]};
  const productRates=await this.pool.query(`${sql}, product_flags as(select product_key,visitor,bool_or(type='PRODUCT_VIEW') viewed,bool_or(type='SALE') purchased from activity where product_key<>'' and visitor is not null group by product_key,visitor) select product_key,count(*) filter(where viewed and purchased)::int numerator,count(*) filter(where viewed)::int denominator from product_flags group by product_key`,params);
  for(const product of products){const rate=productRates.rows.find(r=>r.product_key===product.key);product.metrics.VIEW_TO_SALE={count:rate?.numerator??0,visitors:rate?.denominator??0};}
  const productNames=new Map(names.rows.map(r=>[r.id,r.name]));products.forEach(p=>p.label=productNames.get(p.key)??"Produto removido");
  acquisition.forEach(g=>{const dims=JSON.parse(g.key);g.label=dims.source==="direct"?"Direto":dims.source;g.utm={source:dims.source,medium:dims.medium??undefined,campaign:dims.campaign??undefined,content:dims.content??undefined,term:dims.term??undefined};g.referrer=dims.referrer??undefined;});
  const sortType={views:"PRODUCT_VIEW",visitors:"PRODUCT_VIEW",whatsapp:"PRODUCT_WHATSAPP_CLICK",cart:"ADD_TO_CART",intents:"INTENT",opportunities:"OPPORTUNITY",sales:"SALE",revenue:"SALE"}[input.sort];
  const hasMixedCurrencies=new Set(products.flatMap(g=>Object.keys(g.revenue))).size>1;
  const score=(g:AnalyticsGroup)=>input.sort==="revenue"?!hasMixedCurrencies&&Object.keys(g.revenue).length===1?Object.values(g.revenue)[0]:0:input.sort==="visitors"?metric(g,sortType).visitors:metric(g,sortType).count;
  products.sort((a,b)=>score(b)-score(a)||a.label.localeCompare(b.label));acquisition.sort((a,b)=>metric(b,"SITE_VIEW").visitors-metric(a,"SITE_VIEW").visitors||a.key.localeCompare(b.key));series.sort((a,b)=>a.key.localeCompare(b.key));
  const flags=await this.pool.query(`${sql}, flags as(select visitor,bool_or(type='SITE_VIEW') visit,bool_or(type='PRODUCT_VIEW') product,bool_or(type='PRODUCT_WHATSAPP_CLICK') whatsapp,bool_or(type='ADD_TO_CART') cart,bool_or(type='INTENT') intent,bool_or(type='CONVERSATION') conversation,bool_or(type='OPPORTUNITY') opportunity,bool_or(type='CHECKOUT_STARTED') checkout,bool_or(type='SALE') sale from activity where visitor is not null group by visitor)
  select count(*) filter(where visit)::int visits,count(*) filter(where product)::int products,count(*) filter(where visit and product)::int visit_product,count(*) filter(where product and whatsapp)::int product_whatsapp,count(*) filter(where product and cart)::int product_cart,count(*) filter(where visit and intent)::int visit_intent,count(*) filter(where visit and sale)::int visit_sale,count(*) filter(where checkout)::int checkouts,count(*) filter(where checkout and sale)::int checkout_sale from flags`,params);
  const f=flags.rows[0];
  const contactConversion=await this.pool.query(`${sql} select count(distinct c.entity)::int denominator,count(distinct c.entity) filter(where exists(select 1 from activity o where o.type='CONTACT_OPPORTUNITY' and o.entity=c.entity))::int numerator from activity c where c.type='CONTACT'`,params);
  total.metrics.CONTACT_OPPORTUNITY={count:contactConversion.rows[0].numerator,visitors:0};
  const ratio=(key:string,label:string,numerator:number,denominator:number)=>({key,label,numerator,denominator,rate:conversionRate(numerator,denominator)});
  const futureData=result.rows.some(r=>["CHECKOUT_STARTED","ORDER","SHIPPING_QUOTED","PAYMENT_STARTED","PAYMENT_APPROVED","ORDER_CREATED","ORDER_PAID","ORDER_CANCELLED","ORDER_COMPLETED"].includes(r.type));
  const hasCheckout=Boolean(total.metrics.CHECKOUT_STARTED);
  const stages=[["SITE_VIEW","Visitantes"],["PRODUCT_VIEW","Visualizaram produto"],["INTEREST","Demonstraram interesse"],["CONVERSATION","Iniciaram conversa"],["OPPORTUNITY","Viraram oportunidade"],...(hasCheckout?[["CHECKOUT_STARTED","Iniciaram checkout"]]:[]),...(metric(total,"SALE").count?[["SALE","Compraram / fecharam venda"]]:[])];
  // Interest is a union of visitors, never a sum of WhatsApp clicks + cart + intent events.
  const interest=await this.pool.query(`${sql} select null::text source_key,count(distinct visitor)::int n from activity where type in ('PRODUCT_WHATSAPP_CLICK','ADD_TO_CART','CART_WHATSAPP_START','CONTACT_FORM_SUBMITTED','INTENT') union all select ${acquisitionKey} source_key,count(distinct visitor)::int n from activity where type in ('PRODUCT_WHATSAPP_CLICK','ADD_TO_CART','CART_WHATSAPP_START','CONTACT_FORM_SUBMITTED','INTENT') group by ${acquisitionKey}`,params);
  total.metrics.INTEREST={count:Number(interest.rows[0].n),visitors:Number(interest.rows[0].n)};
  for(const source of acquisition){const n=Number(interest.rows.find(r=>r.source_key===source.key)?.n??0);source.metrics.INTEREST={count:n,visitors:n};}
  for(let index=acquisition.length-1;index>=0;index--)if(!["SITE_VIEW","PRODUCT_VIEW","INTENT","OPPORTUNITY","SALE","ORDER","INTEREST"].some(key=>metric(acquisition[index],key).count))acquisition.splice(index,1);
  const leads=await this.pool.query(`${sql} select distinct i.id,i.reference,i.type,i.contact_id,i.deal_id,i.created_at from visible_intents i where exists(select 1 from activity a where a.entity=i.id and a.type='INTENT') order by i.created_at desc limit 20`,params);
  return {range:input.range,scope:input.scope.global?"workspace":"team_or_own",metrics:total.metrics,revenue:total.revenue,
   funnel:stages.map(([key,label])=>({key,label,visitors:key==="INTEREST"?Number(interest.rows[0].n):metric(total,key).visitors})),
   conversions:[ratio("visit_product","Visita → produto",f.visit_product,f.visits),ratio("product_whatsapp","Produto → WhatsApp",f.product_whatsapp,f.products),ratio("product_cart","Produto → carrinho",f.product_cart,f.products),ratio("visit_intent","Visita → intenção",f.visit_intent,f.visits),ratio("intent_contact","Intenção → contato",metric(total,"INTENT_LINKED").count,metric(total,"INTENT").count),ratio("contact_opportunity","Contato → oportunidade",metric(total,"CONTACT_OPPORTUNITY").count,metric(total,"CONTACT").count),ratio("opportunity_sale","Oportunidade → venda",metric(total,"OPPORTUNITY_WON").count,metric(total,"OPPORTUNITY").count),...(hasCheckout?[ratio("checkout_sale","Checkout → compra",f.checkout_sale,f.checkouts)]:[]),...(total.metrics.SALE?[ratio("visit_sale","Visita → venda",f.visit_sale,f.visits)]:[])],
   series,products:products.slice(input.offset,input.offset+input.limit),acquisition:acquisition.slice(input.offset,input.offset+input.limit),productTotal:products.length,acquisitionTotal:acquisition.length,
   leads:leads.rows.map(r=>({id:r.id,reference:r.reference,type:r.type,contactId:r.contact_id??undefined,dealId:r.deal_id??undefined,createdAt:r.created_at.toISOString()})),empty:result.rows.length===0,futureData,
   notes:[...(hasMixedCurrencies&&input.sort==="revenue"?["Ordenação por receita não compara moedas diferentes; os produtos são apresentados por nome."]:[]),"Visitantes são identificadores anônimos distintos por site, não uma contagem de pessoas identificadas.","Conversões entre visitas usam a interseção de visitantes das duas etapas no período. Intenção → contato e oportunidade → venda usam a coorte criada no período.","Contatos associados podem já existir no CRM. Clique e carrinho não são conversa nem venda.","Receita mantém moedas separadas; vendas CRM usam o valor final do fechamento. Produtos sem atribuição financeira individual não recebem receita estimada.","Origens usam a UTM do evento/intenção; sem UTM, o domínio de referência, depois Direto. Visitantes entre origens não são somáveis.",...(input.scope.global?[]:["Visão limitada às jornadas vinculadas às suas oportunidades ou atendimentos/equipes permitidas. Visitantes ainda sem vínculo não são expostos."])]};
 }
 async journey(input:SiteAnalyticsQuery&{intentId:string}){
  const {sql,params}=activityQuery(input);const intent=await this.pool.query(`${sql} select i.*,m.ambiguous from visible_intents i left join site_analytics_identities m on m.site_id=i.site_id and m.anonymous_session_id=i.anonymous_session_id where i.id=$14 and exists(select 1 from activity a where a.entity=i.id and a.type='INTENT')`,[...params,input.intentId]);
  const i=intent.rows[0];if(!i)return undefined;
  const events=await this.pool.query("select e.type,e.created_at,e.product_id,e.page_url,p.name from site_events e left join products p on p.id=e.product_id and p.tenant_id=e.tenant_id and p.workspace_id=e.workspace_id where e.tenant_id=$1 and e.workspace_id=$2 and e.site_id=$3 and (e.sales_intent_id=$4 or ($5::text is not null and e.anonymous_session_id=$5 and not $6::boolean)) and e.created_at >=$7 and e.created_at <$8 order by e.created_at desc,e.id desc limit 40",[input.scope.tenantId,input.scope.workspaceId,i.site_id,i.id,i.anonymous_session_id,i.ambiguous??false,input.range.start,input.range.end]);
  return {reference:i.reference,contactId:i.contact_id??undefined,conversationId:i.conversation_id??undefined,attendanceId:i.attendance_id??undefined,dealId:i.deal_id??undefined,identityAmbiguous:i.ambiguous??false,events:events.rows.reverse().map(r=>({type:r.type,at:r.created_at.toISOString(),productId:r.product_id??undefined,productName:r.name??undefined,path:r.page_url?new URL(r.page_url).pathname:undefined}))};
 }
}
