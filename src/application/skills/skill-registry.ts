import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { Skill } from "../../domain/skills/skill.contract.js";
import type { SkillState } from "../../domain/skills/skill-state.contract.js";
import type { SkillRegistryPort } from "./helena.ports.js";
import type { DiscoveredSkillSource, RegisteredSkillRecord } from "./helena.types.js";

export class SkillRegistry implements SkillRegistryPort {
  private readonly recordsBySourceId = new Map<string, RegisteredSkillRecord>();

  registerDiscovered(source: DiscoveredSkillSource, occurredAt: string): RegisteredSkillRecord {
    const existing = this.recordsBySourceId.get(source.sourceId);
    if (existing) {
      const updated = { ...existing, source, state: "DISCOVERED" as SkillState, updatedAt: occurredAt };
      this.recordsBySourceId.set(source.sourceId, updated);
      return updated;
    }

    const record: RegisteredSkillRecord = {
      source,
      state: "DISCOVERED",
      validationErrors: [],
      updatedAt: occurredAt,
    };
    this.recordsBySourceId.set(source.sourceId, record);
    return record;
  }

  attachManifest(sourceId: string, manifest: RegisteredSkillRecord["manifest"], occurredAt: string): RegisteredSkillRecord {
    const record = this.requireRecord(sourceId);
    const updated = { ...record, manifest, updatedAt: occurredAt };
    this.recordsBySourceId.set(sourceId, updated);
    return updated;
  }

  attachSkill(sourceId: string, skill: Skill, occurredAt: string): RegisteredSkillRecord {
    const record = this.requireRecord(sourceId);
    const updated = { ...record, skill, loadedAt: occurredAt, updatedAt: occurredAt };
    this.recordsBySourceId.set(sourceId, updated);
    return updated;
  }

  updateState(
    sourceId: string,
    state: SkillState,
    occurredAt: string,
    details: { validationErrors?: string[]; disabledReason?: string } = {},
  ): RegisteredSkillRecord {
    const record = this.requireRecord(sourceId);
    const updated = {
      ...record,
      state,
      validationErrors: details.validationErrors ?? record.validationErrors,
      disabledReason: details.disabledReason ?? record.disabledReason,
      updatedAt: occurredAt,
    };
    this.recordsBySourceId.set(sourceId, updated);
    return updated;
  }

  findByCapability(capability: SkillCapability): RegisteredSkillRecord | undefined {
    // `state` reflete só o resultado da execução MAIS RECENTE (mutado a cada `executeSkill`, sem
    // controle de concorrência) — nunca usar como gate de disponibilidade, ou uma segunda geração
    // concorrente vê a Skill como "RUNNING" e falha com SKILL_NOT_FOUND, e uma Skill cuja última
    // chamada falhou fica permanentemente indisponível até o processo reiniciar. `skill` só é
    // atribuído uma vez, em `attachSkill`, e nunca é removido depois — é o sinal correto e estável
    // de "carregou com sucesso e nunca foi desabilitada".
    return this.list().find((record) => record.skill !== undefined && record.manifest?.capabilities.includes(capability));
  }

  getBySkillId(skillId: string): RegisteredSkillRecord | undefined {
    return this.list().find((record) => record.manifest?.id === skillId);
  }

  getBySourceId(sourceId: string): RegisteredSkillRecord | undefined {
    return this.recordsBySourceId.get(sourceId);
  }

  list(): RegisteredSkillRecord[] {
    return Array.from(this.recordsBySourceId.values());
  }

  private requireRecord(sourceId: string): RegisteredSkillRecord {
    const record = this.recordsBySourceId.get(sourceId);
    if (!record) {
      throw new Error(`Skill source não registrada: ${sourceId}`);
    }
    return record;
  }
}
