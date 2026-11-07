export const SOCIAL_NETWORKS=[
 {id:"instagram",label:"Instagram",host:"instagram.com"},
 {id:"facebook",label:"Facebook",host:"facebook.com"},
 {id:"tiktok",label:"TikTok",host:"tiktok.com"},
 {id:"youtube",label:"YouTube",host:"youtube.com"},
 {id:"linkedin",label:"LinkedIn",host:"linkedin.com"},
 {id:"x",label:"X (Twitter)",host:"x.com"},
 {id:"pinterest",label:"Pinterest",host:"pinterest.com"},
 {id:"threads",label:"Threads",host:"threads.net"},
 {id:"whatsapp",label:"WhatsApp",host:"wa.me"},
 {id:"telegram",label:"Telegram",host:"t.me"},
] as const;
export type SocialNetwork=typeof SOCIAL_NETWORKS[number]["id"];
export function socialNetwork(link:{label:string;url:string}):SocialNetwork|"other"{
 const name=link.label.toLowerCase().replace(/[^a-z]/g,"");
 const known=SOCIAL_NETWORKS.find(network=>network.id===name||network.label.toLowerCase().replace(/[^a-z]/g,"")===name);
 if(known)return known.id;
 if(name==="twitter")return "x";
 try{const host=new URL(link.url).hostname.toLowerCase().replace(/^www\./,"");return SOCIAL_NETWORKS.find(network=>host===network.host||host.endsWith(`.${network.host}`)||network.id==="youtube"&&host==="youtu.be"||network.id==="x"&&host==="twitter.com"||network.id==="threads"&&host==="threads.com")?.id??"other";}catch{return "other";}
}
