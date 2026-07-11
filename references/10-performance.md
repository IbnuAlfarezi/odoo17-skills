# Performance

Governs: ORM optimization, avoiding N+1 queries, efficient `search()`, `read_group()`/`_read_group()`, batch create/write, SQL only when appropriate, caching, computed field optimization.

Performance problems in Odoo modules are disproportionately caused by a small number of recurring patterns, all covered below. Fixing them is rarely about clever optimization — it's about not accidentally defeating the ORM's existing batching/prefetching machinery, which is already quite good when used as intended (see `references/03-python-orm-advanced.md` §6 for the prefetching mechanics this file builds on).

---

## 1. ORM optimization — general principles

### Explanation

The ORM converts recordset operations into batched SQL — but only when the *shape* of your code lets it. The most common way to accidentally opt out of batching is breaking a recordset apart (re-`browse()`-ing individual IDs) or calling ORM methods inside a loop instead of before/after it.

### Best Practice

- Fetch once, operate on the whole recordset, write once. This is the single organizing idea behind every specific technique below.
- Profile before optimizing — Odoo's `--log-handler odoo.sql_db:DEBUG` (or the developer-mode query count/time shown in the debug toolbar) tells you the actual query count and time for a given operation; don't guess.
- Treat any loop containing an ORM call (`search`, `browse` of a single new ID, `create`, `write`) as a place to stop and ask "can this be hoisted out of the loop?"

### Odoo 17 Notes

`_read_group()` (§4) and the `precompute=True` field option (`references/02-python-models-fields.md` §5) are the two genuinely new performance-relevant tools available in 17 relative to 16 — otherwise, the underlying batching/prefetching mechanics are unchanged.

---

## 2. Avoiding N+1 queries

### Explanation

"N+1" means: one query to fetch N records, then N additional queries — one per record — to fetch something related to each of them, when a single additional query (or zero extra queries, via prefetch) could have fetched all N at once.

```python
# ❌ N+1: one query for orders, then one query PER ORDER for its partner's country
orders = self.env['plant.order'].search([])
for order in orders:
    country = self.env['res.partner'].browse(order.partner_id.id).country_id  # re-browse breaks prefetch
    print(country.name)
```

```python
# ✅ Batched: one query for orders, one batched query for all partners' countries
orders = self.env['plant.order'].search([])
for order in orders:
    print(order.partner_id.country_id.name)   # partner_id and country_id are prefetched
                                                  # across the whole `orders` recordset
```

### Best Practice

- Never re-`browse()` a single ID inside a loop when you already have the record from a recordset you're iterating — accessing fields on `order` directly (as in the correct example) keeps the shared prefetch context; wrapping it in a fresh `browse()` call does not reliably preserve it.
- Never call `search()` inside a loop to look up something you could resolve once, in bulk, before the loop (e.g., search for all needed partners once with an `in` domain, instead of once per order).
- Use `mapped()` to pull a field across a whole recordset in one batched access: `orders.mapped('partner_id.country_id.name')`.
- When the related data genuinely needs a fresh query per group (not per record) — e.g., "the 3 most recent orders per partner" — that's a `read_group`/`_read_group` (§4) or a carefully constructed single query, not a per-record loop.

### Why It Matters

N+1 is the single most common Odoo performance bug because it doesn't look wrong — the code reads like normal, idiomatic recordset iteration. The tell isn't "there's a loop," it's "something *inside* the loop triggers a fresh query" (a `search()`, a `browse()` of an ID not already part of the current recordset's prefetch scope, or a non-stored computed field access that itself does a query). On a page listing 20 records this might cost an extra 50ms nobody notices in development; on a cron job or report processing 5,000 records, the identical pattern can turn a 2-second operation into a 10-minute one.

### Performance Considerations — concrete before/after

| Pattern | Query count for 1,000 orders |
|---|---|
| `for oid in order_ids: browse(oid).partner_id.name` (broken prefetch) | ~1,000+ queries |
| `for order in orders: order.partner_id.name` (prefetch preserved) | ~2–3 queries |
| `orders.mapped('partner_id.name')` | ~2–3 queries |

### Odoo 17 Notes

Prefetching mechanics are unchanged in 17; the discipline above applies identically to 16 and 17 code.

---

## 3. Efficient `search()`

### Explanation

`search()` compiles a domain to SQL — but a handful of usage patterns make it noticeably more or less efficient regardless of the domain's inherent selectivity.

### Best Practice

