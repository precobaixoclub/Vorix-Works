import type { ArtifactProvenance } from "../../shared/utils/artifact-provenance.js";

export type ArtifactWrittenFile = {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mimeType?: string;
};

export type ArtifactFileWriteInput = {
  executionId: string;
  relativePath: string;
  content: string | Uint8Array;
  mimeType?: string;
  /** Migração "GPT como motor criativo único" (PR 3/9) — obrigatório de propósito: quem escreve
   * um artefato declara, no mesmo lugar, se ele pode virar peça publicável. Ver
   * `src/shared/utils/artifact-provenance.ts`. */
  provenance: ArtifactProvenance;
};

export type ArtifactZipEntry = {
  relativePath: string;
  data: Uint8Array;
};

export type ArtifactZipWriteInput = {
  executionId: string;
  relativePath: string;
  entries: ArtifactZipEntry[];
  provenance: ArtifactProvenance;
};

export type ArtifactFileReadInput = {
  executionId: string;
  relativePath: string;
};

export type ArtifactReadFile = {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  data: Uint8Array;
  /** Presente só quando o arquivo foi escrito via `ArtifactDeliveryPort.writeFile()`/`createZip()`
   * desta mesma execução. Ausente é o caso NORMAL para conteúdo que chega por fora (ex.:
   * intervenção assistida de um humano/IDE) — nunca tratar ausência aqui como suspeita por si só,
   * ver `isExplicitlyNonPublishable` em `artifact-provenance.ts`. */
  provenance?: ArtifactProvenance;
};

export type ArtifactDeliveryPort = {
  writeFile(input: ArtifactFileWriteInput): Promise<ArtifactWrittenFile>;
  createZip(input: ArtifactZipWriteInput): Promise<ArtifactWrittenFile>;
  /**
   * Lê um arquivo já existente na pasta de artefatos da execução, sem criar nada. Usado pelo
   * Pedro em modo "developer_assisted" para verificar se a imagem esperada já foi salva por
   * intervenção externa antes de retomar o workflow. Devolve `undefined` quando o arquivo ainda
   * não existe (não é um erro — é o caso normal enquanto se aguarda a intervenção).
   */
  readFile(input: ArtifactFileReadInput): Promise<ArtifactReadFile | undefined>;
};
