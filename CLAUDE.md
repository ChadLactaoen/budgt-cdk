# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Backend / infra (repo root):

```bash
npm run build                    # tsc — type-checks bin/, lib/, lambda/, shared/, scripts/, test/
npm test                         # Jest (ts-jest); roots is test/ only
npm test -- -t "test name"       # Single test by name
npx cdk synth | diff | deploy    # CDK toolkit
```

Frontend (`frontend/`):

```bash
npm run dev        # Vite dev server
npm run typecheck  # vue-tsc --noEmit — the only check for frontend code; `npm run build` does not type-check
npm run build      # Vite build into frontend/dist/ (gitignored)
```

There is no linter or formatter in this repo.

Full deploy — `frontend/dist/` is gitignored but `BucketDeployment` reads it from disk, so it must
exist before synth:

```bash
cd frontend && npm install && npm run build && cd ..
npx cdk deploy
```

Local frontend development needs `frontend/.env.local` (untracked):

```
VITE_USER_POOL_ID=...
VITE_USER_POOL_CLIENT_ID=...
VITE_API_PROXY=https://<cloudfront-domain>   # optional; Vite proxies /api to the deployed stack
```

The dev server has no API of its own. Without `VITE_API_PROXY` every `/api` call fails.

One-off data migrations from the legacy tables: `npx ts-node scripts/migrate-<name>.ts` (each script
self-invokes; region and source/target table names are hardcoded near the top).

## Design source of truth

`docs/ARCHITECTURE.md` is the low-level design: entity shapes, key schema, access patterns, API
contracts, status codes, auth, and the caching model. **Read the relevant section before changing
the data model, adding an endpoint, or touching the cache** — most non-obvious code decisions are
argued there and repeated as comments at the point of use.

## Architecture

```
Browser → CloudFront ─┬─ /*     → S3 (Vue SPA, cached)
                      └─ /api/* → API Gateway (Cognito authorizer) → Lambda → DynamoDB "Budgt"
```

Single-user, single-region, single stack (`lib/budgt-cdk-stack.ts`), single Lambda, single DynamoDB
table. CloudFront is the only public origin, so the app is same-origin with the API and there is no
CORS anywhere.

### Three code trees, one type system

| Tree | Runs where | Notes |
| --- | --- | --- |
| `lib/`, `bin/` | CDK synth | The whole stack is one file |
| `lambda/api/` | Lambda (Node 20, esbuild via `NodejsFunction`) | One function, internal router |
| `frontend/src/` | Browser (Vue 3 + Vite) | Separate `package.json` and tsconfig |
| `shared/` | Both Lambda and browser | Imported by relative path from `lambda/`, and as `@shared/*` from the frontend (alias in `vite.config.ts`) |

`shared/` is the reason the same category IDs, fund registry, and cents arithmetic cannot drift
between client and server. Anything both sides must agree on belongs there.

### Lambda API

`lambda/api/index.ts` dispatches on `` `${event.httpMethod} ${event.resource}` `` against a flat
`ROUTES` map. There is no `{proxy+}` — every method is declared individually in the stack. **Adding
an endpoint means two edits: a `ROUTES` entry and an `apiRoot.addResource(...).addMethod(...)` call
in `lib/budgt-cdk-stack.ts`.** API Gateway resources must hang off the `api` root resource, because
`RestApiOrigin` sets `originPath` to `/{stage}`.

Layering inside `lambda/api/`:

- `handlers/` — one file per route: parse, orchestrate, respond. No business rules.
- `domain/` — pure-ish logic (`funds.ts` is fully pure; `periods.ts`/`transactions.ts` also build
  DynamoDB transact items). This is where the invariants live and the only layer with unit tests.
- `keys.ts` — every PK/SK/GSI1 key format, and transaction ID encode/decode. Never build a key inline.
- `validate.ts` / `errors.ts` — throw `ApiError` with a code from the `ErrorCode` union; the top-level
  handler is the only place that turns one into a response.
- `ddb.ts` — the document client plus `transactWrite(Tagged[])`, which maps a `ConditionalCheckFailed`
  back to a meaningful error by its index in `CancellationReasons`. Conditioned writes must go through
  it so a failure keeps its meaning.

