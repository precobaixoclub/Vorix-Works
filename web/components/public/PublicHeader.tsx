"use client";

import Link from "next/link";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, ChevronDown, Menu, MessageSquare, Video, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";

const PRODUCTS = [
  { href: "/produtos/conversas", name: "Vorix Conversas", description: "Atendimento e vendas", Icon: MessageSquare, tone: "green" },
  { href: "/produtos/meetings", name: "Vorix Meetings", description: "Reuniões inteligentes", Icon: Video, tone: "violet" },
];
const LINKS = [["/#como-funciona", "Como funciona"], ["/#plataforma", "Plataforma"], ["/precos", "Preços"], ["/#faq", "FAQ"]] as const;

export function PublicHeader({ startHref = "/signup" }: { startHref?: string }) {
  const [open, setOpen] = useState(false);
  const { state } = useAuth();
  const authenticated = state.status === "authenticated";
  return (
    <header className="public-header">
      <a className="public-skip" href="#conteudo">Pular para o conteúdo</a>
      <div className="public-container public-header-inner">
        <Link href="/" className="public-brand" aria-label="Vorix — início"><Logo viewBox="50 8 182 130" className="public-brand-mark" /><span>VORIX<span className="public-brand-dot">.</span></span></Link>
        <nav className="public-desktop-nav" aria-label="Navegação principal">
          <Popover.Root>
            <Popover.Trigger className="public-nav-trigger">Produtos <ChevronDown size={14} aria-hidden="true" /></Popover.Trigger>
            <Popover.Portal><Popover.Content sideOffset={18} align="start" className="public-product-menu">
              {PRODUCTS.map(({ href, name, description, Icon, tone }) => <Popover.Close asChild key={href}><Link href={href} className="public-menu-product"><span className={"public-icon " + tone}><Icon size={20} aria-hidden="true" /></span><span><strong>{name}</strong><small>{description}</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link></Popover.Close>)}
            </Popover.Content></Popover.Portal>
          </Popover.Root>
          {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="public-header-actions"><Link className="public-login" href={authenticated ? "/workspaces" : "/login"}>{authenticated ? "Acessar plataforma" : "Entrar"}</Link><Link href={startHref} className="public-button primary small">{startHref.startsWith("mailto:") ? "Falar com o time" : "Começar agora"} <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="public-mobile-trigger" aria-label="Abrir menu"><Menu size={23} /></Dialog.Trigger>
          <Dialog.Portal><Dialog.Overlay className="public-drawer-overlay" /><Dialog.Content className="public-drawer">
            <div className="public-drawer-top"><Dialog.Title>Explore o Vorix</Dialog.Title><Dialog.Close className="public-mobile-trigger" aria-label="Fechar menu"><X size={22} /></Dialog.Close></div>
            <Dialog.Description className="public-visually-hidden">Produtos, recursos e acesso à plataforma.</Dialog.Description>
            <nav aria-label="Navegação mobile">
              {PRODUCTS.map(({ href, name, description, Icon, tone }) => <Dialog.Close asChild key={href}><Link href={href} className="public-menu-product"><span className={"public-icon " + tone}><Icon size={20} aria-hidden="true" /></span><span><strong>{name}</strong><small>{description}</small></span></Link></Dialog.Close>)}
              {LINKS.map(([href, label]) => <Dialog.Close asChild key={href}><Link href={href} className="public-mobile-link">{label}</Link></Dialog.Close>)}
              <Dialog.Close asChild><Link href={authenticated ? "/workspaces" : "/login"} className="public-button secondary">{authenticated ? "Acessar plataforma" : "Entrar"}</Link></Dialog.Close>
              <Dialog.Close asChild><Link href={startHref} className="public-button primary">{startHref.startsWith("mailto:") ? "Falar com o time" : "Começar agora"} <ArrowUpRight size={16} /></Link></Dialog.Close>
            </nav>
          </Dialog.Content></Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}
