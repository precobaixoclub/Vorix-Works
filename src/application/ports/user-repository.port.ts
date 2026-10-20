import type { User } from "../../domain/identity/identity.model.js";

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl?: string;
};

export type UserRepositoryPort = {
  create(input: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User | undefined>;
  getByEmail(email: string): Promise<User | undefined>;
  updateProfile(id: string, input: { name: string; email: string; avatarUrl?: string | null }): Promise<User | undefined>;
  touchLastLogin(id: string): Promise<void>;
};
