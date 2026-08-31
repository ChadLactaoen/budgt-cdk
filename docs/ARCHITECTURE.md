# Low Level Design

> **Status: WIP.** This document covers the datastore design only. API Gateway endpoints and Lambda
> handlers will be added once the data model is settled.

## System Architecture

Serverless, single-user, single-region. CloudFront is the only public entry point: it serves the Vue
SPA from S3 and proxies `/api/*` to API Gateway, so the browser only ever talks to one origin.

```
                        ┌───────────┐
                        │  Browser  │
                        └─────┬─────┘
                              │ HTTPS
              ┌───────────────▼────────────────┐
              │          CloudFront            │
              │  /api/* → API GW  (no cache)   │
              │  /*     → S3      (cached)     │
              └───────┬────────────────┬───────┘
                      │                │
              ┌───────▼──────┐  ┌──────▼───────────────┐   ┌──────────────┐
              │      S3      │  │     API Gateway      │◄──┤   Cognito    │
              │   Vue SPA    │  │  Cognito authorizer  │   │  User Pool   │
              └──────────────┘  └──────────┬───────────┘   └──────────────┘
                                           │
                                ┌──────────▼───────────┐
                                │   Lambda  (api)      │
                                │   Node.js 20.x       │
                                └──────────┬───────────┘
                                           │
                                ┌──────────▼───────────┐
                                │  DynamoDB  "Budgt"   │
                                │  + GSI1              │
                                └──────────────────────┘
```

| Component | Role |
| --- | --- |
| CloudFront | Single origin for the app; TLS, SPA routing, `/api/*` proxy |
| S3 | Static hosting for the built Vue bundle, private behind Origin Access Control |
| API Gateway | REST API, Cognito authorizer on every method |
| Lambda | One Node.js 20.x function with an internal router, bundled by `NodejsFunction` |
| DynamoDB | Single `Budgt` table + GSI1 |
| Cognito | One User Pool holding exactly one user |

### CloudFront routing

Two behaviors on one distribution:

| Path pattern | Origin | Cache policy | Origin request policy |
| --- | --- | --- | --- |
| `/api/*` | API Gateway | `CACHING_DISABLED` | `ALL_VIEWER_EXCEPT_HOST_HEADER` |
| `*` (default) | S3 (OAC) | `CACHING_OPTIMIZED` | — |

`ALL_VIEWER_EXCEPT_HOST_HEADER` is required: it forwards the viewer's `Authorization` header to the
origin while leaving `Host` set to the API Gateway hostname, which API Gateway needs in order to
route the request. `CACHING_DISABLED` keeps authenticated, per-user responses out of the shared CDN
cache.

Because the SPA and the API share an origin, no CORS headers and no `OPTIONS` preflight are needed
anywhere.

### SPA deep links must not use `errorResponses`

CloudFront custom error responses are configured **per distribution, not per behavior**. The stack
currently maps `403` and `404` to `/index.html` with a `200` so that deep links like
`/month/2026-08` resolve — but once API Gateway is an origin on the same distribution, that rule
also rewrites API errors. A `404` from `GET /api/months/2026-09` would come back as an HTML page
with status `200`, silently breaking both the "Period not found" contract and the auth contract.

Replace it with a CloudFront Function on viewer request, which can distinguish the two path spaces:

```js
function handler(event) {
  var uri = event.request.uri;
  if (uri.startsWith('/api/')) return event.request;  // leave API paths alone
  if (uri.includes('.')) return event.request;        // static asset
  event.request.uri = '/index.html';                  // SPA deep link
  return event.request;
}
```

With this in place, `errorResponses` should be removed from the distribution entirely.

## Concepts

### Spending Categories

Spending categories use a two-level structure: every subcategory maps to exactly one parent
category. There are 6 parent categories:

| Parent | Subcategories |
| --- | --- |
| **Bills** | Car, Car Insurance, Electric, Gas, HOA, Home Security, Internet & Cable, Landscaping, Mortgage, Phone, Property Taxes, Sewer, Solar, Trash, Water |
| **Entertainment** | Art & Hobbies, Books, Digital Music, Events & Attractions, Gambling, Gaming, Movies |
| **Essentials** | Dining, Drinks & Snacks, Gas, Groceries, Health & Personal Care |
| **Miscellaneous** | Clothing, Donations, Home, Other, Travel & Lodging |
| **Savings** | Advance, Crypto, IRA, Investments, Rainy Day, Savings |
| **Subscriptions** | AWS, Amazon Prime, Apple Music, Apple TV+, Arlo, Cinemark, HBO Max, HelloFresh, Hulu, Misc Subscriptions, NBA, Netflix, Numberfire, Paramount+, Peacock, Pest Control, Twitch, Viki, YouTube Premium |