- Use `search_count(domain)` instead of `len(search(domain))` when you only need a count — it issues a `SELECT COUNT(*)` instead of fetching full records.
- Use `search(domain, limit=1)` (or `search_fetch`/direct field access patterns where available) instead of `search(domain)[0]` when you only need one record — avoids fetching and constructing a full recordset for records you'll discard.
- Push filtering into the domain rather than fetching broadly and filtering in Python with `filtered()` — a Python-side filter still had to fetch every candidate record from the database first, so a tighter domain is strictly cheaper whenever the condition can be expressed as one.
- Avoid unnecessary `order by` (`order=` kwarg) when the result's order genuinely doesn't matter (e.g., you're about to aggregate it) — sorting has a real cost on large tables, especially without a matching index.
- Combine `search` + `read` into `search_read(domain, fields)` when you need specific field values from many records and don't need actual recordset behavior (methods, further ORM operations) — it's a single call optimized for exactly that shape.

### Why It Matters

`search(domain)[0]` and `len(search(domain))` are extremely common, extremely easy-to-miss inefficiencies — they read naturally and work correctly, so they pass code review on functional grounds alone; catching them requires specifically checking "is this fetching more than it needs."

### ❌ Wrong

```python
if len(self.env['plant.order'].search([('partner_id', '=', partner.id)])) > 0:
    ...
first_order = self.env['plant.order'].search([('partner_id', '=', partner.id)])[0]
```

### ✅ Correct

```python
if self.env['plant.order'].search_count([('partner_id', '=', partner.id)]) > 0:
    ...
first_order = self.env['plant.order'].search([('partner_id', '=', partner.id)], limit=1)
```

Even better for the existence check, if you don't need the count specifically:
```python
has_orders = bool(self.env['plant.order'].search([('partner_id', '=', partner.id)], limit=1))
```

### Odoo 17 Notes

`search_fetch`/internal read optimizations have continued to evolve across recent Odoo versions, but the `search_count`/`limit=1`/`search_read` guidance above is stable, version-independent best practice that applies fully to 17.

---

## 4. `read_group()` / `_read_group()`

### Explanation

Aggregation (sum, count, average, grouped by one or more fields) should go through the ORM's group-by machinery, which compiles to a single SQL `GROUP BY` query, instead of fetching individual records and accumulating in a Python loop.

```python
# ❌ Fetches every record, aggregates in Python — O(N) records transferred and iterated
orders = self.env['plant.order'].search([('state', '=', 'done')])
totals_by_partner = {}
for order in orders:
    totals_by_partner.setdefault(order.partner_id, 0)
    totals_by_partner[order.partner_id] += order.amount_total
```

```python
# ✅ One SQL GROUP BY query; only aggregate results transferred
groups = self.env['plant.order'].read_group(
    domain=[('state', '=', 'done')],
    fields=['amount_total:sum'],
    groupby=['partner_id'],
)
# groups: [{'partner_id': (id, name), 'amount_total': total, '__domain': [...], ...}, ...]
```

### Best Practice

- Use `read_group()` for dashboard/reporting aggregation needs — it's built for exactly this and pushes the work to PostgreSQL, which is dramatically more efficient at aggregation than Python-side loops.
- Reach for Odoo 17's `_read_group()` (leading underscore) when you need **grouped recordsets** back — e.g., "give me each partner's orders as an actual recordset, grouped" — rather than just aggregate scalar values; it supports richer aggregate/grouping specs than the older `read_group()`.
- Combine multiple aggregates in one call (`fields=['amount_total:sum', 'id:count']`) rather than issuing separate calls for each metric you need on the same grouping.
- Remember `read_group`'s grouped date/datetime fields support `groupby=['date_order:month']`-style granularity specifiers — use them instead of manually truncating dates in Python.

### Performance Considerations

For a table with 100,000 "done" orders across 500 partners, the Python-loop approach transfers and iterates 100,000 rows; `read_group` transfers ~500 aggregate rows. This is not a marginal difference — it's frequently a >100x reduction in data transferred and a corresponding reduction in wall-clock time, especially once the table is large enough that "fetch everything" no longer comfortably fits in a fast in-memory operation.

### Odoo 17 Notes

`_read_group()` is the Odoo 17-introduced, more flexible successor to `read_group()`. `read_group()` remains supported and is perfectly fine for typical aggregate-value needs (dashboards, KPI widgets); prefer `_read_group()` specifically when you need grouped recordsets rather than aggregate dicts back.

---

## 5. Batch create/write

### Explanation

Covered in depth in `references/03-python-orm-advanced.md` §7 and `references/02-python-models-fields.md` §8 — restated here as a performance-first summary because it's one of the highest-impact techniques in this whole file.

### Best Practice

- Build a list of `vals` dicts, call `create()` once.
- Call `write()`/`unlink()` on the whole target recordset at once, not per-record in a loop.
- For very large batches (tens of thousands of records) in a one-off script/migration context, consider chunking (e.g., 1,000–5,000 records per `create()` call) to bound memory/transaction size — but don't chunk down to single-record calls; that reintroduces the exact cost batching avoids. Chunking is about managing transaction/memory size for very large batches, not about avoiding batching itself.

### Performance Considerations — concrete before/after

| Pattern | Approx. wall-clock for 5,000 records (illustrative, varies by hardware/model complexity) |
|---|---|
| `for vals in vals_list: model.create(vals)` | Minutes — one `INSERT` + one full constraint/compute/security pass per record |
| `model.create(vals_list)` | Seconds — batched `INSERT`s, batched constraint/compute passes |

### Odoo 17 Notes

`@api.model_create_multi` is the standard, expected decorator for any `create()` override in 17 (see `references/02-python-models-fields.md` §8) — a single-record-only override doesn't just miss out on this benefit, it can degrade batch-calling code that correctly passes a list.

---

## 6. SQL only when appropriate

### Explanation

Raw SQL (`self.env.cr.execute(...)`) bypasses the ORM entirely: no access rights, no record rules, no constraints, no compute triggers, no chatter/tracking. It is occasionally the right tool, but the bar should be genuinely high.

### Best Practice — when raw SQL is justified

- Heavy analytical aggregation across large tables where even `read_group`'s generated SQL isn't sufficient (complex window functions, multi-table joins beyond what a domain can express) — and the result is read-only reporting data, not a write path.
- One-off data-migration/maintenance scripts run by a developer/DBA outside normal application request flow, where bypassing business-rule triggers is the explicit intent (e.g., backfilling a column without re-triggering unrelated automation).
- Genuinely performance-critical read paths, profiled and measured to confirm the ORM-generated query is the actual bottleneck (rare, but does happen on very large tables with specific access patterns).

### Best Practice — when it is not justified

- "It's less code" or "I find SQL more familiar than domains" — not a performance or correctness reason.
- Working around an `AccessError`/record rule you find inconvenient — this is a security bypass, not a performance optimization (`references/06-security.md`).
- A write path that also needs constraints/compute/chatter to fire — raw SQL silently skips all of them, which usually isn't actually what you want even when it seems like "just an update."

### If you do use raw SQL

- **Always parametrize** — `cr.execute("... WHERE id = %s", (record_id,))`, never Python string formatting/f-strings/`%`-interpolation building the query text itself. This is a direct SQL-injection vector if any part of the interpolated value can be influenced by user input, and it's good discipline even when it currently can't be.
- Invalidate the ORM cache for anything you touched via raw SQL that the ORM might have cached (`self.env.invalidate_all()` or the more targeted `self.invalidate_recordset()`/`env.cache` APIs) — otherwise a subsequent ORM read in the same transaction can return stale, pre-SQL-write data.
- Document *why* raw SQL was chosen over the ORM directly in a code comment — this is exactly the kind of decision a future reviewer needs justified inline, since it's the one place in the codebase deliberately opting out of the framework's safety net.

### ❌ Wrong

```python
# String-formatted, unparametrized, and skips every ORM safeguard for a simple bulk update
self.env.cr.execute(f"UPDATE plant_order SET state = 'done' WHERE company_id = {company_id}")
```

### ✅ Correct

```python
# The ORM-native version — parametrization is automatic, and constraints/computes/security all apply
orders = self.env['plant.order'].search([('company_id', '=', company_id), ('state', '!=', 'done')])
orders.write({'state': 'done'})
```

```python
# A genuinely justified raw-SQL case: read-only, heavy aggregation, with clear justification
def get_yearly_revenue_by_region(self):
    """Raw SQL: read_group can't express this multi-level window aggregate efficiently
    at the required scale (~2M rows); read-only, no business-rule side effects needed."""
    self.env.cr.execute("""
        SELECT region, date_trunc('year', date_order) AS year, SUM(amount_total)
        FROM plant_order
        WHERE company_id = %s
        GROUP BY region, date_trunc('year', date_order)
    """, (self.env.company.id,))
    return self.env.cr.dictfetchall()
```

### Security Considerations

Raw SQL is a direct bypass of `references/06-security.md`'s entire model — record rules and access rights simply do not apply to a hand-written query. Any raw SQL touching data a specific user's request will act on needs its own manual authorization check, since the ORM won't provide one.

### Odoo 17 Notes

No new SQL-escape-hatch API in 17; the `_read_group()` improvement (§4) narrows the set of cases where raw SQL is genuinely the only reasonable option, since more grouped/aggregate needs can be expressed through it than through the older `read_group()`.

---

## 7. Caching

### Explanation

The ORM maintains an in-memory, per-transaction cache of field values keyed by (model, id, field) — this is what prefetching populates and what makes repeated field access on the same recordset within one request cheap after the first read. Odoo also provides `ormcache`-style decorators (`@tools.ormcache`) for caching expensive, rarely-changing computations across requests, and `ir.config_parameter`/`res.config.settings` patterns for cached configuration values.

### Best Practice

- Understand that the per-transaction ORM cache already gives you "don't re-fetch the same field twice in one request" for free — you don't need to manually cache field reads within a single method/transaction.
- Reach for `@tools.ormcache` only for genuinely expensive, rarely-invalidated, pure computations shared across requests/transactions (e.g., parsing a large static configuration once) — and be exactingly careful about cache invalidation (`ormcache`-decorated methods need their cache explicitly cleared, via `.clear_cache()`, when the underlying data changes, or you'll serve stale results indefinitely).
- Don't build your own manual caching layer (a module-level Python dict keyed by ID) for ORM data — it will not respect per-user record rules, per-transaction isolation, or cache invalidation on write, and will reintroduce exactly the visibility bugs `references/06-security.md` warns about, plus stale-data bugs on top.
- For expensive, rarely-changing derived values that *are* appropriate to persist, prefer a stored computed field (recomputed automatically via `@api.depends`, `references/02-python-models-fields.md` §3) over a hand-rolled cache — it gets you correct invalidation for free.

### Why It Matters

Odoo's cache invalidation is entangled with its write/compute/record-rule machinery in ways that are easy to accidentally break with a naive parallel caching layer — a hand-rolled cache is one of the more reliable ways to reintroduce both stale-data bugs and cross-user data leakage into an otherwise well-behaved module.

### Odoo 17 Notes

No caching-API changes in 17; the guidance above is standing practice.

---

## 8. Computed field optimization

### Explanation

Restated and expanded from `references/02-python-models-fields.md` §§3, 5 with a performance-first lens: computed fields are where the highest-leverage, easiest-to-miss performance decisions in day-to-day Odoo modeling live.

### Best Practice

- **`store=True` for anything filtered, grouped, sorted, or listed** — a non-stored field used in a search domain forces Odoo to compute it for every candidate record in Python before it can filter at all, with no index and no SQL pushdown (`references/02-python-models-fields.md` §5).
- **Write compute methods assuming `self` may contain thousands of records** — avoid per-record queries inside the loop; use `mapped()`/prefetching/`read_group` instead of `record.some_relation.search(...)` per iteration.
- **Use `precompute=True`** (Odoo 16.4+/17) on stored computed fields whose value doesn't depend on the record already having a database `id` or on `One2many` children created in the same transaction — this avoids a redundant `UPDATE` immediately following `INSERT` during `create()`.
- **Scope `@api.depends` precisely** — an overly broad dependency (depending on a field the computation doesn't actually read) causes unnecessary recomputation on unrelated writes; an overly narrow one causes stale data (`references/02-python-models-fields.md` §3). Both are correctness *and* performance bugs — the former wastes cycles, the latter serves wrong answers cheaply.
- **Consider whether a value needs to be "live" at all.** A dashboard KPI recomputed via `@api.depends` on every relevant write across a huge related dataset might be better served by a scheduled (cron) recomputation into a stored field on a slower cadence, if perfect real-time accuracy isn't actually a business requirement.

### Performance Considerations — concrete illustration

A non-stored `amount_total` computed field used in a "high value orders" search filter forces Odoo to: fetch every order matching the *rest* of the domain, compute `amount_total` in Python for each one (which itself may touch `line_ids` — another query), then filter in Python. On 50,000 orders, this can mean tens of thousands of extra row fetches and Python-side computations for what should be a single indexed `WHERE amount_total > 1000` once the field is `store=True`.

### Odoo 17 Notes

`precompute=True` and the additive-dependency-merging behavior for overridden computes (`references/02-python-models-fields.md` §3) are the two concrete 17-relevant improvements here; the store-vs-non-store decision framework itself is unchanged from prior versions.
