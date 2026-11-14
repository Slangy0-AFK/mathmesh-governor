import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error('DATABASE_URL is required.');

export const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined,
});

export const ENTITY_NAMES = [
  'AdmissionTicket', 'AgentIdentity', 'AuditLog', 'DriftEvalResult', 'EgressAllowlist',
  'GroundingReview', 'HarnessControl', 'KnowledgeBase', 'PipelineRun', 'ResponseCache',
  'TokenSpend',
];

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_records (
      entity text NOT NULL,
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (entity, id)
    );
    CREATE INDEX IF NOT EXISTS app_records_entity_created_idx ON app_records (entity, created_at DESC);
    CREATE INDEX IF NOT EXISTS app_records_data_gin_idx ON app_records USING gin (data);
  `);

  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (email && password) {
    const { hashPassword } = await import('./auth.js');
    const passwordHash = await hashPassword(password);
    await pool.query(
      'INSERT INTO app_users (email, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [email, passwordHash, 'admin'],
    );
  }
}

function assertEntity(entity) {
  if (!ENTITY_NAMES.includes(entity)) throw new Error(`Unknown entity: ${entity}`);
}

function orderBy(sort = '-created_date') {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  if (!/^[a-z][a-z0-9_]*$/i.test(field)) throw new Error('Invalid sort field.');
  const column = field === 'created_date'
    ? 'created_at'
    : field === 'updated_date'
      ? 'updated_at'
      : field === 'seq'
        ? "(data->>'seq')::numeric"
        : `data->>'${field}'`;
  return `${column} ${descending ? 'DESC' : 'ASC'}, id ASC`;
}

function decodeRow(row) {
  return row ? { ...row.data, id: row.id, created_date: row.created_at.toISOString(), updated_date: row.updated_at.toISOString() } : null;
}

async function tokenWindowSpend(client, agentId, windowSeconds) {
  const result = await client.query(`
    SELECT COALESCE(SUM((data->>'tokens_total')::numeric), 0) AS spent
    FROM app_records
    WHERE entity = 'TokenSpend' AND data->>'agent_id' = $1
      AND data->>'phase' IS DISTINCT FROM 'refunded'
      AND created_at >= clock_timestamp() - ($2 * interval '1 second')
  `, [agentId, windowSeconds]);
  return Number(result.rows[0].spent);
}

export const tokenLedger = {
  windowSpend: (agentId, windowSeconds) => tokenWindowSpend(pool, agentId, windowSeconds),
  async withReservationLock(agentId, callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('token-budget:' || $1, 0))", [agentId]);
      const result = await callback({
        windowSpend: (windowSeconds) => tokenWindowSpend(client, agentId, windowSeconds),
        async create(data) {
          const inserted = await client.query(
            "INSERT INTO app_records (entity, data, created_at, updated_at) VALUES ('TokenSpend', $1::jsonb, clock_timestamp(), clock_timestamp()) RETURNING id, created_at, updated_at, data",
            [JSON.stringify(data)],
          );
          return decodeRow(inserted.rows[0]);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

export function entityStore(entity) {
  assertEntity(entity);
  return {
    async list(sort = '-created_date', limit = 100) {
      const safeLimit = Math.max(0, Math.min(Number(limit) || 100, 1000));
      const result = await pool.query(`SELECT id, created_at, updated_at, data FROM app_records WHERE entity = $1 ORDER BY ${orderBy(sort)} LIMIT $2`, [entity, safeLimit]);
      return result.rows.map(decodeRow);
    },
    async filter(criteria = {}, sort = '-created_date', limit = 100) {
      const safeLimit = Math.max(0, Math.min(Number(limit) || 100, 1000));
      const values = [entity];
      const clauses = ['entity = $1'];
      for (const [field, expected] of Object.entries(criteria || {})) {
        if (field === 'id') {
          values.push(expected);
          clauses.push(`id = $${values.length}::uuid`);
        } else if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
          values.push(expected.$in.map(String));
          values.push(field);
          clauses.push(`data ->> $${values.length} = ANY($${values.length - 1}::text[])`);
        } else {
          values.push(JSON.stringify({ [field]: expected }));
          clauses.push(`data @> $${values.length}::jsonb`);
        }
      }
      values.push(safeLimit);
      const result = await pool.query(`SELECT id, created_at, updated_at, data FROM app_records WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy(sort)} LIMIT $${values.length}`, values);
      return result.rows.map(decodeRow);
    },
    async create(data = {}) {
      const result = await pool.query(
        'INSERT INTO app_records (entity, data) VALUES ($1, $2::jsonb) RETURNING id, created_at, updated_at, data',
        [entity, JSON.stringify(data)],
      );
      return decodeRow(result.rows[0]);
    },
    async update(id, patch = {}) {
      const result = await pool.query(
        'UPDATE app_records SET data = data || $3::jsonb, updated_at = now() WHERE entity = $1 AND id = $2 RETURNING id, created_at, updated_at, data',
        [entity, id, JSON.stringify(patch)],
      );
      if (!result.rows[0]) throw new Error(`${entity} record not found.`);
      return decodeRow(result.rows[0]);
    },
    async delete(id) {
      const result = await pool.query('DELETE FROM app_records WHERE entity = $1 AND id = $2 RETURNING id', [entity, id]);
      return { id: result.rows[0]?.id || id };
    },
  };
}