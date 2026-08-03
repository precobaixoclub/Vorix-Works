import type { Pool } from "pg";
import type { CreateUserInput, UserRepositoryPort } from "../../../application/ports/user-repository.port.js";
import type { User } from "../../../domain/identity/identity.model.js";

export type UserIdGenerator = () => string;
const defaultIdGenerator: UserIdGenerator = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const UNIQUE_VIOLATION = "23505";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  is_platform_admin: boolean;
};

export class PostgresUserRepository implements UserRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: UserIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: UserIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateUserInput): Promise<User> {
    const id = this.idGenerator();
    try {
      const result = await this.pool.query<UserRow>(
        `insert into users (id, email, password_hash, name, status, created_at, updated_at)
         values ($1, $2, $3, $4, 'active', now(), now())
         returning *`,
        [id, input.email, input.passwordHash, input.name],
      );
      return this.toDomain(result.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === UNIQUE_VIOLATION) {
        throw new Error(`USER_EMAIL_ALREADY_EXISTS: já existe um usuário com o email "${input.email}".`);
      }
      throw error;
    }
  }

  async getById(id: string): Promise<User | undefined> {
    const result = await this.pool.query<UserRow>("select * from users where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getByEmail(email: string): Promise<User | undefined> {
    const result = await this.pool.query<UserRow>("select * from users where lower(email) = lower($1)", [email]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.pool.query("update users set last_login_at = now(), updated_at = now() where id = $1", [id]);
  }

  private toDomain(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      status: row.status as User["status"],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : undefined,
      isPlatformAdmin: row.is_platform_admin === true,
    };
  }
}

function isPgError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
