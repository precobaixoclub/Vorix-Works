import type {CommercialRule,CommercialRuleInput,RuleScope} from "../../domain/commerce/commercial-rules.js";
export type CommercialRuleRepositoryPort={
 list(scope:RuleScope):Promise<CommercialRule[]>;
 save(scope:RuleScope,input:CommercialRuleInput,actorUserId:string,update?:{id:string;revision:number}):Promise<CommercialRule|undefined>;
 remove(scope:RuleScope,id:string,revision:number,actorUserId:string):Promise<boolean>;
};
