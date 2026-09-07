# Collaboration V2 worker behavior

The worker mirrors the API collaboration, formal escalation, notification and production-control schemas. Run `npm run check:models` from the worker with the adjacent server checkout present, plus `npm run check:syntax` and `npm test`.

Existing Part Workspace reminder scheduling remains disabled by default. V2 formal candidates target only the current acting company after three days of inactivity, with version/week idempotency. Candidates are ordered together with due conversations and stale reviews. Before queuing, re-read current state/version, active company, relationship, visible revision and production scope; exclude closed/escalated records and synthetic/demo recipients. Formal recipients must have a responding role. Encrypted durable email payloads contain only a secure production deep link and no technical evidence.

Do not enable jobs as part of local verification. Preserve unrelated NDA and billing configuration. Deploy this worker reader alongside the V2 API before enabling new creation. The API release runbook under `docs/collaboration-v2/RELEASE.md` defines the backup, migration and rollback gates.
