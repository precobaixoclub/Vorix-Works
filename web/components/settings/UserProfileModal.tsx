"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { PersonAvatar } from "@/components/DashboardKit";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTenantMember, updateTenantMemberProfile } from "@/features/identity/api";
import type { TenantMembership, TenantRole } from "@/features/identity/types";

export function UserProfileModal({ member, onClose, onSaved }: { member?: TenantMembership; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TenantRole>("editor");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(member?.avatarUrl ?? null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function readPhoto(file: File) {
    setError(undefined);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Escolha uma foto PNG, JPG, WebP ou GIF de até 2 MB.");
      return;
    }
    setReadingPhoto(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Não foi possível ler esta foto."));
        reader.readAsDataURL(file);
      });
      setAvatarUrl(data);
      setPhotoChanged(true);
    } catch { setError("Não foi possível ler esta foto."); }
    finally { setReadingPhoto(false); }
  }

  async function save() {
    if (busy || readingPhoto) return;
    setBusy(true);
    setError(undefined);
    try {
      const profile = { name: name.trim(), email: email.trim(), ...(photoChanged ? { avatarUrl } : {}) };
      if (member) await updateTenantMemberProfile(member.userId, profile);
      else await createTenantMember({ ...profile, password, role });
      await onSaved();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar o usuário."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={member ? "Editar usuário" : "Cadastrar usuário"} onClose={() => { if (!busy && !readingPhoto) onClose(); }}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="flex items-center gap-4">
          <PersonAvatar nome={name || "Usuário"} avatarUrl={avatarUrl} className="h-16 w-16 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="user-photo">Foto</Label>
            <Input id="user-photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy || readingPhoto} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readPhoto(file); }} />
            <p className="text-xs text-muted-foreground">Opcional · PNG, JPG, WebP ou GIF de até 2 MB.</p>
            {avatarUrl ? <Button type="button" variant="ghost" size="sm" disabled={busy || readingPhoto} onClick={() => { setAvatarUrl(null); setPhotoChanged(true); }}>Remover foto</Button> : null}
          </div>
        </div>
        <div><Label htmlFor="user-name">Nome</Label><Input id="user-name" autoFocus required maxLength={150} autoComplete="name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Nome do atendente" /></div>
        <div><Label htmlFor="user-email">E-mail</Label><Input id="user-email" type="email" required maxLength={320} autoComplete="email" value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@empresa.com" /></div>
        {!member ? <>
          <div><Label htmlFor="user-password">Senha inicial</Label><Input id="user-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Pelo menos 8 caracteres. Compartilhe o acesso com o usuário após o cadastro.</p></div>
          <div><Label htmlFor="user-role">Papel de acesso</Label><Select value={role} onValueChange={(value) => setRole(value as TenantRole)} disabled={busy}><SelectTrigger id="user-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owner">Administrador</SelectItem><SelectItem value="admin">Gestor</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Visualizador</SelectItem></SelectContent></Select></div>
        </> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy || readingPhoto} onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy} disabled={busy || readingPhoto || !name.trim() || !email.trim()}>{member ? "Salvar alterações" : "Cadastrar usuário"}</Button></div>
      </form>
    </Modal>
  );
}
