import type {BulkScope,BulkAccess,BulkField,BulkJobView,BulkOptions,BulkFilters,BulkIssue} from "../../domain/products/catalog-bulk.js";
export type BulkContext=BulkScope&BulkAccess;
export type BulkDownload={filename:string;contentType:string;bytes:Buffer};
export type CatalogBulkPort={
 list(context:BulkContext,filters:BulkFilters,offset:number,limit:number,sort:string):Promise<{items:import("../../domain/crm/crm.model.js").Product[];total:number}>;
 upload(context:BulkContext,file:{name:string;bytes:Buffer},operationKey:string):Promise<BulkJobView>;
 get(context:BulkContext,id:string):Promise<BulkJobView>;
 map(context:BulkContext,id:string,mapping:Record<string,BulkField>,options:BulkOptions):Promise<BulkJobView>;
 confirm(context:BulkContext,id:string):Promise<BulkJobView>;
 rows(context:BulkContext,id:string,offset:number,limit:number):Promise<{items:{line:number;action:string;sku?:string;name?:string;issues:BulkIssue[]}[];total:number}>;
 errors(context:BulkContext,id:string):Promise<BulkDownload>;
 download(context:BulkContext,format:"csv"|"xlsx",filters:BulkFilters,template:boolean):Promise<BulkDownload>;
 edit(context:BulkContext,input:{ids:string[];field:BulkField;value:string;operationKey:string}):Promise<BulkJobView>;
};
