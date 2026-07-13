# Python Development II — ORM Internals & Inheritance

Governs: general ORM best practices, recordsets, environment (`env`), context, domains, prefetching, batch operations, decorators, inheritance (`_inherit`, `_inherits`), mixins.

See `references/02-python-models-fields.md` for models/fields/computed/constraints/CRUD, and `references/10-performance.md` for the performance-specific deep dive on N+1 queries, `read_group`, and batching.

---

## 1. General ORM best practices

### Explanation

Odoo's ORM is not a thin wrapper you can bypass "when convenient" — it's the layer that applies security (ACLs, record rules), triggers computed fields and constraints, writes to the mail/tracking chatter, and invalidates caches consistently. Every business rule you've encoded via `@api.constrains`, every record rule, every field-level access right is enforced *by the ORM*, not by PostgreSQL.

### Best Practice

- Default to ORM methods (`search`, `browse`, `create`, `write`, `unlink`, `read_group`/`_read_group`) for all business data access.
- Treat raw SQL (`self.env.cr.execute(...)`) as an escape hatch for genuinely SQL-only needs (heavy analytical aggregation, bulk maintenance scripts) — never as a way to "skip" ORM validation or security you find inconvenient. See `references/10-performance.md` §6 for exactly when raw SQL is and isn't justified.
- Never mix raw SQL writes with ORM writes on the same model in the same transaction without understanding cache invalidation — the ORM's in-memory cache doesn't know about a row you changed with `cr.execute("UPDATE ...")`, and stale cached values can be read back or re-written over your SQL change.

### Why It Matters

Bypassing the ORM to "go faster" routinely reintroduces exactly the bugs the ORM exists to prevent: writes that skip constraints, records visible to users who shouldn't see them (record rules never applied), computed fields left stale because no dependency was invalidated, and chatter/tracking silently missing an entry. These are expensive to discover because they surface as data-integrity incidents, not exceptions.

### ❌ Wrong

```python
# "faster" bulk update that skips constraints, compute triggers, and record rules entirely
self.env.cr.execute("UPDATE plant_order SET state = 'done' WHERE company_id = %s", (company_id,))
```

### ✅ Correct

```python
orders = self.env['plant.order'].search([('company_id', '=', company_id), ('state', '!=', 'done')])
orders.write({'state': 'done'})   # still one efficient SQL UPDATE under the hood,
                                    # but runs constraints, triggers computes, respects security
```

### Odoo 17 Notes

Nothing mechanically new in 17 here — this is a standing principle. What *is* worth re-checking in any v16→v17 migration is code that used raw SQL to work around a v16 ORM limitation that Odoo 17 may have since addressed natively (e.g., improved `_read_group` aggregate support — see §7).

---

## 2. Recordsets

### Explanation

Every ORM call returns a **recordset** — an ordered, immutable, iterable collection of records of one model, backed by a set of IDs plus a reference to the environment. A recordset of one record still behaves like a collection; there is no separate "single record" type.

```python
orders = self.env['plant.order'].search([])   # recordset, possibly empty, possibly many
for order in orders:                            # order is itself a recordset of length 1
    print(order.name)
```

### Best Practice

- Iterate with `for record in recordset:` — never convert to `.ids` and re-`browse()` inside the same method; you already have the records.
- Use recordset set operations instead of manual list/dict bookkeeping: `|` (union), `&` (intersection), `-` (difference), `in`/`not in` for membership.
- Use `mapped()`, `filtered()`, `sorted()` for functional-style transformations instead of manual Python loops building lists — they're idiomatic, batch-aware, and communicate intent.
- Call `self.ensure_one()` at the top of any method whose logic only makes sense for a single record (most `action_*` methods bound to a form-view button).

### Why It Matters

Recordset operators are implemented to be prefetch- and cache-aware; equivalent hand-rolled Python (`[r for r in recordset if r.state == 'done']` instead of `recordset.filtered(lambda r: r.state == 'done')`) usually behaves the same functionally but signals to reviewers (and to you, later) that the value isn't a "real" Odoo idiom, inviting more scrutiny and more bugs during refactors.

