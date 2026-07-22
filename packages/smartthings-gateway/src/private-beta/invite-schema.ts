import { type ColumnType, type Kysely, sql } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"

export type PrivateBetaInviteTable = {
  readonly generationId: string
  readonly issuedAt: ColumnType<Date, Date, Date>
  readonly passwordHash: string
  readonly revokedAt: ColumnType<Date | null, Date | null | undefined, Date | null>
  readonly username: string
}

export async function ensurePrivateBetaInviteStorage(
  database: Kysely<GatewayDatabase>,
): Promise<void> {
  await sql`
    create table if not exists private_beta_invites (
      username varchar(64) primary key,
      generation_id uuid not null default gen_random_uuid(),
      password_hash varchar(64) not null,
      issued_at timestamptz not null,
      revoked_at timestamptz,
      constraint private_beta_invites_username_check
        check (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
      constraint private_beta_invites_password_hash_check
        check (password_hash ~ '^[0-9a-f]{64}$')
    )
  `.execute(database)
  await sql`alter table private_beta_invites add column if not exists generation_id uuid default gen_random_uuid()`.execute(
    database,
  )
  await sql`update private_beta_invites set generation_id = gen_random_uuid() where generation_id is null`.execute(
    database,
  )
  await sql`alter table private_beta_invites alter column generation_id set not null`.execute(
    database,
  )
}
