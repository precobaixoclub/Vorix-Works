"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/#produto", label: "Produto" },
  { href: "/#resultados", label: "Resultados" },
  { href: "/pricing", label: "Preços" },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b12]/90 text-white backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Vorix" className="flex items-center">
          <Logo className="h-14 w-auto text-white sm:h-16" />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
          {LINKS.map((link) => <Link key={link.href} href={link.href} className="hover:text-white">{link.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login"><Button variant="ghost" className="text-white hover:bg-white/10">Entrar</Button></Link>
          <Link href="/signup"><Button className="bg-[#addb46] text-[#071009] hover:bg-[#c7f45b]">Testar por 7 dias</Button></Link>
        </div>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 md:hidden" onClick={() => setOpen((value) => !value)} aria-label="Abrir menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <div className="border-t border-white/10 bg-[#070b12] px-4 py-4 md:hidden">
          <nav className="grid gap-2 text-sm">
            {LINKS.map((link) => <Link key={link.href} href={link.href} className="rounded-md px-3 py-2 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setOpen(false)}>{link.label}</Link>)}
          </nav>
          <div className="mt-4 grid gap-2">
            <Link href="/login" onClick={() => setOpen(false)}><Button variant="secondary" className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10">Entrar</Button></Link>
            <Link href="/signup" onClick={() => setOpen(false)}><Button className="w-full bg-[#addb46] text-[#071009] hover:bg-[#c7f45b]">Testar por 7 dias</Button></Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
