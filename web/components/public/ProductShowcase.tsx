"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, CalendarDays, Check, ChevronRight, FileText, LayoutGrid, MessageSquare, MoreHorizontal, Play, Search, Send, Sparkles, Users, Video } from "lucide-react";

type Product = "conversations" | "meetings";
export function ProductShowcase({ initialProduct = "conversations", selector = true }: { initialProduct?: Product; selector?: boolean }) {
  const [product, setProduct] = useState<Product>(initialProduct);
  const id = useId();
  function changeByKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "conversations" : event.key === "End" ? "meetings" : product === "conversations" ? "meetings" : "conversations";
    setProduct(next);
    document.getElementById(id + "-" + next)?.focus();
  }
  return <div className={"public-showcase " + product}>
    {selector ? <div role="tablist" aria-label="Conheça os produtos Vorix" className="public-product-tabs">
      {(["conversations", "meetings"] as const).map(key => <button key={key} id={id + "-" + key} type="button" role="tab" aria-selected={product === key} aria-controls={id + "-panel"} tabIndex={product === key ? 0 : -1} onClick={() => setProduct(key)} onKeyDown={changeByKeyboard}>{key === "conversations" ? <MessageSquare size={16} aria-hidden="true" /> : <Video size={16} aria-hidden="true" />}Vorix {key === "conversations" ? "Conversas" : "Meetings"}</button>)}
    </div> : null}
    <div className="public-showcase-stage">
      <div className="public-stage-orbit" aria-hidden="true" />
      <div id={id + "-panel"} role={selector ? "tabpanel" : undefined} aria-labelledby={selector ? id + "-" + product : undefined} className="public-showcase-panel" key={product}>
        <ProductPreview product={product} />
      </div>
      <div className="public-floating-note" aria-hidden="true"><span className="public-note-symbol">{product === "conversations" ? <Check size={18} /> : <Sparkles size={18} />}</span><span><small>{product === "conversations" ? "OPORTUNIDADE EM MOVIMENTO" : "CONTEXTO TRANSFORMADO EM AÇÃO"}</small><strong>{product === "conversations" ? "Proposta pronta. Próximo passo claro." : "Resumo, decisões e tarefas conectados."}</strong></span><ArrowUpRight size={16} /></div>
    </div>
    <p className="public-preview-caption">Prévia ilustrativa com dados de exemplo{product === "meetings" ? " · Meetings em validação para liberação" : ""}</p>
  </div>;
}

export function ProductPreview({ product, compact = false }: { product: Product; compact?: boolean }) {
  return <div className={"public-preview " + product + (compact ? " compact" : "")} aria-label={"Prévia ilustrativa do Vorix " + (product === "conversations" ? "Conversas" : "Meetings")}>
    <div className="public-preview-top"><span className="public-window-dots" aria-hidden="true"><i /><i /><i /></span><span>Acme Studio <ChevronRight size={11} /> {product === "conversations" ? "Conversas" : "Meetings"}</span><span className="public-demo-tag">DEMO</span></div>
    <div className="public-preview-app">
      <div className="public-preview-sidebar" aria-hidden="true"><strong>V<span>.</span></strong><LayoutGrid size={17} /><MessageSquare size={17} className={product === "conversations" ? "selected" : ""} /><Users size={17} /><CalendarDays size={17} className={product === "meetings" ? "selected" : ""} /><FileText size={17} /><span className="public-mini-avatar">AC</span></div>
      {product === "conversations" ? <ConversationPreview /> : <MeetingsPreview />}
    </div>
  </div>;
}

