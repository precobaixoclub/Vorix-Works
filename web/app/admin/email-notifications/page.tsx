"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import {
  EMAIL_NOTIFICATION_EVENTS, getEmailNotificationSettings, getEmailNotificationHistory,
  saveEmailNotificationSettings, sendEmailNotificationTest, type EmailNotificationSettings, type EmailNotificationEvent, type EmailNotificationHistoryItem,
} from "@/features/platform-admin/email-notifications-api";

const STATUS: Record<EmailNotificationHistoryItem["status"], string> = {
  pending: "Na fila", sending: "Enviando", accepted: "Aceito pelo provedor", failed: "Falhou", cancelled: "Cancelado",
};

export default function AdminEmailNotificationsPage() {
  const settings = useSWR("admin-email-settings", getEmailNotificationSettings, { revalidateOnFocus: false });
  const history = useSWR("admin-email-history", getEmailNotificationHistory, {
    refreshInterval: items => items?.some(item => item.status === "pending" || item.status === "sending") ? 4_000 : 0,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Notificações por e-mail" description="Receba alertas de cadastros, assinaturas e problemas de publicação." />
      {settings.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando configuração…</div> : null}
      {settings.error ? <p role="alert" className="text-sm text-destructive">{settings.error.message}</p> : null}
      {settings.data ? <SettingsForm initial={settings.data} refreshHistory={async () => { await history.mutate(); }} /> : null}
      <Card>
        <CardHeader><h2 className="font-semibold">Últimos envios</h2></CardHeader>
        <CardBody>
          {history.isLoading ? <p className="text-sm text-muted-foreground">Carregando histórico…</p> : null}
          {history.error ? <p role="alert" className="text-sm text-destructive">{history.error.message}</p> : null}
          {history.data?.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum e-mail na fila ou enviado.</p> : null}
          {history.data?.length ? (
            <ul className="divide-y divide-border">
              {history.data.map(item => (
                <li key={item.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium">{item.subject}</p>
                    <p className="break-all text-xs text-muted-foreground">{item.recipient} · {new Date(item.createdAt).toLocaleString("pt-BR")}</p>
                    {item.lastError ? <p className="mt-1 text-xs text-muted-foreground">{item.lastError}</p> : null}
                  </div>
                  <span className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{STATUS[item.status]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function SettingsForm({ initial, refreshHistory }: { initial: EmailNotificationSettings; refreshHistory: () => Promise<void> }) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [from, setFrom] = useState(initial.fromEmail ?? "");
  const [addresses, setAddresses] = useState(initial.recipients.join("\n"));
  const [events, setEvents] = useState(initial.events);
  const [apiKey, setApiKey] = useState("");
  const [operation, setOperation] = useState<"save" | "test">();
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string }>();
  const unsaved = Boolean(apiKey) || enabled !== saved.enabled || from.trim() !== (saved.fromEmail ?? "") ||
    addresses !== saved.recipients.join("\n") || events.length !== saved.events.length || events.some(event => !saved.events.includes(event));
  const canTest = Boolean(saved.hasApiKey && saved.fromEmail && saved.recipients.length);

  const changeEvent = (event: EmailNotificationEvent, selected: boolean) => setEvents(current =>
    selected ? [...current, event] : current.filter(item => item !== event));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setOperation("save");
    setFeedback(undefined);
    try {
      const next = await saveEmailNotificationSettings({
        enabled, fromEmail: from.trim() || null, recipients: addresses.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean),
        events, apiKey: apiKey.trim() || undefined,
      });
      setSaved(next);
      setAddresses(next.recipients.join("\n"));
      setFrom(next.fromEmail ?? "");
      setApiKey("");
      setFeedback({ text: "Configuração salva." });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "Não foi possível salvar a configuração." });
    } finally { setOperation(undefined); }
  }

  async function test() {
    setOperation("test");
    setFeedback(undefined);
    try {
      await sendEmailNotificationTest();
      setFeedback({ text: "E-mail de teste na fila. Acompanhe em Últimos envios." });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "Não foi possível iniciar o envio de teste." });
    } finally { setOperation(undefined); }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Canal de envio</h2>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={Boolean(operation)} />
              Ativar alertas automáticos
            </label>
          </div>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="email-alert-from">E-mail remetente</Label>
            <Input id="email-alert-from" type="email" value={from} onChange={event => setFrom(event.target.value)} placeholder="alertas@notificacoes.vorixworks.com" />
            <p className="mt-1 text-xs text-muted-foreground">Use um endereço de um domínio verificado no Resend.</p>
          </div>
          <div>
            <Label htmlFor="email-alert-key">Chave de envio do Resend</Label>
            <Input id="email-alert-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" placeholder={saved.hasApiKey ? "Chave configurada" : "re_…"} />
            <p className="mt-1 text-xs text-muted-foreground">{saved.hasApiKey ? "Preencha apenas para trocar a chave." : "A chave é armazenada criptografada."}</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="email-alert-recipients">Destinatários dos alertas</Label>
            <Textarea id="email-alert-recipients" rows={3} value={addresses} onChange={event => setAddresses(event.target.value)} placeholder="Um e-mail por linha" />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><h2 className="font-semibold">Eventos</h2></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {EMAIL_NOTIFICATION_EVENTS.map(event => (
            <label key={event.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2.5">
              <input type="checkbox" className="mt-1 accent-primary" checked={events.includes(event.id)} onChange={input => changeEvent(event.id, input.target.checked)} />
              <span><span className="block text-sm font-medium">{event.label}</span><span className="text-xs text-muted-foreground">{event.description}</span></span>
            </label>
          ))}
        </CardBody>
      </Card>
      {feedback ? <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-sm text-destructive" : "text-sm text-foreground"}>{feedback.text}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!canTest || unsaved || Boolean(operation)} onClick={() => void test()}>
          {operation === "test" ? "Colocando na fila…" : "Enviar teste"}
        </Button>
        <Button type="submit" disabled={!unsaved || Boolean(operation)}>{operation === "save" ? "Salvando…" : "Salvar configuração"}</Button>
      </div>
    </form>
  );
}
