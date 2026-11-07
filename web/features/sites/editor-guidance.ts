import {isFashionKidsSite} from "./fashion-kids";
/** Editorial recommendations, separate from the validation limits in site.model.ts. */
export type TextGuideline = {recommended: string; recommendedMax: number; max?: number; hint?: string};
export const SITE_TEXT_GUIDANCE = {
 siteName: {recommended:"até 40",recommendedMax:40,max:160},
 presentation: {recommended:"entre 80 e 240",recommendedMax:240,max:4000},
 sectionTitle: {recommended:"até 60",recommendedMax:60,max:4000},
 eyebrow: {recommended:"até 30",recommendedMax:30,max:100},
 paragraph: {recommended:"entre 100 e 600",recommendedMax:600,max:4000},
 shortDescription: {recommended:"até 180",recommendedMax:180,max:4000},
 heroTitle: {recommended:"até 60",recommendedMax:60,max:200},
 imageAlt: {recommended:"até 125",recommendedMax:125,max:200,hint:"Descreva o conteúdo da imagem para quem usa leitor de tela."},
 button: {recommended:"até 24",recommendedMax:24,max:100,hint:"Texto que aparece no botão. Ex.: Ver coleção ou Fale com a gente."},
 headerButton: {recommended:"até 24",recommendedMax:24,max:80},
 link: {recommended:"até 200",recommendedMax:200,max:2000},
 videoLink: {recommended:"até 200",recommendedMax:200,max:2000,hint:"Use o link completo de um vídeo público do YouTube ou Vimeo."},
 linkLabel: {recommended:"até 24",recommendedMax:24,max:100,hint:"Texto que o visitante verá no menu. Ex.: Sobre nós ou Ver produtos."},
 announcement: {recommended:"até 80",recommendedMax:80,max:200},
 footer: {recommended:"até 240",recommendedMax:240,max:4000},
 footerNote: {recommended:"até 100",recommendedMax:100,max:300},
 templateText: {recommended:"até 60",recommendedMax:60,max:300,hint:"Em branco, o site usa o texto padrão do modelo (mostrado no campo)."},
 columnTitle: {recommended:"até 30",recommendedMax:30,max:100},
 itemTitle: {recommended:"até 60",recommendedMax:60,max:200},
 personName: {recommended:"até 60",recommendedMax:60,max:200},
 question: {recommended:"até 100",recommendedMax:100,max:200},
 answer: {recommended:"até 400",recommendedMax:400,max:4000},
 testimonial: {recommended:"até 280",recommendedMax:280,max:4000},
 statistic: {recommended:"até 12",recommendedMax:12,max:80},
 caption: {recommended:"até 100",recommendedMax:100,max:300},
 pageTitle: {recommended:"até 60",recommendedMax:60,max:160},
 pageSlug: {recommended:"entre 3 e 60",recommendedMax:60,max:120,hint:"Use letras minúsculas, números e hífens, sem espaços ou acentos."},
 siteSlug: {recommended:"entre 3 e 40",recommendedMax:40,max:80,hint:"Use letras minúsculas, números e hífens, sem espaços ou acentos."},
 seoTitle: {recommended:"entre 30 e 60",recommendedMax:60,max:160},
 seoDescription: {recommended:"entre 120 e 160",recommendedMax:160,max:320},
 email: {recommended:"até 80",recommendedMax:80,hint:"Informe o endereço completo, como contato@suaempresa.com.br."},
 phone: {recommended:"entre 10 e 20",recommendedMax:20,max:30,hint:"Inclua o DDD; você pode usar espaços, parênteses e hífen."},
 whatsapp: {recommended:"entre 10 e 15",recommendedMax:15,max:15,hint:"Informe de 8 a 15 dígitos, com país e DDD. Exemplo: 5511999999999."},
 address: {recommended:"até 150",recommendedMax:150,max:500},
 socialName: {recommended:"até 24",recommendedMax:24,max:60},
 domain: {recommended:"até 60",recommendedMax:60,hint:"Informe somente o domínio, como www.suaempresa.com.br, sem https:// ou caminhos."},
} satisfies Record<string,TextGuideline>;
export type SiteTextGuidanceKey = keyof typeof SITE_TEXT_GUIDANCE;

export const SITE_IMAGE_GUIDANCE = {
 logo: {size:"800 × 400 px",ratio:"2:1",hint:"Prefira PNG ou WEBP com fundo transparente e mantenha uma margem ao redor da marca."},
 favicon: {size:"512 × 512 px",ratio:"1:1",hint:"Use um símbolo simples, centralizado e legível em tamanho pequeno."},
 heroWide: {size:"1920 × 960 px",ratio:"2:1",hint:"Mantenha o assunto principal no centro e evite texto dentro da imagem. Confira o recorte na prévia."},
 heroPortrait: {size:"1200 × 1500 px",ratio:"4:5",hint:"Ideal para a imagem ao lado do texto. No modo Preencher, pode haver recorte: mantenha o assunto principal no centro e deixe margem ao redor."},
 heroSquare: {size:"1200 × 1200 px",ratio:"1:1",hint:"Deixe margem ao redor do assunto e confira o recorte na prévia."},
 heroMobile: {size:"1080 × 1350 px",ratio:"4:5",hint:"Versão vertical para celular. Sem uma imagem própria, será usada a imagem para computador."},
 section: {size:"1600 × 900 px",ratio:"16:9",hint:"Use uma imagem horizontal com o assunto principal centralizado."},
 editorial: {size:"1200 × 1200 px",ratio:"1:1",hint:"Deixe margem ao redor do assunto para o recorte ao lado do texto."},
 gallery: {size:"1200 × 1200 px",ratio:"1:1",hint:"Use imagens quadradas e centralize o assunto para o recorte da galeria."},
 partnerLogo: {size:"600 × 300 px",ratio:"2:1",hint:"Prefira fundo transparente e margens iguais em todos os logos."},
 portrait: {size:"400 × 400 px",ratio:"1:1",hint:"Centralize o rosto: a foto será exibida em um recorte circular."},
} as const;
export type SiteImageGuidanceKey = keyof typeof SITE_IMAGE_GUIDANCE;
export function heroImageGuidance(templateId?:string,position?:string,siteSlug?:string):SiteImageGuidanceKey {
 if(isFashionKidsSite({slug:siteSlug??"",theme:{template:templateId??""}}))return "heroPortrait";
 if(templateId==="nexus")return "heroWide";
 if(templateId==="aura"||templateId==="pulse")return "heroPortrait";
 if(position==="background")return "heroWide";
 return "heroSquare";
}