function ConversationPreview() {
  return <div className="public-conversation-preview">
    <div className="public-preview-inbox"><div className="public-preview-title"><strong>Conversas <small>12</small></strong><MoreHorizontal size={17} /></div><div className="public-preview-search"><Search size={12} /> Buscar conversa</div><div className="public-preview-filters"><span className="active">Minha fila</span><span>Equipe</span></div>
      {[["MA", "Marina Almeida", "Perfeito, vamos avançar!", "Agora"], ["RC", "Rafael Costa", "Pode enviar a proposta?", "10:42"], ["JL", "Julia Lima", "Obrigada pelo retorno.", "10:38"], ["PS", "Pedro Santos", "Tenho uma dúvida sobre…", "10:26"]].map(([initial, name, message, time], index) => <div className={"public-preview-contact " + (index === 0 ? "active" : "")} key={name}><span className={"public-mini-avatar tone-" + index}>{initial}</span><span><strong>{name}<small>{time}</small></strong><p>{message}</p></span></div>)}
      <div className="public-preview-inbox-bottom"><i /> Equipe conectada</div>
    </div>
    <div className="public-preview-thread"><div className="public-preview-title"><div><strong>Marina Almeida</strong><p>Projeto Orion · Em negociação</p></div><span className="public-thread-tag">WhatsApp</span></div>
      <div className="public-preview-chat"><span className="public-chat-day">Hoje, 14 de outubro</span><div className="public-chat-bubble received">Olá! Já conseguimos avaliar a proposta.<small>10:45</small></div><div className="public-chat-bubble sent">Ótimo, Marina! Separei os próximos passos para começarmos.<small>10:46 <Check size={10} /></small></div><div className="public-chat-bubble received">Perfeito, vamos avançar!<small>10:47</small></div><div className="public-preview-proposal"><FileText size={19} /><span><strong>Proposta · Projeto Orion</strong><small>Escopo e condições comerciais</small></span><ArrowUpRight size={14} /></div></div>
      <div className="public-preview-compose"><span>Escreva uma mensagem…</span><Send size={14} /></div>
    </div>
    <div className="public-preview-context"><p className="public-preview-label">OPORTUNIDADE</p><strong>Projeto Orion</strong><span className="public-thread-tag">Proposta enviada</span><div className="public-opportunity-value">R$ 4.800<small>Valor da oportunidade</small></div><div className="public-mini-pipeline" aria-hidden="true"><i /><i /><i /><i /></div><p className="public-preview-label">PRÓXIMO PASSO</p><p>Alinhar início do projeto</p><small>Hoje · Marina Almeida</small><div className="public-preview-task"><Check size={13} /> Proposta preparada</div></div>
  </div>;
}

function MeetingsPreview() {
  return <div className="public-meetings-preview"><div className="public-preview-title"><div><strong>Alinhamento do projeto Orion</strong><p><CalendarDays size={11} /> 14 out · 10:00 · 3 participantes</p></div><span className="public-thread-tag violet"><Sparkles size={11} /> Resumo IA</span></div>
    <div className="public-meeting-columns"><div><div className="public-meeting-video"><div className="public-video-person"><span>MA</span><small>Marina Almeida</small></div><div className="public-video-person secondary"><span>RC</span><small>Rafael Costa</small></div><div className="public-video-person third"><span>JL</span><small>Julia Lima</small></div><span className="public-video-play"><Play size={15} fill="currentColor" /></span></div><div className="public-preview-player"><Play size={11} /><span>08:24</span><div><i /></div><span>24:16</span></div>
      <div className="public-transcript-title"><strong>Transcrição</strong><small>Buscar na reunião <Search size={10} /></small></div><div className="public-transcript-line"><span>08:24</span><div><strong>Marina Almeida</strong><p>Vamos priorizar a primeira entrega e alinhar os responsáveis.</p></div></div><div className="public-transcript-line"><span>08:36</span><div><strong>Rafael Costa</strong><p>Fechado. Eu preparo o cronograma para nossa próxima conversa.</p></div></div></div>
    <div className="public-meeting-summary"><h3><Sparkles size={15} /> Resumo inteligente</h3><p>Equipe alinhada sobre as prioridades, o cronograma e os próximos passos do projeto.</p><h4>Decisões</h4><div className="public-summary-item"><Check size={12} /><span>Priorizar a primeira entrega</span></div><div className="public-summary-item"><Check size={12} /><span>Revisar o cronograma em equipe</span></div><h4>Próximas ações</h4><div className="public-action-item"><span className="public-mini-checkbox" /><span>Preparar cronograma<small>Rafael · próxima reunião</small></span></div><div className="public-action-item"><span className="public-mini-checkbox" /><span>Compartilhar prioridades<small>Marina · esta semana</small></span></div></div></div>
  </div>;
}
