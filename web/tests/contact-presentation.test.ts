import {describe,it,expect} from "vitest";
import {contactLabel,contactNameForInput,commercialTitle} from "../features/crm/contact-presentation";
describe("identificação canônica de contatos",()=>{
 it("identifica nome e telefone brasileiro e internacional",()=>{
  expect(contactLabel({name:"João da Silva",phone:"+5546999999999"})).toBe("João da Silva · (46) 99999-9999");
  expect(contactLabel({name:"Jane",phone:"+14155552671"})).toBe("Jane · +1 415 555 2671");
 });
 it.each(["Lead","Lead 123","Lead123","lead_xxx","contact-123","intent-456","conversation-789","LID_210656032780390","."])("usa telefone no lugar de %s",name=>{
  expect(contactLabel({name,customFields:{phone:"+5546999999999"}})).toBe("(46) 99999-9999");
 });
 it("não transforma rótulo de exibição em nome salvo nem repete o telefone",()=>{
  const contact={contactName:"João da Silva · (46) 99999-9999",contactPhone:"+5546999999999"};
  expect(contactNameForInput(contact)).toBe("João da Silva");
  expect(contactLabel(contact)).toBe(contact.contactName);
 });
 it("não apresenta ID como título nem LID como telefone",()=>{
  expect(commercialTitle("lead_old_snapshot","Proposta")).toBe("Proposta");
  expect(contactLabel({name:"Lead 123",phone:"210656032780390"})).toBe("Contato sem telefone");
 });
});
