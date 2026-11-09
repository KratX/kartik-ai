# ADR 0004 — PostgreSQL as the primary datastore

- **Status:** Accepted
- **Date:** 9 November 2026
- **Phase:** 0.1
- **Supersedes:** the unrecorded MongoDB assumption carried in v1 through v3.2

## Context

Every edition of the blueprint before v4.0 specified MongoDB for the four service databases. No ADR recorded that decision. ADR 0000 states that *"every later decision that is expensive to reverse gets its own numbered ADR"* — the primary datastore is the most expensive-to-reverse decision in the project, and it was the one decision that had no record. It was inherited from the tutorial the project is based on and never tested against the schema the project actually defines.

The owner asked, at Phase 0, why MongoDB and not Postgres. Answering it honestly required reading the schema instead of the tutorial.

## What the schema actually is

Section 5.1 of the blueprint defines sixteen entities. Every one is a flat record: `Reservation` references `CreditAccount`, `LedgerEntry` references both, and every table references `user_id`. **Nothing embeds.** The only document-shaped fields are four optional values on one type — `attachments`, `citations`, `usage`, `error` — plus artifact `metadata` and the execution `result`.

The billing system's central guarantee is `Σ ledger_entries.amount = credit_accounts.balance`. That is a cross-row invariant over an append-only table.

## Options

1. **Keep MongoDB, record an ADR.** No rework. Accepts a replica set that exists only to provide transactions, and an append-only rule enforced by convention.
2. **PostgreSQL.** Relational modelling, real constraints, transactions by default, `jsonb` where flexibility is genuinely useful.
3. **Both** — Postgres for billing, Mongo for chat and agent content. Technically defensible, but doubles the backup path, the restore drill and the failure modes for a project whose stated goal includes demonstrating operational discipline.

## Decision

**Option 2.** One PostgreSQL database, `kartik`, with four schemas — `auth`, `chat`, `agent`, `billing` — and one login role per service holding a grant on exactly one schema.

Managed by **Neon** on the free tier in Profiles A, P and B. Local development uses the `postgres:17-alpine` image in `infra/compose/docker-compose.yml`.

Data access is `pg` with hand-written SQL inside repository modules, and numbered `.sql` migration files applied by a runner in `backend/shared/database`. **No ORM.** The SQL a reviewer reads in §5.1 is the SQL that executes.

## Why not the alternatives

**Why not MongoDB.** It stores this model correctly and queries it less comfortably. Three specific costs:

- **The replica-set tax.** Billing needs multi-document transactions; MongoDB provides those only on a replica set. That is configuration which exists solely to grant the database a property PostgreSQL has without configuration. When one option must be reconfigured to match the other's default behaviour, the comparison is over.
- **Append-only is a convention.** "`LedgerEntry` rows are never updated" was prose. Under Postgres it is a trigger that raises an exception and a revoked `UPDATE`/`DELETE` grant, so the deletion cascade physically cannot touch financial history.
- **The invariant is a query.** `Σ ledger = balance` is a `GROUP BY … HAVING` that runs in CI. In a document store it is a hand-maintained aggregation.

**Why not four databases.** Splitting the services into four PostgreSQL *databases* would make cross-database transactions impossible, and Billing's reserve path needs a transaction spanning `credit_accounts`, `reservations` and `ledger_entries`. Schemas inside one database give the same isolation through grants while keeping transactions available. No transaction in this system spans two services, so the schema boundary and the transaction boundary are the same line.

**Why not an ORM.** Drizzle or Prisma would generate the DDL, which makes the schema one layer removed from the document a reviewer reads and one layer removed from the migration that runs. The project's teaching value depends on the SQL being visible. If the volume of hand-written SQL becomes the bottleneck at Phase 13, a query builder can be added then — as its own ADR.

**Why Neon and not Supabase.** Supabase's free tier pauses a project after **7 days of inactivity** and requires a manual dashboard restore. A portfolio link is clicked at unpredictable hours; a database that is down until the owner logs in is a broken link. Neon scales compute to zero and wakes automatically in well under a second, which a visitor never notices.

## Consequences

- **Positive:** overdraw is prevented by a row lock plus a predicate, not by application arithmetic. Ten concurrent reserves against a balance of five produce five successes and five rejections, and the database is what guarantees it.
- **Positive:** append-only history is enforced twice — revoke and trigger — so neither a bug nor a future migration can rewrite it.
- **Positive:** Neon's free tier includes a **6-hour point-in-time restore window**, which Atlas M0 does not have at all. The project still runs a nightly `pg_dump -Fc` to R2, because six hours is shorter than a weekend.
- **Positive:** constraints that were previously implicit become explicit — `uploaded_files.status = 'indexed'` requires a chunk count; a conversation in a non-`active` deletion state requires a `purge_after`.
- **Negative:** Neon's free allowance is **100 CU-hours per month**. A connection pool that holds connections open keeps compute permanently awake and burns roughly 180 CU-hours. `idleTimeoutMillis` must be set to 10 seconds on every pool, and Phase 16 must verify from the usage graph that compute is actually suspending. This is the most likely way to accidentally exhaust the free tier.
- **Negative:** migrations are now a first-class concern. Every schema change is a numbered file, applied forward only; there are no down-migrations, because a rollback that drops a column destroys data that the rollback cannot restore.
- **Negative:** the pooled connection string cannot run migrations — a transaction-mode pooler does not support the session state a migration needs. Two URLs, `DATABASE_URL` and `DIRECT_DATABASE_URL`, and using the wrong one fails in a confusing way.
- **Cost paid:** Phase 0. Zero application code existed. The same change at Phase 13 would have meant rewriting every repository, every test fixture and every seed script.
- **Revisit when:** a query pattern emerges that Postgres genuinely serves badly. Vector search is already delegated to Qdrant for that reason; do not add a second datastore without the same standard of evidence this ADR applied to the first.

## What this does not change

The API surface (22 paths, 25 operations), the service boundaries, the run-identity contract, the deletion ordering and the error catalogue are identical to v3.2. A storage engine changed; the architecture did not. That is the evidence that the architecture was described in terms of responsibilities rather than in terms of a database.