### ❌ Wrong

```python
def action_confirm(self):
    # no ensure_one(): silently only "works" correctly for the first record if called on many
    self.state = 'confirmed'

done_orders = []
for order in self.env['plant.order'].search([]):
    if order.state == 'done':
        done_orders.append(order.id)
done_recordset = self.env['plant.order'].browse(done_orders)   # re-browsing IDs you already had
```

### ✅ Correct

```python
def action_confirm(self):
    self.ensure_one()
    self.state = 'confirmed'

all_orders = self.env['plant.order'].search([])
done_orders = all_orders.filtered(lambda o: o.state == 'done')
```

### Performance Considerations

`filtered()`/`mapped()`/`sorted()` operate on already-fetched/prefetched data in memory — they don't issue new queries for fields already in the prefetch set, unlike re-`browse()`-ing and reading fields fresh. See §5 (prefetching) below.

### Odoo 17 Notes

Recordset semantics are unchanged. `Command` (for x2many write payloads, see §6) is imported from `odoo` (`from odoo import Command`) and remains the standard way to build `One2many`/`Many2many` write instructions — don't hand-write the legacy `(6, 0, ids)`-style tuples in new code.

---

## 3. Environment (`env`)

### Explanation

`self.env` bundles the current cursor (`env.cr`), user (`env.uid`/`env.user`), context (`env.context`), and a registry of every model (`env['model.name']`). Every recordset carries its own `env`, which is what makes `sudo()`, `with_user()`, `with_context()`, and `with_company()` work as *new recordsets with a modified environment* rather than mutating global state.

```python
partner = self.env['res.partner'].browse(partner_id)
admin_view = self.env['plant.order'].sudo().search([])          # bypass current user's ACLs/record rules
other_user_view = self.env['plant.order'].with_user(other_user)  # act as a specific user
```

### Best Practice

- Use `self.env['model']` to access other models — never `self.pool` (the legacy pre-new-API registry access) in new code.
- `sudo()` returns a **new recordset** with superuser rights on that recordset's environment; it does not mutate `self`. Chain it explicitly wherever elevated rights are actually needed, and keep the scope as narrow as possible (call `sudo()` on the specific search/browse that needs it, not at the top of a whole method if only one line requires it).
- Use `with_user(user)` to act as a specific (non-super) user, e.g. for testing permission-dependent logic or executing as the record's assigned owner.
- Use `self.env.user` / `self.env.uid` to read "who is making this call" — never hardcode a user ID.

### Why It Matters

`sudo()` is the most commonly *misused* API in the entire framework: it's an easy fix for a `AccessError` during development, but every `sudo()` call is a place where your security model is being deliberately bypassed. Each one needs to be independently justifiable in review — "why does this specific operation need to ignore this specific user's permissions?" — not just "it made the error go away."

### ❌ Wrong

```python
def get_all_orders(self):
    # sudo() applied broadly "just in case", hiding whatever the real
    # access problem was, and now every call to this method returns
    # data across ALL users' visibility regardless of caller
    return self.env['plant.order'].sudo().search([])
```

### ✅ Correct

```python
def get_all_orders(self):
    # No sudo — respects the calling user's normal visibility.
    return self.env['plant.order'].search([])

def _cron_archive_old_orders(self):
    # sudo() justified: cron jobs run without a "real" logged-in user context,
    # and this specific job is documented as needing cross-user visibility.
    orders = self.env['plant.order'].sudo().search([('date_order', '<', ...)])
    orders.write({'active': False})
```

### Security Considerations

Every `sudo()` call should be reviewable in isolation with a one-line justification (a comment is cheap insurance). Prefer narrower alternatives first: is the real fix an `ir.model.access.csv` row this user's group is missing? A record rule that's too restrictive? `sudo()` only for genuinely privileged operations (system/cron jobs, controlled cross-user aggregation with no sensitive fields exposed back to the caller).

### Odoo 17 Notes

No API changes to `env` itself in 17. `with_company()` (covered in `references/11-multi-company.md`) is the multi-company-specific sibling of `with_context(allowed_company_ids=...)` — use `with_company()`, not manual context manipulation, for company switching.

