import sharp from "sharp";
import type {FastifyRequest} from "fastify";
import {randomUUID} from "node:crypto";
import type {ObjectStoragePort} from "../../../application/ports/object-storage.port.js";
import {ValidationError} from "./app-error.js";
import {parseOwnedObjectUrl} from "../../../shared/utils/object-url-signing.js";
export function canonicalWorkspaceImages(storage:ObjectStoragePort|undefined,scope:{tenantId:string;workspaceId:string},urls:readonly string[]):string[]{
 if(!urls.length)return [];if(!storage)throw new ValidationError("Envio de imagens indisponível.");
 const base=storage.resolvePublicUrl(""),prefix=`assets/${scope.tenantId}/${scope.workspaceId}/products/`;
 return urls.map(url=>{const parsed=parseOwnedObjectUrl(url,base);if(!parsed||!parsed.key.startsWith(prefix)||!/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(parsed.key.slice(prefix.length)))throw new ValidationError("Use apenas imagens enviadas para este workspace.");return storage.resolvePublicUrl(parsed.key);});
}
export async function uploadWorkspaceImage(request:FastifyRequest,storage:ObjectStoragePort,scope:{tenantId:string;workspaceId:string},maxBytes=5_000_000,optimize=false):Promise<{url:string}>{
 const file=await request.file({limits:{fileSize:Math.min(5_000_000,maxBytes)}});
 if(!file)throw new ValidationError("Envie a foto.");
 let extension=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"} as Record<string,string>)[file.mimetype];
 if(!extension)throw new ValidationError("Use uma foto JPG, PNG ou WEBP.");
 let body=await file.toBuffer().catch(()=>{throw new ValidationError("A foto pode ter no máximo 5 MB.");});
 if(file.file.truncated)throw new ValidationError("A foto pode ter no máximo 5 MB.");
 let contentType=file.mimetype;
 if(optimize){try{body=await sharp(body,{limitInputPixels:32_000_000}).rotate().resize({width:1920,height:1920,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();extension="webp";contentType="image/webp";}catch{throw new ValidationError("Não foi possível abrir esta foto. Escolha uma imagem menor em JPG, PNG ou WEBP.");}}
 return storage.put({key:`assets/${scope.tenantId}/${scope.workspaceId}/products/${randomUUID()}.${extension}`,body,contentType});
}
