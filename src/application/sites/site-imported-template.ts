import type {SiteRepositoryPort} from "../ports/site-repository.port.js";
import type {Site,SiteSnapshot} from "../../domain/sites/site.model.js";
import type {ImportedTemplatePackage,TemplateSection} from "../../domain/sites/site-template-package.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";

/** O que a vitrine recebe de um modelo importado: CSS já restrito ao site e as árvores das seções. */
export type ImportedTemplateView={id:string;name:string;css:string;sections:TemplateSection[];sectionMap:Record<string,number>};

/** Troca as URLs das imagens do pacote pelas assinadas (o armazenamento pode ser privado). */
export function signImportedAssets<T>(value:T,assetUrls:readonly string[]):T{
 if(!assetUrls.length)return value;
 let json=JSON.stringify(value);
 for(const url of assetUrls)json=json.split(url).join(signOwnedUrl(url,OBJECT_URL_TTL.preview));
 return JSON.parse(json) as T;
}

export async function importedTemplateView(repository:Pick<SiteRepositoryPort,"importedTemplate">,site:Site,snapshot:SiteSnapshot):Promise<ImportedTemplateView|undefined>{
 const id=snapshot.theme.importedTemplateId;if(!id)return undefined;
 const record=await repository.importedTemplate({id,siteId:site.id,tenantId:site.tenantId});
 if(!record)return undefined;
 const pkg:ImportedTemplatePackage=record.package;
 return signImportedAssets({id:record.id,name:record.name,css:pkg.css,sections:pkg.sections,sectionMap:snapshot.theme.importedSections??{}},pkg.assetUrls);
}
