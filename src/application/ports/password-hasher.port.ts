/** Nunca implementado com um algoritmo reversível — só hash + comparação. Ver `BcryptPasswordHasher`. */
export type PasswordHasherPort = {
  hash(plainPassword: string): Promise<string>;
  verify(plainPassword: string, passwordHash: string): Promise<boolean>;
};
