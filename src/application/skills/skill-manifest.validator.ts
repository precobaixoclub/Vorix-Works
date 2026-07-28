import { SKILL_CAPABILITIES } from "../../domain/skills/skill-capability.contract.js";
import { SKILL_MANIFEST_STATUSES, type SkillManifest } from "../../domain/skills/skill-manifest.contract.js";
import type { SkillManifestValidatorPort } from "./helena.ports.js";
import type { SkillManifestValidationResult } from "./helena.types.js";

export class SkillManifestValidator implements SkillManifestValidatorPort {
  validate(candidate: unknown): SkillManifestValidationResult {
    const errors: string[] = [];

    if (!isRecord(candidate)) {
      return { valid: false, errors: ["Manifesto deve ser um objeto."] };
    }

    requireString(candidate, "id", errors);
    requireString(candidate, "name", errors);
    requireString(candidate, "version", errors);
    requireString(candidate, "description", errors);
    requireString(candidate, "author", errors);
    requireBoolean(candidate, "enabled", errors);
    requireArray(candidate, "capabilities", errors);
    requireArray(candidate, "inputs", errors);
    requireArray(candidate, "outputs", errors);
    requireArray(candidate, "dependencies", errors);
    requireRecord(candidate, "compatibility", errors);
    requireRecord(candidate, "runtime", errors);
    requireRecord(candidate, "responsibilityBoundary", errors);

    if (typeof candidate.version === "string" && !/^\d+\.\d+\.\d+$/.test(candidate.version)) {
      errors.push("version deve seguir o formato semver x.y.z.");
    }

    if (Array.isArray(candidate.capabilities)) {
      const allowedCapabilities = new Set<string>(SKILL_CAPABILITIES);
      candidate.capabilities.forEach((capability, index) => {
        if (typeof capability !== "string" || !allowedCapabilities.has(capability)) {
          errors.push(`capabilities[${index}] é inválida.`);
        }
      });
      if (candidate.capabilities.length === 0) {
        errors.push("capabilities deve conter pelo menos uma capability.");
      }
    }

    if (typeof candidate.status !== "string" || !SKILL_MANIFEST_STATUSES.includes(candidate.status as never)) {
      errors.push("status deve ser experimental, stable ou deprecated.");
    }

    if (candidate.owner !== "helena-managed") {
      errors.push("owner deve ser helena-managed.");
    }

    if (isRecord(candidate.compatibility)) {
      requireString(candidate.compatibility, "zuno", errors, "compatibility.zuno");
    }

    if (isRecord(candidate.runtime)) {
      requireString(candidate.runtime, "entrypoint", errors, "runtime.entrypoint");
    }

    if (isRecord(candidate.responsibilityBoundary)) {
      requireArray(candidate.responsibilityBoundary, "allowed", errors, "responsibilityBoundary.allowed");
      requireArray(candidate.responsibilityBoundary, "forbidden", errors, "responsibilityBoundary.forbidden");
    }

    validateIOContracts(candidate.inputs, "inputs", errors);
    validateIOContracts(candidate.outputs, "outputs", errors);
    validateDependencies(candidate.dependencies, errors);

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, manifest: candidate as SkillManifest };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (typeof record[key] !== "string" || !record[key]) {
    errors.push(`${label} é obrigatório e deve ser texto.`);
  }
}

function requireBoolean(record: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (typeof record[key] !== "boolean") {
    errors.push(`${label} é obrigatório e deve ser booleano.`);
  }
}

function requireArray(record: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (!Array.isArray(record[key])) {
    errors.push(`${label} é obrigatório e deve ser lista.`);
  }
}

function requireRecord(record: Record<string, unknown>, key: string, errors: string[], label = key): void {
  if (!isRecord(record[key])) {
    errors.push(`${label} é obrigatório e deve ser objeto.`);
  }
}

function validateIOContracts(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${label}[${index}] deve ser objeto.`);
      return;
    }
    requireString(item, "name", errors, `${label}[${index}].name`);
    requireString(item, "description", errors, `${label}[${index}].description`);
  });
}

function validateDependencies(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`dependencies[${index}] deve ser objeto.`);
      return;
    }
    requireString(item, "name", errors, `dependencies[${index}].name`);
    if ("optional" in item && typeof item.optional !== "boolean") {
      errors.push(`dependencies[${index}].optional deve ser booleano quando informado.`);
    }
  });
}
