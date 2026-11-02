// Generated from src/shared/utils/contact-presentation.ts. Run node scripts/sync-contact-presentation.mjs.
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type ContactPresentationInput = { name?: string | null; phone?: string | null; customFields?: Readonly<Record<string, unknown>>; contactName?: string | null; contactPhone?: string | null; phoneNormalized?: string | null; whatsappPhone?: string | null };

const technicalName=/^(?:lead(?:\b|[_\d-])|(?:contact|contato|intent|salesintent|conversation|inbox|lid|visitor)[_:-])|^[a-f\d]{8}-[a-f\d-]{27,}$|^[a-f\d]{20,}$|@(?:lid|s\.whatsapp\.net)/i;
export function commercialTitle(value:string|undefined,fallback:string):string {
  return value?.trim() && !technicalName.test(value.trim()) ? value.trim() : fallback;
}

/** Human identification only. Stored names/snapshots and relationship IDs stay untouched. */
export function humanContactName(value: string | null | undefined): string | undefined {
  const name=value?.trim();
  if(!name || !/\p{L}/u.test(name) || technicalName.test(name) || /^(?:sem nome|unknown|undefined|null)$/i.test(name)) return undefined;
  return name;
}

export function contactPhoneLabel(value: unknown): string | undefined {
  if(typeof value!=="string" || !/^\+?[\d\s().-]+$/.test(value.trim())) return undefined;
  const raw=value.trim(), digits=raw.replace(/\D/g,"");
  const candidate=raw.startsWith("+") ? raw : digits.startsWith("55") && digits.length>11 ? `+${digits}` : raw;
  const phone=parsePhoneNumberFromString(candidate,{defaultCountry:"BR",extract:false});
  return phone?.isValid() ? phone.country==="BR" ? phone.formatNational() : phone.formatInternational() : undefined;
}

/** Use in name inputs and creation, so a formatted display label never becomes a stored name. */
export function contactNameForInput(contact:ContactPresentationInput|null|undefined):string {
  const supplied=contact?.name ?? contact?.contactName;
  const parts=supplied?.split(" · ");
  return humanContactName(parts && parts.length>1 && contactPhoneLabel(parts.at(-1)) ? parts.slice(0,-1).join(" · ") : supplied) ?? "";
}

export function contactLabel(contact: ContactPresentationInput | null | undefined): string {
  if(!contact) return "Contato não informado";
  const raw=contact.phone ?? contact.customFields?.phone ?? contact.contactPhone ?? contact.phoneNormalized ?? contact.whatsappPhone;
  const suppliedName=contact.name ?? contact.contactName;
  const parts=suppliedName?.split(" · ");
  const phone=contactPhoneLabel(raw) ?? contactPhoneLabel(suppliedName) ?? (parts && parts.length>1 ? contactPhoneLabel(parts.at(-1)) : undefined);
  const name=contactNameForInput(contact);
  return [name,phone].filter(Boolean).join(" · ") || "Contato sem telefone";
}