---

## 4. Context

### Explanation

The context (`self.env.context`, a read-only dict) carries request-scoped hints: language (`lang`), timezone (`tz`), default values for a wizard opened from a specific screen (`default_partner_id`), and behavioral flags many core methods check (`active_test`, `tracking_disable`, `mail_create_nolog`, etc.).

```python
action = {
    'type': 'ir.actions.act_window',
    'res_model': 'plant.order',
    'view_mode': 'form',
    'context': {'default_partner_id': self.id, 'default_state': 'draft'},
}
orders_incl_archived = self.env['plant.order'].with_context(active_test=False).search([])
```

### Best Practice

- Use `with_context(**kwargs)` to derive a new recordset with modified context — never try to mutate `self.env.context` in place (it's immutable by design).
- Use `default_<field>` context keys to prefill a field when opening a form from an action — this is how Odoo populates "create a related record" flows without writing a custom onchange.
- Read context values with `.get()` and a sensible default — never assume a key is present.
- Document any custom context key your module introduces and checks for (a short docstring or comment at the point it's read) — context keys are invisible, stringly-typed, and easy to typo silently into a no-op.

### Why It Matters

Context keys are checked by string name with no static typing and no error if you typo one — `self.env.context.get('default_partenr_id')` (typo) simply returns `None` silently instead of raising, which is a debugging trap. Because context propagates implicitly through many ORM calls, undocumented custom keys become "spooky action at a distance" for the next developer.

### ❌ Wrong

```python
def action_open_wizard(self):
    self.env.context['default_order_id'] = self.id    # attempting to mutate context in place —
                                                          # raises or silently fails depending on call site
```

### ✅ Correct

```python
def action_open_wizard(self):
    self.ensure_one()
    return {
        'type': 'ir.actions.act_window',
        'res_model': 'make.plant.order',
        'view_mode': 'form',
        'target': 'new',
        'context': {**self.env.context, 'default_order_id': self.id},
    }
```

### Performance Considerations

`active_test=False` (to include archived/`active=False` records in a search) is context, not a domain clause — forgetting it is a common cause of "why isn't this archived record showing up" bugs, and adding it needlessly to *every* search is a common cause of accidentally surfacing archived data to end users. Set it deliberately, only where archived records are genuinely relevant.

### Odoo 17 Notes

No structural changes; the same context-key conventions apply.

---

## 5. Domains

### Explanation

A domain is a list of criteria — `[('field', 'operator', value), ...]` — combined with implicit `AND`, or explicit prefix `'&'`/`'|'`/`'!'` operators, used by `search()`, record rules, `filter`/`searchpanel` elements in views, and (in Odoo 17) directly as XML view attribute expressions for `invisible`/`readonly`/`required` (see `references/05-xml-views.md`).

```python
domain = [
    ('state', '=', 'confirmed'),
    ('partner_id.country_id', '=', self.env.ref('base.us').id),
    '|', ('priority', '=', 'high'), ('amount_total', '>', 1000),
]
orders = self.env['plant.order'].search(domain)
```

### Best Practice

- Prefer implicit `AND` (just listing tuples) and only reach for explicit `'&'`/`'|'`/`'!'` when you actually need `OR`/`NOT` — implicit-AND domains are easier to read and compose.
- Traverse relations directly in a domain tuple (`'partner_id.country_id'`) instead of doing a separate `search()` to first resolve IDs and then filtering — one domain, one query, versus two round trips.
- Build domains as data (lists), and combine them with `osv.expression.AND`/`OR` (`from odoo.osv import expression`) when composing dynamic, reusable domain fragments across methods, rather than string-concatenating or manually merging lists.
- Never build a domain via string formatting/concatenation of untrusted input — domains are structured data, not SQL text, but constructing them from unsanitized input can still let a caller inject unintended operators or fields (see `references/09-controllers-api.md` for the analogous controller-input concern).

### Why It Matters

A domain that traverses relations directly compiles to a single `JOIN`-backed SQL query; splitting it into "search for country → get IDs → search for orders with those partner IDs" does the same job in two round trips and loses atomicity (the "get IDs" step can be stale by the time the second query runs under concurrent writes).

### ❌ Wrong

```python
country = self.env.ref('base.us')
partners = self.env['res.partner'].search([('country_id', '=', country.id)])
orders = self.env['plant.order'].search([('partner_id', 'in', partners.ids)])  # two queries
```

### ✅ Correct

```python
orders = self.env['plant.order'].search([('partner_id.country_id', '=', self.env.ref('base.us').id)])
```

### Performance Considerations

Every relational hop in a domain (`partner_id.country_id`) becomes a SQL `JOIN` — deeply nested domains (4+ hops) can produce expensive query plans; if a specific multi-hop filter is used constantly and heavily, consider a `related`, stored field instead (§4/§5 in `references/02-python-models-fields.md`) so the filter becomes a plain indexed column comparison.

### Odoo 17 Notes

Odoo 17's biggest domain-adjacent change is that **view XML attributes now hold Python-expression strings evaluated client-side**, not domain-tuple lists, for `invisible`/`readonly`/`required` — don't confuse the two syntaxes. `search()` domains in Python are unchanged; only the XML view-attribute mini-language changed (see `references/05-xml-views.md`).

---

## 6. Prefetching

### Explanation

When you read one field on one record of a recordset, the ORM doesn't fetch just that field for just that record — it prefetches that field (and other likely-needed fields) for the **entire recordset currently in scope**, in one query, anticipating you'll access the same field on sibling records soon. This is what makes `for record in large_recordset: record.some_field` efficient instead of one query per record — *as long as the loop doesn't do something that invalidates or bypasses the prefetch set*.

### Best Practice

- Keep the "natural" recordset together as long as possible before looping — `search()` once, then iterate the *result*, rather than re-`browse()`-ing individual IDs one at a time inside a loop (each `browse()` on a single new ID starts a fresh prefetch context).
- When you know you'll need specific fields on a large recordset, a plain iteration (`for r in recordset: r.field_a; r.field_b`) already benefits from prefetch — you don't need to manually "preload" fields in most cases.
- Be aware that accessing a field for the *first* time on a recordset triggers the batch read for that field across the whole set; accessing a *different* field afterward triggers another batch read for that field across the same set. This is still far cheaper than one query per record, but doing many distinct field accesses inside a tight loop, each the "first access" of that field, can still add up — consider `read()` with an explicit field list if you know exactly which fields you need up front.

### Why It Matters

Prefetching is *why* naive-looking Odoo loops are usually fine performance-wise, and it's also why the classic N+1 antipattern in Odoo doesn't look like a classic N+1 antipattern — it usually comes from **breaking the recordset apart** (re-browsing one ID at a time from a stored ID list, or calling `search()` fresh inside a loop) rather than from iterating a recordset per se. See `references/10-performance.md` for concrete before/after query counts.

### ❌ Wrong

```python
order_ids = self.env['plant.order'].search([]).ids
for oid in order_ids:
    order = self.env['plant.order'].browse(oid)   # breaks the shared prefetch set —
    print(order.partner_id.name)                    # each iteration can trigger its own query
```

### ✅ Correct

```python
orders = self.env['plant.order'].search([])
for order in orders:                                # shared prefetch set preserved
    print(order.partner_id.name)                     # partner_id (and .name) batch-fetched once
```

### Performance Considerations

This is the mechanism `references/10-performance.md` builds on — read that file for query-count-level detail. As a rule of thumb: if you find yourself calling `browse()` on a single ID inside a loop, or calling `search()` inside a loop, you have very likely broken prefetching and reintroduced N+1 behavior even though the code "looks like" idiomatic Odoo.

### Odoo 17 Notes

Prefetching internals are unchanged in 17. No new API surface to learn here — the discipline is the same as prior versions.

---

## 7. Batch operations

### Explanation

"Batch" means doing the ORM operation once, over a recordset or a list of `vals`, instead of once per record in a Python loop. `create()` is batch-first (§8, `references/02-python-models-fields.md`); `write()` and `unlink()` are naturally batch already (calling them on a multi-record recordset applies to all of them in as few SQL statements as the ORM can manage); aggregation should use `read_group`/`_read_group` instead of manual per-group loops.

```python
# Batch create
self.env['plant.order.line'].create([
    {'order_id': order.id, 'product_id': p.id, 'qty': 1} for p in products
])

# Batch write
orders.write({'state': 'done'})

# Batch aggregate
groups = self.env['plant.order'].read_group(
    domain=[('state', '=', 'done')],
    fields=['amount_total:sum'],
    groupby=['partner_id'],
)
```

### Best Practice

- Build a list of `vals` dicts first, then call `create()` **once** on the whole list.
- Call `write()`/`unlink()` on the whole target recordset, not per-record inside a `for` loop.
- Use `read_group()` (or Odoo 17's `_read_group()` — see the Odoo 17 Notes below) for any "sum/count/average grouped by X" need instead of looping and accumulating in Python.
- When a per-record side effect genuinely differs by record (so you can't literally batch the `write()` call itself), still batch what you *can* — resolve any required lookups (partners, products, sequences) in one query before the loop, instead of querying inside it.

### Why It Matters

Odoo's batch `create()`/`write()` collapse what would be N separate `INSERT`/`UPDATE` statements (plus N sets of constraint checks, N sets of compute triggers, N sets of record-rule checks) into a handful of statements. On a real dataset (hundreds to thousands of records — a CSV import, a nightly sync job), the difference between batched and per-record operations is routinely a 10–100x wall-clock difference.

### ❌ Wrong

```python
for product in products:
    self.env['plant.order.line'].create({    # one INSERT per product, one full compute/constraint
        'order_id': order.id,                  # pass per product
        'product_id': product.id,
        'qty': 1,
    })
```

### ✅ Correct

```python
self.env['plant.order.line'].create([
    {'order_id': order.id, 'product_id': product.id, 'qty': 1}
    for product in products
])
```

### Performance Considerations

See `references/10-performance.md` §4 for benchmarding guidance and `_read_group`/`read_group` usage patterns in depth — this section is the ORM-idiom summary; that file is the performance-tuning deep dive.

### Odoo 17 Notes

Odoo 17 introduced `_read_group()` (leading underscore) as the lower-level, more flexible successor API to `read_group()`, returning actual recordsets/values per group instead of a list of aggregate dicts, and supporting richer aggregate specs. `read_group()` still works in 17 and remains fine for typical dashboard/reporting aggregation; reach for `_read_group()` when you need grouped **recordsets** back (e.g., to call a method per group) rather than just aggregate numbers.

---

## 8. Decorators

### Explanation

`odoo.api` decorators declare a method's *contract* to the ORM — what it depends on, whether it operates on a single record or a model, and whether it needs special dispatch for batch creation.

| Decorator | Meaning | Typical use |
|---|---|---|
| `@api.depends('field', 'rel.field')` | Recompute trigger list for a `compute=` method | Computed fields |
| `@api.depends_context('key')` | Recompute trigger list based on context keys (e.g., `lang`) | Computed fields sensitive to context, incl. `_compute_display_name` overrides using context |
| `@api.constrains('field', ...)` | Re-validation trigger list for an integrity check | Constraint methods |
| `@api.onchange('field', ...)` | Client-side-only trigger list | Onchange methods |
| `@api.model` | Method doesn't need `self` to be a specific record — called on the model/empty recordset | Utility/class-level helpers, `default_get` extensions |
| `@api.model_create_multi` | Marks `create()` as accepting a **list** of vals dicts (the modern batch contract) | `create()` overrides |
| `@api.returns('self')` | Declares the method returns records of the same model (mostly relevant for very old-style code / cross-model generic helpers) | Rarely needed in new code |

### Best Practice

- Match the decorator to the method's actual contract — don't decorate a method `@api.model` if it reads `self`'s field values (it needs to be a normal recordset method).
- Every `compute=`, `constrains=`-triggering, and `onchange=`-triggering method needs its matching decorator with a *complete* field list — this is repeated for emphasis because it's the single most common source of "works on my machine, stale in production" bugs (see §3 and §6 of `references/02-python-models-fields.md`).
- Use `@api.model_create_multi` on every `create()` override — see §8 of the models/fields reference.

### Why It Matters

These decorators aren't documentation — they change ORM *behavior*: `@api.depends` literally registers the recompute trigger; `@api.model_create_multi` changes what `create()` receives. Getting them wrong isn't a style nit, it changes what the code does.

### ❌ Wrong

```python
@api.model                          # wrong: this method reads self.partner_id, so it needs
def get_partner_email(self):        # to be called on an actual record, not model-level
    return self.partner_id.email
```

### ✅ Correct

```python
def get_partner_email(self):
    self.ensure_one()
    return self.partner_id.email
```

### Odoo 17 Notes

No new decorators introduced in 17 itself, but the *removal* of `states=` as a field-constructor keyword (see `references/02-python-models-fields.md` §2) means you'll see less reliance on that mechanism and more on `@api.depends` + `readonly=False` computed fields for state-dependent field behavior.

---

## 9. Inheritance (`_inherit` and `_inherits`)

### Explanation

Odoo has three distinct inheritance mechanisms, and confusing them is a common architecture mistake:

1. **Classical extension** (`_inherit = 'existing.model'`, no `_name`): adds/overrides fields and methods **on the same underlying table** — the standard way to customize a core or another module's model.
2. **New model based on an existing one** (`_name = 'new.model'`, `_inherit = 'existing.model'`): copies the parent's fields/behavior into a **new table** — used when you want a variant model that's mostly like another but genuinely separate (rare; most "I want a model like X" needs are actually mixins, see §10).
3. **Delegation inheritance** (`_inherits = {'other.model': 'other_model_id'}`): composition via an automatically-created, transparently-proxied `Many2one` — the child model has its own table but exposes the parent's fields directly (this is how `product.product` exposes `product.template`'s fields, for example).

```python
# 1. Classical extension — the overwhelmingly common case
class ResPartner(models.Model):
    _inherit = 'res.partner'

    plant_preference_ids = fields.Many2many('plant.tag', string="Plant Preferences")

# 3. Delegation inheritance
class PlantVariant(models.Model):
    _name = 'plant.variant'
    _inherits = {'plant.species': 'species_id'}

    species_id = fields.Many2one('plant.species', required=True, ondelete='cascade')
    pot_size = fields.Selection([('s', "Small"), ('m', "Medium"), ('l', "Large")])
```

### Best Practice

- Default to **classical `_inherit`** for "add a field/method to an existing model." This covers the vast majority of real customization needs.
- Reach for **`_inherits` (delegation)** only when you genuinely want "is-a-kind-of, but with its own identity and table" composition — it's more powerful but also more complex (implicit proxy fields, cascading deletes via `ondelete='cascade'` on the delegating field) and much rarer in day-to-day module work than classical inheritance.
- When overriding a method via classical `_inherit`, **always call `super()`** and preserve its return value/contract unless you have a specific, documented reason to change it.
- Put each `_inherit` of a *core* model in its own file even when small (per `references/01-module-architecture.md`) — never bundle it into your main model's file.

### Why It Matters

Classical `_inherit` is what makes Odoo's whole ecosystem of composable modules work — dozens of modules can each add a few fields/methods to `res.partner` without knowing about each other, because they all extend the same table rather than each creating a competing one. Reaching for `_inherits` (or worse, a fresh unrelated model plus manual field-copying) where classical `_inherit` would do adds real complexity for no benefit.

### ❌ Wrong

```python
# Copy-pasting res.partner's fields into a new model instead of extending it
class NurseryCustomer(models.Model):
    _name = 'nursery.customer'
    name = fields.Char()
    email = fields.Char()
    phone = fields.Char()
    # ...now you have two disconnected "customer" concepts in the database
```

### ✅ Correct

```python
class ResPartner(models.Model):
    _inherit = 'res.partner'

    plant_preference_ids = fields.Many2many('plant.tag', string="Plant Preferences")
```

### Performance Considerations

Classical `_inherit` adds columns to an existing table — cheap, no extra `JOIN` to read the new field. `_inherits` delegation adds a `Many2one` plus one implicit `JOIN`/extra read for every delegated field access — worth knowing before reaching for it purely out of familiarity with OOP inheritance vocabulary from other languages.

### Security Considerations

Access rights and record rules are defined **per model**. With `_inherits`, remember the child and parent are still two separate models with two separate sets of `ir.model.access.csv`/record rule entries — granting access to the child doesn't automatically grant the same visibility logic on the delegated parent unless you set that up too.

### Odoo 17 Notes

Mechanically unchanged in 17. The main 17-relevant reminder: if you're extending a model that itself had a `name_get()` override in the version you're porting from, migrate that override to `_compute_display_name()` in your inheriting code too (see `references/02-python-models-fields.md` §8) — don't add a *new* `name_get()` override on top of an already-deprecated pattern.

---

## 10. Mixins

### Explanation

A mixin is an `AbstractModel` (no table of its own) that other models bring in via `_inherit` (as one entry in a list) to acquire a bundle of reusable fields/behavior. Odoo's own `mail.thread`, `mail.activity.mixin`, and `portal.mixin` are the canonical examples.

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    _inherit = ['mail.thread', 'mail.activity.mixin']   # chatter + activities, for free
    _description = 'Plant Nursery Order'
```

### Best Practice

- Reach for a mixin (write your own `AbstractModel`) when the **same fields and methods** need to be duplicated verbatim across several otherwise-unrelated models — e.g., a `sequence_mixin` handling reference-number generation shared by `plant.order` and `plant.invoice`.
- List multiple inherited mixins alongside the model's own `_name` in `_inherit` as a list — order matters for method resolution (MRO), so put more "specific"/override-heavy mixins later if they need to see the effects of earlier ones.
- Keep mixins focused — a mixin bundling five unrelated concerns (chatter + sequence numbering + approval workflow) defeats the purpose; consumers should be able to opt into exactly what they need.
- Use Odoo's built-in mixins before writing your own: `mail.thread` (chatter/followers/tracking), `mail.activity.mixin` (activities), `portal.mixin` (customer portal access token), `image.mixin`, `rating.mixin` are all available from core.

### Why It Matters

A mixin turns "every model that needs an approval workflow re-implements approval fields and methods" into "every model that needs an approval workflow declares one line of `_inherit`." This is what keeps cross-cutting behavior (chatter, activities, approval, sequencing) consistent across an entire codebase instead of drifting into N slightly-different bespoke implementations.

### ❌ Wrong

```python
# Hand-rolled, duplicated "chatter-like" fields on every model that needs history,
# instead of using mail.thread
class PlantOrder(models.Model):
    _name = 'plant.order'
    history_log = fields.Text()   # manually appended-to in every write() override

class PlantInvoice(models.Model):
    _name = 'plant.invoice'
    history_log = fields.Text()   # same pattern, copy-pasted, now drifting
```

### ✅ Correct

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    _inherit = ['mail.thread', 'mail.activity.mixin']

class PlantInvoice(models.Model):
    _name = 'plant.invoice'
    _inherit = ['mail.thread', 'mail.activity.mixin']
```

Custom cross-cutting concern, written once:

```python
class SequenceMixin(models.AbstractModel):
    _name = 'acme.sequence.mixin'
    _description = 'Adds a company-scoped sequence reference'

    name = fields.Char(default=lambda self: _('New'), copy=False, readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code(self._name) or _('New')
        return super().create(vals_list)


class PlantOrder(models.Model):
    _name = 'plant.order'
    _inherit = ['acme.sequence.mixin', 'mail.thread']
```

### Performance Considerations

Mixins that add stored fields add columns to every consuming model's table — cheap individually, but be mindful if a mixin is applied to dozens of high-volume models; audit whether every field the mixin adds is actually needed by every consumer, or whether the mixin should be split into smaller, more targeted mixins.

### Odoo 17 Notes

No API change to mixin mechanics in 17. `mail.thread`/`mail.activity.mixin` remain the standard choice for chatter/activities; don't hand-roll equivalent behavior.
