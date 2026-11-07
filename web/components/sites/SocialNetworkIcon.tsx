import {Globe} from "lucide-react";
import type {SocialNetwork} from "@/features/sites/social-networks";

export function SocialNetworkIcon({network}:{network:SocialNetwork|"other"}){
 const Icon=network==="other"?Globe:undefined;
 if(Icon)return <Icon size={22} aria-hidden="true"/>;
 const paths={
  facebook:"M14 22v-9h3l.5-4H14V7c0-1.1.3-2 2-2h2V1.4A26 26 0 0 0 15 1c-3 0-5 1.8-5 5v3H7v4h3v9z",
  youtube:"M23 7s-.2-1.7-.9-2.4c-.9-.9-1.9-.9-2.4-1C16.3 3.3 12 3.3 12 3.3s-4.3 0-7.7.3c-.5.1-1.5.1-2.4 1C1.2 5.3 1 7 1 7S.7 9 .7 11v2c0 2 .3 4 .3 4s.2 1.7.9 2.4c.9.9 2.1.9 2.6 1 2 .2 7.5.3 7.5.3s4.3 0 7.7-.3c.5-.1 1.5-.1 2.4-1 .7-.7.9-2.4.9-2.4s.3-2 .3-4v-2c0-2-.3-4-.3-4ZM9.7 16V8l7 4z",
  linkedin:"M3 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 8h4v14H1zm7 0h4v2c1-2 3-2.3 4.5-2.3 4 0 4.5 2.6 4.5 6V22h-4v-7.4c0-1.8 0-3.6-2.5-3.6S12 13 12 14.5V22H8z",
  tiktok:"M16.6 3c.4 2.4 1.8 3.8 4.2 4v4a10 10 0 0 1-4.2-1.2v6.4a6.3 6.3 0 1 1-5.4-6.3v4a2.4 2.4 0 1 0 1.4 2.2V3z",
  x:"M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l5.9 7.8L18.9 2zM17.8 20h1.7L6.3 3.9H4.5z",
  pinterest:"M12 2a10 10 0 0 0-3.6 19.3c0-.8 0-1.8.2-2.7l1.3-5.5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.9-2.5.9 0 1.3.7 1.3 1.5 0 1-.6 2.4-.9 3.7-.3 1.1.5 2 1.6 2 1.9 0 3.3-2 3.3-4.9 0-2.6-1.8-4.4-4.4-4.4-3 0-4.8 2.2-4.8 4.5 0 .9.3 1.9.8 2.4l.2.4-.3 1c0 .2-.2.3-.4.2-1.2-.6-1.9-2.3-1.9-3.8 0-3.1 2.3-6 6.7-6 3.5 0 6.2 2.5 6.2 5.8 0 3.5-2.2 6.4-5.1 6.4-1 0-2-.6-2.3-1.2l-.6 2.5c-.2.9-.9 2-1.3 2.7A10 10 0 1 0 12 2z",
  telegram:"M21.7 3.3 18.4 20c-.2 1.2-.9 1.5-1.9.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.7 13.5.8 12c-1.1-.4-1.1-1.1.3-1.6L20.3 3c.9-.3 1.6.2 1.4.3z",
 };
 if(network==="whatsapp")return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 11.5a9 9 0 0 1-13.4 7.8L3 21l1.7-4.6A9 9 0 1 1 21 11.5Z"/><path d="m8 7 2 3-1 1c1 2 2 3 4 4l1-1 3 2c-1 3-3 2-6 0s-5-6-4-8c.2-.6.5-1 1-1Z"/></svg>;
 if(network==="instagram")return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>;
 if(network==="threads")return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 7C17 1 5 1 4 10c-1 10 9 14 15 8 5-6-2-12-8-8-5 4 3 8 5 3 2-7-7-8-8-3"/></svg>;
 return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d={paths[network as keyof typeof paths]}/></svg>;
}
