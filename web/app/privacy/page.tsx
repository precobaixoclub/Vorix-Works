import Link from "next/link";
import type React from "react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";

export const metadata = {
  title: "Política de Privacidade | Vorix",
  description: "Política de privacidade da plataforma Vorix.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <LegalArticle title="Política de Privacidade" updated="12 de novembro de 2026">
        <p>A Vorix fornece ferramentas de marketing, atendimento, CRM e resultados conectados por IA. Esta política explica quais dados podem ser tratados quando uma pessoa usa a plataforma.</p>
        <Section title="Dados que coletamos">Podemos coletar dados de cadastro, informações de workspace, conteúdos enviados, registros operacionais, dados de atendimento e informações retornadas por plataformas conectadas quando você autoriza uma integração.</Section>
        <Section title="Como usamos os dados">Usamos os dados para autenticar usuários, operar workspaces, conectar contas externas, publicar conteúdos autorizados, registrar auditoria, melhorar estabilidade e cumprir obrigações legais ou de segurança.</Section>
        <Section title="Compartilhamento">Dados podem ser enviados para provedores externos apenas quando necessário para executar uma ação solicitada, como autenticar uma conta, publicar conteúdo ou processar cobrança. Não vendemos dados pessoais.</Section>
        <Section title="Dados do Google (Google Calendar e Google Meet)">
          Quando você conecta sua conta Google em Meetings → Integrações, a Vorix pede somente: o seu e-mail (para mostrar qual conta está conectada), os eventos da sua agenda (permissão &quot;calendar.events&quot;), a lista das suas agendas, só para você escolher qual sincronizar (permissão &quot;calendar.calendarlist.readonly&quot;), e as transcrições do Google Meet das suas reuniões (permissão &quot;meetings.space.readonly&quot;). Usamos esses dados apenas para exibir e sincronizar sua agenda dentro da Vorix, agendar a gravação das reuniões conforme a regra que você escolher e gerar o resumo das reuniões a partir da transcrição. Os tokens de acesso são guardados criptografados (AES-256-GCM) e cada pessoa vê só a própria conexão. A transcrição é enviada ao provedor de IA contratado apenas para gerar o resumo pedido, sem uso para treinar modelos. Não vendemos esses dados, não os usamos para publicidade e nenhuma pessoa os lê, exceto com o seu consentimento, por segurança ou por obrigação legal. Você pode desconectar a qualquer momento: o acesso é revogado no Google e as credenciais são apagadas. Para excluir eventos e transcrições já importados, use o contato abaixo.
        </Section>
        <Section title="Uso limitado">O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google seguem a <a href="https://developers.google.com/terms/api-services-user-data-policy" className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado.</Section>
        <Section title="Exclusão de dados">Você pode solicitar exclusão de dados pelo contato abaixo ou pela página de instruções em <Link href="/data-deletion" className="font-medium text-primary hover:underline">/data-deletion</Link>.</Section>
        <Section title="Contato">Solicitações sobre privacidade podem ser enviadas para <a href="mailto:privacidade@vorixworks.com" className="font-medium text-primary hover:underline">privacidade@vorixworks.com</a>.</Section>
      </LegalArticle>
      <PublicFooter />
    </main>
  );
}

function LegalArticle({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 text-sm leading-6 text-muted-foreground sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atualizado em {updated}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="mt-8 space-y-7">{children}</div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="text-lg font-semibold text-foreground">{title}</h2><p className="mt-2">{children}</p></section>;
}
