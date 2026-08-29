# Velakron Worker

This is Velakron's independently deployable background runtime. It provides
health/readiness endpoints, structured logs, job registration, parity-checked
server/worker models, the Phase 7 durable Gmail delivery path, scheduled
report/write boundaries, private-file scan handling, and maintenance sweeps.

`VELAKRON_JOBS_ENABLED` and `VELAKRON_EMAIL_DELIVERY_ENABLED` both default to
`false`. Gmail cannot be called unless both are explicitly enabled, the Gmail
adapter is selected, all credentials are present, and non-production recipients
are allowlisted. The worker refuses any database other than `velakron` outside
isolated tests.

## Local setup

1. Copy `.env.example` to ignored `config.env` and use only the `velakron`
   database.
2. Run `npm install`.
3. Run `npm test` and `npm run check:models`.
4. Run `npm run dev` to expose health endpoints on `127.0.0.1:5004`.

`GET /health` reports process, scheduler, email, and scanner state. `GET /ready`
reports whether the exact database and each enabled provider are verified. The
outbox claimant handles only enabled registered event types and uses leases,
bounded batches, retry/backoff, and dead-letter state. Identity email is active
in the prototype. While the approved prototype policy disables malware scans,
the API does not queue attachment scan events; format-verified files can become
available while remaining explicitly marked as unscanned.

The worker contains an inactive GuardDuty Malware Protection for S3 adapter.
It verifies the exact AWS account and bucket region, reads only the provider's
scan-result tag, treats missing tags as pending, and makes an attachment
available only for `NO_THREATS_FOUND`. Enabling the AWS feature and the worker
switches is an explicit checkpoint documented in
[`docs/operations/malware-scanning-prototype.md`](../docs/operations/malware-scanning-prototype.md).
Scheduled attention and maintenance writes remain off until production-like
records exist for the dry-run comparison; maintenance is non-destructive and
report-only by default.

Inspection reminders are separately gated. Evaluation uses
`VELAKRON_INSPECTION_REMINDERS_ENABLED`; durable reminder email writes also
require `VELAKRON_INSPECTION_REMINDER_WRITES_ENABLED=true`. Messages are generic
and omit technical data. The default remains no reminder writes.

The complete one-time Gmail setup and rollback procedure is in
[`docs/operations/gmail-prototype.md`](../docs/operations/gmail-prototype.md).

## Commands

- `npm run dev` — development worker on port 5004
- `npm start` — production worker
- `npm test` — isolated worker/provider contract tests
- `npm run check:syntax` — validate worker JavaScript syntax
- `npm run check:models` — verify shared server/worker schema parity
- `npm run gmail:authorize` — one-time local authorization for the dedicated
  Velakron mailbox; this does not send an email
