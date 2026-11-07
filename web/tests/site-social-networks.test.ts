import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {socialNetwork,SOCIAL_NETWORKS} from "@/features/sites/social-networks";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import {initialSiteSnapshot} from "@/features/sites/customization";
import {templateDemo} from "@/features/sites/demo-content";
import {WEBSITE_TEMPLATES} from "@/features/sites/template-registry";
describe("redes sociais",()=>{
 it("reconhece rótulos existentes e domínios sem confundir domínios semelhantes",()=>{
  expect(socialNetwork({label:"instagram",url:""})).toBe("instagram");expect(socialNetwork({label:"Twitter",url:""})).toBe("x");expect(socialNetwork({label:"Meu perfil",url:"https://www.tiktok.com/@loja"})).toBe("tiktok");expect(socialNetwork({label:"Perfil",url:"https://instagram.com.evil.invalid/perfil"})).toBe("other");
 });
 it("todos os modelos mostram ícones acessíveis com o destino configurado e rejeitam links inseguros",()=>{
  for(const template of WEBSITE_TEMPLATES){const site={...templateDemo("nexus"),...initialSiteSnapshot("Marca",template.id),slug:"marca"};site.content.socials=SOCIAL_NETWORKS.map(network=>({label:network.label,url:`https://${network.host}/perfil`}));site.content.socials.push({label:"Inválido",url:"javascript:alert(1)"});const html=renderToStaticMarkup(createElement(TenantSiteRenderer,{site,basePath:"/s/marca",preview:true}));const footer=html.slice(html.indexOf('<footer'));
   for(const network of SOCIAL_NETWORKS){expect(footer).toContain(`aria-label="${network.label}"`);expect(footer).toContain(`href="https://${network.host}/perfil"`);}expect((footer.match(/<svg/g)??[]).length).toBeGreaterThanOrEqual(SOCIAL_NETWORKS.length);expect(footer).not.toContain('javascript:');expect(footer).toContain('target="_blank" rel="noopener noreferrer"');
  }
 });
});
