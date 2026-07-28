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
};

export type ArtifactZipEntry = {
  relativePath: string;
  data: Uint8Array;
};

export type ArtifactZipWriteInput = {
  executionId: string;
  relativePath: string;
  entries: ArtifactZipEntry[];
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