Categories are **code-defined, not stored in DynamoDB** — see
[Categories are code-defined](#categories-are-code-defined).

### Amounts

Every monetary value — `Period.amt`, `Allocation.amt`, `Transaction.amt`, `Template.amt`, and the
`Fund` balances — is stored and transmitted as a **signed integer number of cents**. `$11.99` is
`1199`.

DynamoDB is not the reason for this; its `N` type is exact fixed-point decimal. The SDK is:
`DynamoDBDocumentClient` unmarshals `N` into a JavaScript `number`, an IEEE-754 double, and `11.99`
has no exact binary representation. Summing a year of transactions accumulates error, and the
equality checks this design depends on stop being trustworthy.

Integers remove the class of bug instead of papering over it:

- Sums are exact, so the "allocations sum to `Period.amt`" invariant can be enforced as a literal
  `===` rather than a tolerance comparison.
- `left === 0` means what it says.
- Fund balances are maintained by repeated `ADD` on integers, so no drift accumulates over a year of
  incremental updates.
- Range is a non-issue: `Number.MAX_SAFE_INTEGER` is roughly $90 trillion in cents.

Conversion happens only at the frontend's edges — parse on input, format on display — through
helpers in `shared/money.ts`, alongside `shared/categories.ts`. Request and response bodies carry
cents throughout; there is no conversion at the API boundary.

Prose examples in this document are written in dollars for readability. The JSON payloads show the
stored integer form.

### Periods

A Period is a single budget month. `Period.amt` is the total amount allocated for that month, and
the sum of every Allocation belonging to the Period equals `Period.amt`. This invariant is enforced
by the client: the Period and its Allocations are always created and updated together in a single
`TransactWriteItems` call.

### Allocations

An Allocation is the budgeted amount for one category within one Period. Allocations are never
mutated by transaction activity — "amount left" is always derived, never stored:

```
left = Allocation.amt - SUM(Transaction.amt WHERE Transaction.cat = Allocation.cat AND Transaction.src is absent)
```

Allocations sort by their SK, which yields a stable display order grouped by parent category.

### Transactions

A Transaction has exactly one category and a signed amount:

- A **positive** amount is money out — a deduction from the Transaction's category allocation and
  from its Period.
- A **negative** amount is money back in — a credit/refund to that category allocation and to its
  Period.

This sign convention is uniform across every category, with no exceptions.

### Funds

A Fund is a pool of money that is budgeted in one Period but spent in a later one. Today there is a
single fund, **Rainy Day**, but the mechanism is generic.

A fund has two halves:

**Deposits** are ordinary transactions. A `$75` transaction against the `Savings > Rainy Day`
allocation is a normal spend for that month — the money leaves the month's budget and enters the
fund. Nothing about it is special.

**Withdrawals** are ordinary transactions filed under the category the money was *actually* spent
on, carrying a `src` attribute naming the fund it was paid from:

```json
{ "nm": "Amazon", "cat": "MISC_OTHER", "amt": 5000, "src": "FUND#RAINY_DAY" }
```

`src` is not free-form. It is validated on write against a closed registry of known funds, the same
way `cat` is validated against the category set — an unvalidated `src` would write fund state into
an arbitrary partition that nothing ever reads back.

If a transaction somehow carries both a `src` and a fund-backed `cat`, `src` wins: the presence of a
funding source is what defines a withdrawal. The self-referential case — spending a fund's money on
that same fund's category — is meaningless and rejected with `400`.

Because a withdrawal was already budgeted in the month it was deposited, counting it again against a
Period would double-count it. So exactly one rule applies, and it is category-agnostic:

> **Transactions with a `src` attribute are excluded from all Period and Allocation math.**
> They are included in year-level rollups, where they count against their own `cat`.

A refund on a fund-sourced purchase is a negative `amt` with the same `src`, which credits the fund
back.

**Rainy Day scope.** The Rainy Day balance rolls over month to month but is bound by the calendar
year: it resets to $0 on January 1, and any remaining balance is forfeited. The [Fund](#fund) entity
is keyed by year, so each year's balance is a separate, permanent record.

The balance is maintained incrementally rather than recomputed:

```
Fund.bal = SUM(deposits to Savings > Rainy Day) - SUM(amt WHERE src = "FUND#RAINY_DAY")
```

#### Reporting on funds

A deposit into a fund is a transfer, not spending — the money has left the month's budget but has
not yet been spent on anything. Reporting it as spending *and* reporting the eventual withdrawal
under its real category would count the same dollars twice.

So the year rollup applies one adjustment: **a fund's own category reports net deposits (deposits −
withdrawals), which is exactly the fund balance.** Withdrawals are reported under the category they
were actually spent on. With this rule the year's category rows always sum to total allocated,
regardless of how much moved through the fund.

Period-level reporting needs no adjustment: `src` transactions are excluded there, so a deposit is
simply that month's spend on `Savings > Rainy Day`.

### Example: Period, Allocation, Transaction, and Fund

**Month 1** — total allocated $100 (`Period.amt`)

| Allocation (`Allocation.cat`) | Amount (`Allocation.amt`) |
| --- | --- |
| `ENT_MOVIES` | $25 |
| `SAV_RAINY_DAY` | $75 |

1. **$25** to "Cinemark Theatres" (`Transaction.nm`), category `ENT_MOVIES`.
   - Left on Entertainment > Movies: **$0**. Left for the Period: **$75**. Allocations unchanged.
2. **$75** to "Deposit", category `SAV_RAINY_DAY`.
   - Left on Savings > Rainy Day: **$0**. Left for the Period: **$0**. Allocations unchanged.
   - Rainy Day fund started at $0, now **$75**, rolling into next month (same calendar year).

**Month 2** — total allocated $100

| Allocation | Amount |
| --- | --- |
| `ENT_MOVIES` | $25 |
| `BILLS_MORTGAGE` | $75 |
| `MISC_OTHER` | $0 (implied; may not exist as a table item) |
| `SAV_RAINY_DAY` | $0 (implied) |

1. **$75** to "Bank Loan LLC", category `BILLS_MORTGAGE`.
   - Left on Bills > Mortgage: **$0**. Left for the Period: **$25**.
2. **$50** to "Amazon", category `MISC_OTHER`, `src` = `FUND#RAINY_DAY`.
   - Excluded from Period math: left on Miscellaneous > Other is still **$0**, left for the Period
     is still **$25**.
   - Rainy Day fund: **$25** ($75 deposited in Month 1 − $50 withdrawn here).
3. **$25** to "Cinemark Theatres", category `ENT_MOVIES`.
   - Left on Entertainment > Movies: **$0**. Left for the Period: **$0**.

**Year to date (Months 1 and 2)**

Allocations are not tied to a year, so the year view reports only what has been spent across the
year. Every transaction is counted under its own `cat`, whether or not it has a `src`; fund
categories report **net** (see [Reporting on funds](#reporting-on-funds)).

| Line | Amount |
| --- | --- |
| Total allocated (sum of `Period.amt`) | $200 |
| Entertainment > Movies | $50 spent |
| Bills > Mortgage | $75 spent |
| Miscellaneous > Other | $50 spent (the Month 2 fund withdrawal) |
| Savings > Rainy Day | $25 net into the fund ($75 deposited − $50 withdrawn) |
| Remaining (unresolved) | $0 |

The category rows sum to $200, matching total allocated.

## Categories are code-defined

Categories are reference data: a small, closed set that changes rarely and cannot change *at all*
without a deploy, since the UI needs a color and icon for every one. Storing them in DynamoDB buys
nothing and costs a backfill — renaming a category or changing its color would require rewriting
every Allocation and Transaction that references it.

Instead, the category set lives in `shared/categories.ts`, imported by both the Lambda handlers and
the frontend. Items in DynamoDB reference a category only by its **stable ID**:

```ts
export const CATEGORIES = {
  ENT_MOVIES: {
    nm: 'Movies',
    pt: 'Entertainment',
    hex: '#12B7FC',
    icon: 'film',
    active: true,
    memo: 'Non-concession movie-related expenses',
  },
  // ...
} as const;

export type CategoryId = keyof typeof CATEGORIES;
```

IDs follow `<PARENT>_<SUB>` in upper snake case, with these parent prefixes: `BILLS`, `ENT`, `ESS`,
`MISC`, `SAV`, `SUBS` — e.g. `BILLS_PROPERTY_TAXES`, `SUBS_APPLE_TV_PLUS`.

Two rules keep this safe:

1. **An ID is permanent.** Display name, color, icon, and parent may change freely; the ID never
   does. That is what makes a rename a code-only change.
2. **An ID is never deleted.** Retiring a category means setting `active: false`, which removes it
   from the new-transaction picker while leaving historical transactions resolvable.

Display ordering also lives in the enum, so the frontend can sort by name, by parent, or by an
explicit order without touching the table.

## DynamoDB

Single-table design holding multiple entity types, with one GSI to serve transactions by year.

**Base table**

- **Partition key:** `PK` (String)
- **Sort key:** `SK` (String)

**GSI1**

- **Partition key:** `GSI1PK` (String)
- **Sort key:** `GSI1SK` (String)

Only Period and Transaction items carry `GSI1PK`/`GSI1SK`, so GSI1 is a sparse index holding just
those two entities, partitioned by year.

Every item carries a `type` attribute identifying its entity.

## Entities

### Period

```json
{
  "PK": "MONTH#2026-08",
  "SK": "MONTH#2026-08",
  "GSI1PK": "YEAR#2026",
  "GSI1SK": "MONTH#08",
  "memo": "Some note about this period",
  "amt": 100000,
  "type": "PERIOD"
}
```

| Attribute | Description |
| --- | --- |
| `amt` | Total amount allocated for the month |
| `memo` | Free-form note |

The GSI1 keys exist so the year view can read Periods and Transactions in a single query. Because
`MONTH#08` sorts immediately before `MONTH#08#DAY#…`, each Period arrives directly ahead of its own
transactions, and "total allocated for the year" comes free with the transaction list.

### Allocation

```json
{
  "PK": "MONTH#2026-08",
  "SK": "CAT#ENT_MOVIES",
  "cat": "ENT_MOVIES",
  "amt": 2500,
  "type": "ALLOCATION"
}
```

| Attribute | Description |
| --- | --- |
| `cat` | Category ID (see [Categories are code-defined](#categories-are-code-defined)) |
| `amt` | Amount budgeted for this category this month |

An Allocation belongs to exactly one Period (`Allocation.PK = Period.PK`). The sum of every
Allocation `amt` in a Period equals that Period's `amt`.

### Transaction

```json
{
  "PK": "MONTH#2026-08",
  "SK": "DAY#07#TS#1754524800000",
  "GSI1PK": "YEAR#2026",
  "GSI1SK": "MONTH#08#DAY#07#TS#1754524800000",
  "td": "2026-08-07",
  "nm": "Cinemark Theatres",
  "cat": "ENT_MOVIES",
  "amt": 1199,
  "memo": "Some memo",
  "type": "TRANSACTION"
}
```

| Attribute | Description |
| --- | --- |
| `td` | Transaction date (`YYYY-MM-DD`) — when the spend actually happened |
| `nm` | Payee / description |
| `cat` | Category ID |
| `amt` | Signed amount (see [Transactions](#transactions)) |
| `src` | Optional. Funding source, e.g. `FUND#RAINY_DAY`. Present only on fund withdrawals; excludes the transaction from Period math (see [Funds](#funds)). Validated against the closed fund registry on write |
| `memo` | Free-form note |

**Public ID.** The API addresses a Transaction by the composite `<td>_<epochMillis>`, e.g.
`2026-08-07_1754524800000`. `epochMillis` alone is not enough to locate the item — the month is
needed for the partition key and the day for the sort key — but both are recoverable from the
composite: `PK = MONTH#2026-08`, `SK = DAY#07#TS#1754524800000`. The form is URL-safe as-is.

The `DAY#<dd>` segment of the sort key comes from `td`, so transactions sort by the date they
occurred. The `TS#<epochMillis>` segment is the time the item was *written to the table*, which may
differ from `td`; it serves as a uniqueness suffix. As a single-user application with no batch
writes, same-millisecond collisions are not a concern.

### Fund

```json
{
  "PK": "FUND#RAINY_DAY",
  "SK": "YEAR#2026",
  "bal": 2500,
  "dep": 7500,
  "wd": 5000,
  "type": "FUND"
}
```

| Attribute | Description |
| --- | --- |
| `bal` | Current balance (`dep - wd`) |
| `dep` | Total deposited this year |
| `wd` | Total withdrawn this year |

Written in the same `TransactWriteItems` as the transaction that changes it, using `ADD` so the
update is atomic and does not require reading first. A deposit does `ADD bal :amt, dep :amt`; a
withdrawal does `ADD bal :negAmt, wd :amt`.

The update must also carry `SET #t = if_not_exists(#t, :ft)`. On the first write of a new year the
Fund item does not exist yet, and `ADD` alone would create it with only the key and the three
numeric attributes — no `type`. Every read path splits items on `type`, so a fund created that way
would be invisible to the month and year views.

`type` is a DynamoDB reserved word and must be aliased (`#t`) in every expression that names it.

Because the item is keyed by year, the January 1 reset is implicit — `YEAR#2027` simply starts at
zero — and each prior year remains a permanent record of what the fund took in, paid out, and
forfeited.

### Template

A Template is a reusable, pre-filled transaction for recurring spend.

```json
{
  "PK": "TMP#",
  "SK": "TX#Cinemark",
  "nm": "Cinemark Subscription",
  "amt": 1199,
  "cat": "SUBS_CINEMARK",
  "active": true,
  "type": "TEMPLATE"
}
```

| Attribute | Description |
| --- | --- |
| `nm` | Default payee / description |
| `amt` | Default amount |
| `cat` | Category ID |
| `active` | Whether the template appears in the picker. Retired templates are deactivated, not deleted, so past transactions created from them stay attributable |

## Access Patterns

**1. Get the Period, its Allocations, and its Transactions for one month**

```
query where PK = "MONTH#2026-08"
```

Used by the main Period page. Amount left per Allocation is calculated client-side, per the formula
in [Allocations](#allocations).

**2. Get the Period and its Allocations for one month (no Transactions)**

```
query where PK = "MONTH#2026-08" and begins_with(SK, "CAT#")
```

Returns Allocations only; the Period item is fetched by key (pattern 3) alongside it.

**3. Get a single item by key**

```
get where PK = <pk> and SK = <sk>
```

Used for a single Period, Transaction, Template, or Fund.

**4. Get all Periods and Transactions for a year**

```
GSI1 query where GSI1PK = "YEAR#2026", Limit 1000
```

Backs the year dashboard. Returns both entity types in one query: the 12 Period items give total
allocated for the year, and the Transactions give spend by category. Split them on `type`.

The full year is pulled in one query and cached client-side; 1000 is a safety bound well above
expected volume (~50 transactions/month, plus 12 periods). If a response comes back with a
`LastEvaluatedKey`, the client should surface that the year view is truncated rather than silently
under-report.

Because `GSI1SK` is `MONTH#<mm>#DAY#<dd>#TS#<ts>`, this also supports month and date-range slices
via `begins_with` / `between`.

**5. Get a Fund balance for a year**

```
get where PK = "FUND#RAINY_DAY" and SK = "YEAR#2026"
```

A single point read, rather than recomputing from the year's transactions.

**6. Get all Templates**

```
query where PK = "TMP#"
```

## Relationships

- A Period contains many Allocations; an Allocation belongs to exactly one Period.
- A Period contains many Transactions; a Transaction belongs to exactly one Period.
- An Allocation covers many Transactions; a Transaction maps to exactly one Allocation, and only
  when it has no `src`.
- A Fund is credited by Transactions against its own category and debited by Transactions carrying
  its ID in `src`.
- A Category is code-defined and referenced by ID from Allocations, Transactions, and Templates.

## Authentication

A single Cognito User Pool containing exactly one user. The pool and its app client are created by
CDK; the user is added manually after deploy (`aws cognito-idp admin-create-user`, or the console),
since `selfSignUpEnabled` is `false`.

**App client.** SRP only — `userSrp: true`, `userPassword: false`. `USER_PASSWORD_AUTH` sends the
raw password to Cognito and buys nothing here, since the frontend uses Amplify, which speaks SRP
natively. No client secret (`generateSecret: false`), as required for browser clients.

**Token flow.** Amplify signs in against the User Pool and holds the resulting tokens. Every API
request carries the **ID token** in the `Authorization` header as the raw JWT, with no `Bearer`
prefix — the API Gateway Cognito authorizer expects the bare token. Amplify handles refresh.

**Every endpoint is authorized.** Each method is declared with
`authorizationType: COGNITO_USER_POOLS`. The authorizer runs before the Lambda integration, so an
unauthenticated request never reaches application code and can never produce a `404` or any other
status — the "403 takes precedence" requirement holds automatically, with no work in the handler.

**Returning 403 instead of 401.** By default API Gateway answers a missing or malformed token with
`401` and a valid-but-unauthorized token with `403`. To return `403` in both cases, override the
gateway responses:

```ts
api.addGatewayResponse('Unauthorized', {
  type: apigateway.ResponseType.UNAUTHORIZED,
  statusCode: '403',
});
api.addGatewayResponse('AccessDenied', {
  type: apigateway.ResponseType.ACCESS_DENIED,
  statusCode: '403',
});
```

`MISSING_AUTHENTICATION_TOKEN` (an unknown path) already returns `403` and needs no override.

## API

Base path `/api`, proxied by CloudFront to API Gateway. All responses are JSON. All methods require
authentication.

Page URLs and API endpoints are deliberately separate surfaces — the Vue router owns the URLs the
user sees, and the API exposes only the calls that move data. Two page routes fetch the same
resource (`/month/:yearMonth` and `/period?m=:yearMonth` both need a month's periods, allocations
and transactions), so they share one endpoint.

| Method | Path | Access pattern | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/months/{yearMonth}` | 1 + 5 | Month view, and the period edit form |
| `GET` | `/api/years/{year}` | 4 | Year dashboard |
| `GET` | `/api/transactions/{id}` | 3 | Transaction edit form |
| `GET` | `/api/templates` | 6 | Template picker on the transaction form |
| `POST` | `/api/periods` | — | Create or update a Period and its Allocations |
| `POST` | `/api/transactions` | — | Create or update a Transaction |

Creating a new Period or Transaction requires no `GET`: those forms render from
`shared/categories.ts` alone.

### `GET /api/months/{yearMonth}`

`yearMonth` is `YYYY-MM`; anything else is `400`. Returns `404` if the Period does not exist — the
SPA turns that into a "create this period" prompt.

Runs access pattern 1 (the month partition) and access pattern 5 (the fund item) concurrently, since
they live in different partitions. Fund balances are folded into this response rather than exposed
as their own endpoint.

```json
{
  "period": { "yearMonth": "2026-08", "amt": 100000, "memo": "" },
  "allocations": [ { "cat": "ENT_MOVIES", "amt": 2500 } ],
  "transactions": [
    { "id": "2026-08-07_1754524800000", "td": "2026-08-07", "nm": "Cinemark Theatres",
      "cat": "ENT_MOVIES", "amt": 1199, "memo": "" }
  ],
  "funds": [ { "id": "FUND#RAINY_DAY", "bal": 2500, "dep": 7500, "wd": 5000 } ]
}
```

Amount-left math is done client-side, which is why transactions are returned here rather than using
access pattern 2 — the period form needs to show how much of each allocation is already spent.

### `GET /api/years/{year}`

Access pattern 4. Returns raw periods and transactions and lets the client roll them up, since the
client already holds category metadata and caches the result.

```json
{
  "year": "2026",
  "periods": [ { "yearMonth": "2026-08", "amt": 100000 } ],
  "transactions": [ "…" ],
  "funds": [ { "id": "FUND#RAINY_DAY", "bal": 2500, "dep": 7500, "wd": 5000 } ],
  "truncated": false
}
```

`truncated` is `true` when DynamoDB returned a `LastEvaluatedKey` at the 1000-item bound. The client
must surface this rather than render an under-reported year.

### `GET /api/transactions/{id}`

`id` is the composite `<td>_<epochMillis>`. The handler splits it into `PK`/`SK` and does a single
`GetItem`. `404` if absent.

### `POST /api/periods`

Create and update are the same call — the body is the complete desired state, and the write is an
upsert.

```json
{
  "yearMonth": "2026-08",
  "amt": 100000,
  "memo": "",
  "allocations": [
    { "cat": "ENT_MOVIES", "amt": 2500 },
    { "cat": "SAV_RAINY_DAY", "amt": 7500 }
  ]
}
```

The `allocations` array is a **full replacement**, not a delta. The handler reads the existing
allocations, then issues one `TransactWriteItems` containing: a `Put` for the Period, a `Put` for
each submitted Allocation, and a `Delete` for each existing Allocation no longer present. Doing it
in one transaction is what keeps the "allocations sum to `Period.amt`" invariant true at every point
an observer could read the table.

The handler re-validates that invariant and rejects a mismatch with `400`, even though the form
enforces it too — the form is a convenience, the handler is the guarantee. Unknown category IDs are
also `400`.

An item count of 1 Period + up to ~60 Allocations sits well inside the 100-item `TransactWriteItems`
limit.

### `POST /api/transactions`

Upsert. Omitting `id` creates; supplying it updates.

```json
{
  "id": "2026-08-07_1754524800000",
  "td": "2026-08-07",
  "nm": "Amazon",
  "cat": "MISC_OTHER",
  "amt": 5000,
  "src": "FUND#RAINY_DAY",
  "memo": ""
}
```

On create the handler assigns `TS` from `Date.now()`; on update it preserves the original `TS`.

Note that preserving `TS` does **not** make the public ID stable, because the ID is `<td>_<ts>` and
`td` is editable. A write that changes `td` returns a different `id` than it was given, and the
client must adopt the returned value.

Two cases need more than a single `Put`:

**The date changed at all.** `td` feeds both `PK` (via the month) and `SK` (via `DAY#<dd>`), so even
a same-month day edit — the 7th to the 9th — moves the item to a new sort key. The rekey trigger is
therefore `old.td !== new.td`, not "the month changed". The handler issues a `Delete` of the old key
and a `Put` of the new one in one `TransactWriteItems`; treating a same-month edit as a plain `Put`
would leave the original behind as a duplicate.

Because the two operations address different keys, they are legal in one transaction — but when
`td` is unchanged the handler must emit the `Put` alone. `TransactWriteItems` rejects two operations
on the same key with a `ValidationException`.

**The month must already have a Period.** A Transaction may only be filed into a month whose
`PERIOD` item exists. `GET /api/months/{yearMonth}` `404`s when the month partition has no Period, so
a transaction written into one would be invisible everywhere except the year rollup — money that
silently vanishes from the app.

This is enforced as a `ConditionCheck` on `MONTH#<ym> / MONTH#<ym>` with `attribute_exists(PK)`,
prepended to the same `TransactWriteItems` as the write, rather than as a preceding `GetItem`: it is
atomic with the write and costs no extra round trip. The check addresses the Period item's key while
the write addresses `DAY#<dd>#TS#<ts>` in the same partition, so the two never collide. A failure
surfaces as `409 NO_PERIOD` carrying `yearMonth`.

Only the **new** month is checked. On an edit that moves a transaction across months, the old month's
Period must already have existed for the original write to have succeeded.

**The transaction touches a fund.** Fund balances are maintained incrementally, so any write that
changes a fund's inflow or outflow must adjust the `FUND#` item by the delta in the *same*
transaction:

| Change | Effect on the Fund item |
| --- | --- |
| Create a deposit (`cat` is a fund category, no `src`) | `ADD bal :amt, dep :amt` |
| Create a withdrawal (`src` set) | `ADD bal :negAmt, wd :amt` |
| Change the amount | Apply the difference only |
| Move a transaction into or out of a fund | Reverse the previous effect, apply the new one |

Any write that *decreases* a fund balance carries a `ConditionExpression` of `bal >= :decrease` on
the fund item, so an overdraw fails atomically and returns `409` instead of driving the balance
negative. Writes that increase a balance need no condition.

The condition is chosen by the **sign of the computed balance delta**, not by whether the
transaction is a deposit or a withdrawal. Because `amt` is signed, the two do not line up: a deposit
with a negative amount lowers the balance, and so does zeroing out a deposit — which means correcting
a deposit to `0` can legitimately fail with `409` if that money has already been spent.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Success |
| `400` | Malformed path/body, unknown category ID or fund ID, or allocations that do not sum to `Period.amt` |
| `403` | Not authenticated. Returned by the authorizer before any handler runs |
| `404` | The addressed Transaction does not exist, or a month has no Period |
| `409` | Fund overdraw, a missing Period for the target month, or a concurrent modification |
| `500` | Anything else. AWS exception messages are never echoed to the client |

Error bodies are `{ "error": "<message>", "code": "<CODE>" }`. `409` covers four distinguishable
situations, so the `code` is what the client acts on:

| `code` | Cause |
| --- | --- |
| `FUND_OVERDRAW` | The `bal >= :decrease` condition failed. Body also carries `fund`, `year`, and `available` so the UI can name the shortfall |
| `NO_PERIOD` | The target month has no Period. Body also carries `yearMonth`, so the UI can offer to create it |
| `CONCURRENT_MODIFICATION` | The transaction being edited changed between the handler's read and its write |
| `TS_COLLISION` | Two creates landed on the same millisecond. Retried once automatically before surfacing |

`404` is not reachable on `POST /api/periods` — it is an upsert, so a month that does not exist is
simply created.

Both `POST` endpoints return `200` with the canonical stored representation, not an empty body.
`POST /api/transactions` must return the `id`, which may differ from the one supplied (see above).

### Reads that precede writes must be strongly consistent

Both write paths read before they write — `POST /api/periods` reads the existing Allocations to
compute the delete set, and `POST /api/transactions` reads the prior item to compute the fund
reversal. Both reads must set `ConsistentRead: true`.

This matters most on the transaction path. Fund balances are maintained by `ADD`, which applies a
*relative* change and never recomputes from source. A stale read of the prior `amt` therefore
produces a reversal of the wrong number, and the resulting error in the balance is permanent —
nothing downstream ever corrects it. Two quick successive edits of the same transaction are enough
to trigger it against an eventually-consistent read.

The handler additionally pins the prior item's `amt`, `cat`, and `src` in a `ConditionExpression` on
the `Put`/`Delete`, making the update a compare-and-swap: if the item changed after the read, the
whole transaction is cancelled and the client gets `409 CONCURRENT_MODIFICATION` rather than a
silently corrupted fund. With the prior snapshot pinned this way, the fund `ADD` needs no
concurrency condition of its own — only the non-negativity check.

### No delete endpoints

Deletes are deliberately excluded. Duplicates and mistaken entries are resolved by editing the
offending Transaction's `amt` to `0`, not by removing the item. This keeps the write path to a
single upsert and avoids a second code path that would have to reverse fund balances.

A zeroed Transaction is inert everywhere it matters: it contributes nothing to allocation math and
nothing to the year rollup. If it carried a `src`, the amount-change rule above already handles the
reversal — the delta between the old amount and `0` is applied to the `FUND#` item in the same
transaction, restoring the balance exactly.

Zeroed transactions remain visible in the month's transaction list, which is intended: they are the
record that something was corrected. If that gets noisy, filter `amt === 0` out of the view
client-side rather than adding a delete path.

## Frontend

Vue 3 + TypeScript, built with Vite and deployed to S3 as static assets.

| Concern | Choice |
| --- | --- |
| Framework | Vue 3 (Composition API, `<script setup>`) |
| Routing | `vue-router` in history mode |
| Styling | Tailwind CSS 4 |
| Components | DaisyUI 5 |
| Auth | `aws-amplify` v6 (`aws-amplify/auth`) |

### Routes

| Path | View | Data |
| --- | --- | --- |
| `/login` | Login | — (guest only) |
| `/` | redirect | Resolves the current `YYYY-MM` and forwards to `/month/:yearMonth` |
| `/month/:yearMonth` | Month dashboard | `GET /api/months/{yearMonth}` |
| `/year/:year` | Year dashboard | `GET /api/years/{year}` |
| `/period` | Period + Allocations form | none when creating; `GET /api/months/{m}` when `?m=` is present |
| `/transaction` | Transaction form | `GET /api/templates`; plus `GET /api/transactions/{id}` when `?id=` is present |

A global router guard redirects unauthenticated navigation to `/login`, and authenticated
navigation away from it.

### "Current month" is resolved on the client

The `/` route computes the current `YYYY-MM` from the **browser's** clock and redirects. It is never
derived server-side: Lambda runs in UTC, so for a Pacific-time user on August 31st at 6pm local, a
server-side "current month" would return September. Resolving it in the browser and always passing
an explicit `yearMonth` means the API never has to guess a timezone.

If the resulting month has no Period yet, the API returns `404` and the view renders a "create this
period" call to action linking to `/period?m=<yearMonth>`.

### Category metadata comes from code

Names, colors, icons, parents, and display order are read from `shared/categories.ts`, imported
directly into the frontend bundle. The API returns only category IDs, so no request ever fetches
category metadata and there is nothing to cache or invalidate for it.

## Client-Side Caching

Month and year views are read far more often than they are written, and both are re-entered
constantly through normal navigation — back and forth between months, in and out of the transaction
form. Every one of those would otherwise be a cold Lambda plus a DynamoDB query.

**Store.** A reactive module (`src/stores/cache.ts`) holding responses keyed by resource:

| Key | Source |
| --- | --- |
| `month:2026-08` | `GET /api/months/2026-08` |
| `year:2026` | `GET /api/years/2026` |
| `templates` | `GET /api/templates` |

**No TTL.** With one user and one client, the app is the only writer to the table. It observes every
mutation it causes, so cached data cannot go stale on its own and there is nothing to poll for. This
is a direct consequence of the single-user design and would not survive a second user.

**Invalidation is write-driven.** After a successful `POST`, drop exactly the keys that write could
have changed:

| Write | Keys dropped |
| --- | --- |
| `POST /api/periods` for `2026-08` | `month:2026-08`, `year:2026` |
| `POST /api/transactions` in `2026-08` | `month:2026-08`, `year:2026` |
| …where the edit moved the date across months | both months' keys, and both years' if it crossed a year |
| …where the transaction touches a fund | as above; fund balances ride along in those responses |

Fund balances need no separate handling because they are returned inside the month and year payloads
rather than cached on their own.

**Persistence.** The store is mirrored to `sessionStorage`, so a page reload within a tab is
instant, while a new session starts clean. `localStorage` is deliberately avoided: a cache that
outlives the session could serve data written from another device.

**The multi-device caveat.** Invalidation only sees writes made by *this* client. If the app is ever
used from a second device, a write on one leaves the other stale until its session ends. The mitigation
is a manual refresh control on the month and year views that bypasses the cache for one request —
cheap to add, and sufficient for a personal app.

**No HTTP-layer caching.** CloudFront serves `/api/*` with `CACHING_DISABLED`, and API responses set
`Cache-Control: no-store`, so the in-app store is the only cache in the system. This keeps
invalidation in one place instead of spread across a CDN, the browser cache, and the app.

**Optional: prefetch adjacent months.** After a month view loads, fetching the previous and next
months in the background makes the common back-and-forth navigation instant. Cheap, and it fits the
same store and invalidation rules with no special cases.
