"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/#produto", label: "Produto" },
  { href: "/#solucoes", label: "Soluções" },
  { href: "/pricing", label: "Preços" },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Vorix">
          <Logo className="h-10 w-auto text-foreground" />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {LINKS.map((link) => <Link key={link.href} href={link.href} className="hover:text-foreground">{link.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login"><Button variant="ghost">Entrar</Button></Link>
          <Link href="/signup"><Button>Criar conta</Button></Link>
        </div>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted md:hidden" onClick={() => setOpen((value) => !value)} aria-label="Abrir menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <div className="border-t border-border bg-background px-4 py-4 md:hidden">
          <nav className="grid gap-2 text-sm">
            {LINKS.map((link) => <Link key={link.href} href={link.href} className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setOpen(false)}>{link.label}</Link>)}
          </nav>
          <div className="mt-4 grid gap-2">
            <Link href="/login" onClick={() => setOpen(false)}><Button variant="secondary" className="w-full">Entrar</Button></Link>
            <Link href="/signup" onClick={() => setOpen(false)}><Button className="w-full">Criar conta</Button></Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