### Invariants that are easy to break

- **Money is signed integer cents, everywhere.** Conversion to and from dollars happens only in
  `shared/money.ts`, at the frontend's edges. Never put a float amount into an item or a payload.
- **Category and fund IDs are permanent and closed.** `shared/categories.ts` and `shared/funds.ts`
  are the registries; nothing about them is stored in DynamoDB. Never rename or delete an ID — retire
  a category with `active: false` so historical items stay resolvable. `src` on a transaction is
  validated against the fund registry on every write.
- **Fund state is derived, never stored on the transaction.** `domain/funds.ts#effect` computes a
  transaction's fund impact from `(td, cat, src, amt)`, and `fundDelta(old, new)` reverses the old
  effect and applies the new one. `bal === dep - wd` holds by construction; keep it that way.
- **Reads that precede a write must use `ConsistentRead: true`.** Fund balances are maintained with
  `ADD` (a relative change, never recomputed), so a stale read of the prior amount corrupts the
  balance permanently.
- **A transaction ID encodes its date** (`<td>_<ts>`), so editing the date changes the ID. Writes
  return the canonical id; callers must adopt it.
- **`.gitignore` ignores `*.js` at the root** (only `jest.config.js` is unignored). A new `.js` file
  anywhere in the repo is silently untracked — this is why the CloudFront SPA-rewrite function is
  inline in the stack rather than a separate file.
- **No delete endpoints exist**, by design. Don't add one without reading `docs/ARCHITECTURE.md`.

### Frontend

Vue 3 `<script setup>` + vue-router (history mode) + Tailwind 4 + DaisyUI 5, auth via
`aws-amplify/auth` (SRP; the API Gateway authorizer expects the bare **ID token**).

- **Config is loaded at runtime, not built in.** CDK writes `/config.json` (region, user pool IDs)
  into the S3 bucket at deploy time; `src/config.ts` fetches it and falls back to `VITE_*` env vars
  for local dev. Never bake pool IDs into the bundle.
- **The current month is resolved from the browser clock** (`router/index.ts#currentYearMonth`) and
  always passed explicitly. Lambda runs in UTC, so a server-side "current month" would be wrong for
  a Pacific-time user late in the month.
- **Caching lives in `src/stores/cache.ts`** — a reactive store keyed by `month:YYYY-MM`,
  `year:YYYY`, `templates`, mirrored to `sessionStorage`. There is no TTL: the app is the only writer,
  so invalidation is write-driven. After any successful write call `invalidateMonths(...)` with
  **every** month the write touched (an edit that moves a date across months affects both). Fund
  balances ride along inside month/year payloads and need no key of their own.
- **Category metadata is imported from `@shared/categories`**, never fetched. The API returns IDs only.

#### The "Heeth" design system

`frontend/src/components/heeth/` (prefix `H`) is a hand-rolled neo-brutalist component set: white
borders, zero-blur offset shadows, and a press that translates down-right instead of lifting. It is
built on CSS custom properties in `src/styles/tokens/` — colors, type, spacing, borders, shadows,
motion — pulled together by `src/style.css`, which also expresses the palette as a DaisyUI theme so
older DaisyUI-based views still read as one app. `src/styles/heeth.css` patches those raw DaisyUI
controls.

When building UI: use the `H*` components and the token variables. Don't introduce raw hex values or
ad-hoc spacing, and don't reach for a DaisyUI class where an `H*` component exists.

## Testing

`test/` holds two kinds of tests, both run by the root `npm test`:

- `budgt-cdk.test.ts` — synthesizes the stack and asserts on the CloudFormation template with
  `aws-cdk-lib/assertions`. Use `Match.objectLike()` / `Match.anyValue()`, since most values are
  CloudFormation references rather than literals.
- `funds.test.ts` — pure unit tests of the fund-delta algebra, importing from `lambda/api/domain/`.

Handlers, the frontend, and DynamoDB interaction are not covered. New pure domain logic should get
tests here; keep it in `domain/` so it stays testable without AWS.
