# Python Development I — Models & Fields

Governs: models, fields, ORM best practices (field-level), computed fields, related fields, stored vs. non-stored fields, constraints, onchange methods, CRUD overrides.

See `references/03-python-orm-advanced.md` for recordsets, `env`, context, domains, prefetching, batch operations, decorators, `_inherit`/`_inherits`, and mixins.

---

## 1. Models

### Explanation

A model is a Python class inheriting from `models.Model` (persistent), `models.TransientModel` (wizards, auto-vacuumed), or `models.AbstractModel` (reusable mixin, no table). `_name` (or `_inherit` for extension — see the advanced ORM reference) registers it with the ORM, which auto-generates the PostgreSQL table, base columns (`id`, `create_date`, `create_uid`, `write_date`, `write_uid`), and CRUD methods.

```python
from odoo import api, fields, models


class PlantOrder(models.Model):
    _name = 'plant.order'
    _description = 'Plant Nursery Order'
    _order = 'date_order desc, id desc'
    _rec_name = 'name'
    _inherit = ['mail.thread', 'mail.activity.mixin']
```

### Best Practice

- Always set `_description` — it's what appears in technical error messages and the `ir.model` list; a model without it is a support headache waiting to happen.
- Set `_order` explicitly for any model users will browse in a list — the default (`id`) is rarely the useful business order.
- Keep one *main* model per file (see `references/01-module-architecture.md`); inherited core models get their own file even if small.
- Class attribute ordering, per Odoo's own guidelines: private attributes (`_name`, `_description`, `_order`, `_rec_name`, `_inherit`, `_sql_constraints`...) → default methods (`_default_*`) → field declarations → compute/inverse/search methods → onchange methods → constraint methods → CRUD overrides → action methods (`action_*`) → other business methods → private helpers (`_*`). This ordering is what lets a reviewer scan top-to-bottom and understand a model's contract before its implementation.

### Why It Matters

`_description` and `_order` cost one line and are visible in every list view, every log message, and every dev-mode error trace involving the model. Skipping them is one of the fastest "this was written by someone unfamiliar with Odoo" tells in a code review.

### ❌ Wrong

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    # no _description, no _order — list defaults to id ascending,
    # which is meaningless to a nursery manager
```

### ✅ Correct

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    _description = 'Plant Nursery Order'
    _order = 'date_order desc, id desc'
```

### Performance Considerations

`_order` is applied as a SQL `ORDER BY` — make sure the columns you order by are indexed if the model will grow large (see `references/10-performance.md`). Multi-field `_order` with a mix of relational fields (`partner_id.name`) is possible but adds a `JOIN`; prefer ordering by columns on the model itself when practical.

### Odoo 17 Notes

Model definition mechanics are unchanged in 17. What changed is the display-name contract — see §6 (CRUD overrides) below, since it directly affects how you'd have written a model's "name" logic in 16.

---

## 2. Fields

### Explanation

Fields declare both the Python-level attribute and the underlying PostgreSQL column (for stored fields) or in-memory/computed value (for non-stored). Every field type (`Char`, `Text`, `Integer`, `Float`, `Monetary`, `Boolean`, `Date`, `Datetime`, `Selection`, `Many2one`, `One2many`, `Many2many`, `Binary`, `Html`, `Json`) accepts a common set of keyword arguments plus type-specific ones.

```python
name = fields.Char(string="Order Reference", required=True, copy=False, index=True)
state = fields.Selection([
    ('draft', "Draft"),
    ('confirmed', "Confirmed"),
    ('done', "Done"),
    ('cancel', "Cancelled"),
], string="Status", default='draft', tracking=True)
partner_id = fields.Many2one('res.partner', string="Customer", required=True, ondelete='restrict')
line_ids = fields.One2many('plant.order.line', 'order_id', string="Order Lines")
tag_ids = fields.Many2many('plant.tag', string="Tags")
amount_total = fields.Monetary(compute='_compute_amount_total', store=True, currency_field='currency_id')
```

### Best Practice

- Pass `string=` explicitly for anything whose auto-derived label (from the Python attribute name) wouldn't read naturally to an end user.
- Set `required=True` in the field definition when a value is *always* mandatory, not just via a view's `required=` attribute — the same reasoning as §6 of `01-module-architecture.md`: the server must enforce it.
- Always set `ondelete=` explicitly on `Many2one` fields tied to business logic (`'restrict'`, `'cascade'`, or `'set null'`) instead of accepting the implicit default — think through what should happen when the other side is deleted.
- Use `index=True` on fields you'll filter or join on frequently (foreign keys used outside a standard `Many2one`, `state`-like fields queried often) — see `references/10-performance.md`.
- Use `copy=False` on fields that shouldn't be duplicated when a record is duplicated (sequences, references, one-off approval timestamps).
- Prefer `Selection` over `Char` for any field with a closed, known set of values — it gets you built-in validation, better widgets, and easier translation.

### Why It Matters

Field arguments are contracts other developers rely on without reading your code — `required=True` is enforced by the ORM on every `create()`/`write()` regardless of caller (API, import, shell), while a view-level `required` is enforced only for that one view. `ondelete` decisions prevent orphaned or silently-cascaded data loss.

### ❌ Wrong

```python
partner_id = fields.Many2one('res.partner')   # no ondelete decision made:
                                                # defaults to 'set null', silently
                                                # orphaning the order from its customer
                                                # if the partner is deleted
description = fields.Char()                    # unbounded free text crammed into Char
```

### ✅ Correct

```python
partner_id = fields.Many2one('res.partner', string="Customer", required=True, ondelete='restrict')
description = fields.Text(string="Description")
```

### Performance Considerations

`Binary` fields are stored out-of-line by default and can bloat backups/replication if marked `attachment=False` on high-volume models — leave `attachment=True` (the default) unless you have a specific reason not to. `Selection` and `Boolean` are cheap to index and filter; free-text `Char`/`Text` filtering (`ilike`) is not — don't put a "status" concept in a `Char` field if `Selection` will do.

### Security Considerations

`Binary` and `Html` fields are common injection/exposure vectors: `Html` field content rendered without sanitization in a QWeb template can execute stored XSS. Odoo's `Html` field applies sanitization by default (`sanitize=True`) — don't disable it without a specific, reviewed reason.

### Odoo 17 Notes

The `states=` keyword argument *on a field definition* (e.g., `fields.Char(states={'done': [('readonly', True)]})`) is legacy and should not be used in new Odoo 17 code — express the same behavior through a `compute`d `readonly` in the view instead (see `references/05-xml-views.md`). This is distinct from the `attrs`/`states` *view-XML* attribute removal covered there — this is the equivalent field-constructor argument's decline in favor of view-level conditional attributes.

---

## 3. Computed fields

### Explanation

A computed field's value is derived by a Python method instead of stored directly by `write()`. It is declared with `compute='_compute_method_name'` and the method must be decorated with `@api.depends(...)` listing every field (including dotted paths through relations) the computation reads.

```python
amount_total = fields.Monetary(compute='_compute_amount_total', store=True)

@api.depends('line_ids.subtotal')
def _compute_amount_total(self):
    for order in self:
        order.amount_total = sum(order.line_ids.mapped('subtotal'))
```

### Best Practice

- List **every** field the method reads in `@api.depends`, including through relations (`line_ids.subtotal`, not just `line_ids`). Missing a dependency is the single most common source of "the total didn't update" bugs.
- A compute method must set the field on **every record in `self`** — even if you `for order in self:` and the computation short-circuits, every branch must assign the field, or you'll get inconsistent behavior on multi-record recordsets.
- Keep compute methods side-effect-free with respect to *other* records or fields not being computed — a compute method should read and set only the field(s) it's declared for.
- Prefer a single compute method per field unless multiple fields are always computed together from the same inputs (in which case group them under one method and declare `compute='_compute_x'` on all of them — Odoo batches this into one call).
- If a computed field should be user-editable in specific conditions, add `inverse='_inverse_method_name'` rather than dropping `compute` altogether.

### Why It Matters

`@api.depends` is what lets the ORM invalidate and recompute *only* the records actually affected by a write, instead of recomputing everything. An incomplete dependency list doesn't error — it just silently serves stale data until something else happens to trigger a recompute, which is exactly the kind of bug that passes tests and fails in production three weeks later.

### ❌ Wrong

```python
@api.depends('line_ids')                 # missing '.subtotal' — a change to an existing
def _compute_amount_total(self):         # line's subtotal will NOT trigger a recompute
    for order in self:
        order.amount_total = sum(order.line_ids.mapped('subtotal'))
```

```python
@api.depends('line_ids.subtotal')
def _compute_amount_total(self):
    for order in self:
        if order.line_ids:
            order.amount_total = sum(order.line_ids.mapped('subtotal'))
        # missing else branch: orders with no lines never get amount_total set
        # on this pass, leaving whatever was cached/default before
```

### ✅ Correct

```python
@api.depends('line_ids.subtotal')
def _compute_amount_total(self):
    for order in self:
        order.amount_total = sum(order.line_ids.mapped('subtotal'))
        # always assigned — even when line_ids is empty, sum([]) == 0
```

### Performance Considerations

Computed fields execute in a batch over the whole recordset passed to them — that's *why* the `for order in self:` loop pattern matters: write the method assuming `self` can contain thousands of records, and avoid per-record queries inside the loop (use `mapped()`, prefetching, or `read_group` instead of `order.line_ids.search(...)` per iteration). See `references/10-performance.md` for the N+1 pattern this most commonly produces.

### Security Considerations

Computed, non-stored fields still go through `ir.model.access.csv` read permission on the underlying model *and* respect record rules on any relation traversed inside the compute — but the compute method itself runs with the calling user's `env`, so a compute that does `self.sudo().some_field` deliberately bypasses that user's restrictions. Only do this with a specific, documented reason (see `references/06-security.md`).

### Odoo 17 Notes

Odoo 17 makes overriding an inherited computed field's dependencies additive and safer: when you override a `compute` method via inheritance and add your own `@api.depends`, you no longer need to re-declare the base class's existing dependencies — they merge automatically. You only need to add the *new* fields your override reads.

---

## 4. Related fields

### Explanation

A related field is a specialized computed field that simply follows a dotted path through relations: `fields.Char(related='partner_id.email')`. Odoo auto-generates the compute logic.

```python
partner_email = fields.Char(related='partner_id.email', string="Customer Email", store=True, readonly=True)
```

### Best Practice

- Use `related=` instead of a hand-written `@api.depends` compute whenever you're purely proxying a field through a relation with no transformation — it's less code and the ORM optimizes the read path.
- Decide `store=` deliberately: stored related fields are searchable/groupable/sortable in a list view; non-stored ones are not.
- Related fields are `readonly=True` by default; only set `readonly=False` if you genuinely want writes on the related field to propagate back through the relation (Odoo supports this, but it's surprising to most readers — comment why if you do it).

### Why It Matters

A hand-written `_compute_partner_email` that just does `self.partner_email = self.partner_id.email` is functionally identical to `related='partner_id.email'` but costs more code, is one more place to get `@api.depends` wrong, and hides from tooling that this is "just" a related field.

### ❌ Wrong

```python
partner_email = fields.Char(compute='_compute_partner_email')

@api.depends('partner_id')                 # should depend on partner_id.email specifically
def _compute_partner_email(self):
    for rec in self:
        rec.partner_email = rec.partner_id.email
```

### ✅ Correct

```python
partner_email = fields.Char(related='partner_id.email', store=True, readonly=True)
```

### Performance Considerations

A **stored** related field is denormalized into its own column — reads are as cheap as any stored field, but every write to the *source* field on the related model triggers a recompute on every record that relates to it. A related field through a relation with a huge fan-in (e.g., a field related through `partner_id` when a partner has 100,000 related orders) can make an innocuous-looking partner update expensive. Weigh `store=True` against that fan-out before adding it.

### Odoo 17 Notes

No functional change; still the preferred idiom for simple field proxying in 17.

---

## 5. Stored vs. non-stored fields

### Explanation

`store=True` persists a computed/related field's value as a real column, recomputed automatically whenever a declared dependency changes. `store=False` (the default for `compute=`) recomputes on every read and never touches the database.

### Best Practice — decision table

| Situation | Choice |
|---|---|
| Field appears in a list/tree view column | `store=True` (non-stored fields can't be shown efficiently in bulk without triggering N computations) |
| Field is used in a domain (`search()`, a record rule, a `filter` in a search view) | `store=True` (only stored fields are searchable in SQL; non-stored fields need a `search=` method, which is slower and more complex — see `references/03-python-orm-advanced.md`) |
| Field is grouped on, sorted on, or aggregated (`read_group`) | `store=True` |
| Field is shown only on a single record's form view, and cheap to compute | `store=False` is fine, and avoids recompute overhead on unrelated writes |
| Field is expensive to compute (external API call, heavy query) and read often | `store=True`, and consider computing it via a cron instead of a live `@api.depends` if the dependency graph is very wide |

### Why It Matters

Storing everything "just in case" bloats the table, adds recompute cost to every write that touches any dependency, and adds triggers you have to reason about on every future field you add to the dependency chain. Storing nothing forces the ORM to recompute on every access, including inside search domains where it can't push the filter into SQL at all for genuinely computed (non-related) fields — Odoo evaluates those in Python after fetching *all* candidate records, which doesn't scale.

### ❌ Wrong

```python
# Non-stored computed field used inside a list view AND a filter
amount_total = fields.Monetary(compute='_compute_amount_total')   # store=False (default)
```

```xml
<filter name="high_value" string="High Value"
        domain="[('amount_total', '>', 1000)]"/>   <!-- silently slow: Python-side filtering, not SQL -->
```

### ✅ Correct

```python
amount_total = fields.Monetary(compute='_compute_amount_total', store=True)
```

### Performance Considerations

This is the single highest-leverage performance decision in day-to-day Odoo modeling. A non-stored field used in a domain forces Odoo to compute the field for the *entire candidate set* in Python before it can filter — no index, no `LIMIT` pushdown, no `read_group` aggregation. `store=True` turns the same filter into a plain indexed SQL `WHERE`. See `references/10-performance.md` for the full N+1/search cost breakdown.

### Odoo 17 Notes

Odoo 17 popularized `precompute=True` (available since late Odoo 16) as a companion to `store=True` for computed fields whose value can be safely calculated *before* the record is inserted, avoiding a redundant `UPDATE` immediately after `INSERT` during `create()`. Use it for stored computed fields that don't depend on the record already having an `id` (e.g., don't use it for fields depending on `One2many` children created in the same transaction).

```python
amount_total = fields.Monetary(compute='_compute_amount_total', store=True, precompute=True)
```

---

## 6. Constraints

### Explanation

Two mechanisms enforce data integrity at the model layer: Python constraints (`@api.constrains`) and SQL constraints (`_sql_constraints`).

```python
_sql_constraints = [
    ('name_uniq', 'UNIQUE(name, company_id)', "Order reference must be unique per company."),
]

@api.constrains('date_order', 'date_delivery')
def _check_dates(self):
    for order in self:
        if order.date_delivery and order.date_delivery < order.date_order:
            raise ValidationError(_("Delivery date cannot be before the order date."))
```

### Best Practice

- Use `_sql_constraints` for anything a database `CHECK`/`UNIQUE` constraint can express — it's enforced even for direct SQL writes and is generally faster (no Python round-trip).
- Use `@api.constrains` for anything requiring Python logic, relational traversal, or a translated, specific error message.
- List every field read in the constraint method inside the `@api.constrains(...)` decorator — same discipline as `@api.depends`, and for the same reason: it determines when the constraint re-runs.
- Always raise `odoo.exceptions.ValidationError` (or a more specific subclass) with a translated (`_(...)`), actionable message — never a bare `Exception` or an unlocalized f-string aimed at end users.
- Constraints run on `create()` and `write()` automatically — don't also manually call them from your CRUD overrides.

### Why It Matters

Constraints are the enforcement mechanism that's *guaranteed* to run regardless of entry point — UI, external API, data import, another module's `write()`. This is what makes them the right home for "must always be true" business rules, as opposed to onchange (advisory, UI-only) or a view attribute (bypassable).

### ❌ Wrong

```python
@api.constrains('date_delivery')      # missing 'date_order' — changing date_order alone
def _check_dates(self):               # won't re-trigger this constraint
    for order in self:
        if order.date_delivery < order.date_order:
            raise ValidationError("Bad dates")   # unlocalized, unhelpful message
```

### ✅ Correct

```python
@api.constrains('date_order', 'date_delivery')
def _check_dates(self):
    for order in self:
        if order.date_delivery and order.date_delivery < order.date_order:
            raise ValidationError(_(
                "The delivery date (%(delivery)s) cannot be earlier than the order date (%(order)s).",
                delivery=order.date_delivery, order=order.date_order,
            ))
```

### Performance Considerations

`_sql_constraints` are essentially free at write time (the database already validates the row). `@api.constrains` methods run in Python for every record in the affected recordset on every relevant write — keep them O(1) per record where possible, and avoid firing a `search()` per record inside a constraint loop (batch it, e.g., search once for all potential duplicates instead of once per record).

### Security Considerations

Constraints are part of your integrity boundary, not your access-control boundary — they stop *invalid* data, not *unauthorized* access. Don't rely on a constraint to prevent a user from doing something they shouldn't be allowed to do at all; that's `ir.model.access.csv` and record rules (`references/06-security.md`).

### Odoo 17 Notes

No change to the constraint API itself in 17. Just remember that the *view-level* conditional-required (`required="state == 'confirmed'"`) is presentation, not a substitute for a real `@api.constrains` if the rule must hold regardless of which view (or API call) touched the record.

---

## 7. Onchange methods

### Explanation

`@api.onchange` methods run **client-side only**, inside the form view, before the record is saved — they exist purely to give the user live feedback (auto-filling fields, showing a warning) while editing. They never run on `create()`/`write()` calls made outside a form view (API, import, another module).

```python
@api.onchange('partner_id')
def _onchange_partner_id(self):
    if self.partner_id:
        self.payment_term_id = self.partner_id.property_payment_term_id
        if self.partner_id.credit_limit and self.partner_id.total_due > self.partner_id.credit_limit:
            return {'warning': {
                'title': _("Credit Limit Warning"),
                'message': _("This customer has exceeded their credit limit."),
            }}
```

### Best Practice

- Treat `@api.onchange` as **UX sugar only**. Never put a rule there that must hold true — duplicate it as a real constraint or a guarded write if it matters.
- Modern Odoo (16+) increasingly prefers a **stored computed field with `readonly=False`** over `@api.onchange` for "auto-fill but let the user override" behavior, because a compute is enforced consistently everywhere (API, import, form), while onchange only fires in the form UI. Reach for `@api.onchange` mainly for things that are genuinely form-only: transient warnings, dynamic domains, and UI conveniences that shouldn't be "real" data derivations.
- Keep onchange methods free of `self.env.cr.execute()` or heavy queries — they run on every relevant keystroke/selection in the form.
- Return a `{'warning': {...}}` dict for non-blocking user warnings; never try to "block" a save from an onchange — that belongs in a constraint.

### Why It Matters

The most common onchange bug is developers assuming it also governs API-created records, imports, or automated writes — it doesn't. Business rules "enforced" only via onchange are invisible to `xmlrpc`/`jsonrpc` API clients, data imports, and server actions, which is a functional gap, not just a style issue.

### ❌ Wrong

```python
@api.onchange('line_ids')
def _onchange_line_ids(self):
    # attempting to "enforce" a business rule only in the UI
    if len(self.line_ids) > 50:
        raise ValidationError(_("Too many lines!"))   # onchange should never raise
                                                          # ValidationError for control flow —
                                                          # use a warning dict, and also add
                                                          # a real @api.constrains if this
                                                          # must always hold
```

### ✅ Correct

```python
@api.onchange('line_ids')
def _onchange_line_ids(self):
    if len(self.line_ids) > 50:
        return {'warning': {
            'title': _("Large Order"),
            'message': _("This order has more than 50 lines — please double-check."),
        }}

@api.constrains('line_ids')
def _check_line_count(self):
    for order in self:
        if len(order.line_ids) > 200:
            raise ValidationError(_("An order cannot have more than 200 lines."))
```

### Performance Considerations

Onchange methods run synchronously in the browser's request/response cycle every time a dependency field changes in the form — an onchange with a `search()` over a large table will make the form feel sluggish on every edit. Keep them cheap; if a heavier lookup is needed, consider deferring it to save-time via a compute/constraint instead.

### Odoo 17 Notes

Odoo 17's official guidance leans further toward **computed fields with `readonly=False`** over `@api.onchange` for new development, specifically because `@api.onchange` doesn't fire for records created via RPC/import while a `compute` does. When adding new "auto-fill" behavior in 17, default to a stored, `readonly=False` computed field and reserve `@api.onchange` for transient, form-only conveniences (dynamic warnings, non-persisted UI hints).

---

## 8. CRUD overrides

### Explanation

`create()`, `write()`, `unlink()`, `read()`, and `search()` can all be overridden to inject behavior around persistence. Odoo 17's `create()` is **batch-first**: it receives (and should be written to accept) a list of `vals` dicts and return a recordset, not a single dict/id.

```python
class PlantOrder(models.Model):
    _name = 'plant.order'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name'):
                vals['name'] = self.env['ir.sequence'].next_by_code('plant.order') or _('New')
        orders = super().create(vals_list)
        orders._send_creation_notification()
        return orders

    def write(self, vals):
        if 'state' in vals and vals['state'] == 'done':
            for order in self:
                if not order.line_ids:
                    raise UserError(_("Cannot complete an order with no lines."))
        return super().write(vals)

    def unlink(self):
        for order in self:
            if order.state == 'done':
                raise UserError(_("Completed orders cannot be deleted."))
        return super().unlink()
```

### Best Practice

- **Always call `super()`** — and generally do your pre-processing *before* calling it and post-processing *after*, unless you specifically need the parent behavior to run first.
- **`create()` must be decorated `@api.model_create_multi`** and accept/process a **list** of `vals` dicts, looping over the list — not a single dict. Writing single-record-only `create()` overrides silently breaks batch creation performance for every caller, including Odoo's own import and demo-data loading.
- **Never loop calling `self.create({...})` once per record** from inside your own code elsewhere in the module — call `create(list_of_vals)` once. See `references/10-performance.md`.
- Return the correct type from every override: `create()` returns the created recordset, `write()`/`unlink()` return `True`/booleans as the base implementation does — don't change the return contract.
- Validate/guard in `write()`/`unlink()` **before** calling `super()` if the guard needs the *old* values, and **after** if it needs the *new, persisted* values.

### Why It Matters

Because `create()` is batch-first in modern Odoo, a naive single-record override (`def create(self, vals): ...`) either breaks outright when called with a list, or — worse — silently works by accident (e.g., because you call `super().create(vals)` and the parent still handles a dict) while destroying the performance benefit of batching for every future caller who does pass a list, since your intermediate logic still loops per-dict outside the ORM's own batch path.

### ❌ Wrong

```python
def create(self, vals):                     # not batch-first, no @api.model_create_multi
    if not vals.get('name'):
        vals['name'] = 'New'
    return super().create(vals)
```

```python
def write(self, vals):
    res = super().write(vals)                # guard runs AFTER super() already applied
    if vals.get('state') == 'done' and not self.line_ids:   # too late — state is already 'done'
        raise UserError("No lines!")
    return res
```

### ✅ Correct

```python
@api.model_create_multi
def create(self, vals_list):
    for vals in vals_list:
        vals.setdefault('name', self.env['ir.sequence'].next_by_code('plant.order') or _('New'))
    return super().create(vals_list)
```

```python
def write(self, vals):
    if vals.get('state') == 'done':
        for order in self:
            if not order.line_ids:
                raise UserError(_("Cannot complete an order with no lines."))
    return super().write(vals)
```

### Performance Considerations

Batch-first `create()` is what allows Odoo to insert hundreds of records in a handful of SQL statements instead of hundreds of round trips. Any override that iterates `vals_list` doing a `search()` or another single-record query *per dict* reintroduces the N+1 cost the batch API was designed to eliminate — batch your own lookups too (e.g., one `search()` for all needed related records before the loop, not one per `vals` entry).

### Security Considerations

CRUD overrides are a natural place to add authorization checks beyond what `ir.model.access.csv`/record rules express (e.g., "only the assigned salesperson can confirm this order" — see `references/06-security.md`), but don't use them to *replace* access rights/record rules for anything expressible declaratively; declarative rules are easier to audit and can't be forgotten in a code path you didn't think of.

### Odoo 17 Notes — `name_get()` is deprecated

This is one of the most impactful Odoo 17 changes for day-to-day modeling. In Odoo 16 and earlier, controlling how a record's name renders in many2one widgets, breadcrumbs, and `display_name` required overriding `name_get()`. **In Odoo 17, `name_get()` is deprecated** in favor of the `display_name` field (present automatically on every model) computed via `_compute_display_name()`.

❌ **Wrong (Odoo 16 style — do not use in 17)**
```python
def name_get(self):
    result = []
    for order in self:
        name = f"{order.name} - {order.partner_id.name}"
        result.append((order.id, name))
    return result
```

✅ **Correct (Odoo 17)**
```python
@api.depends('name', 'partner_id.name')
def _compute_display_name(self):
    for order in self:
        order.display_name = f"{order.name} - {order.partner_id.name}" if order.partner_id else order.name
```

Reading a record's display name is now always `record.display_name` (a plain field read, batch-fetchable and cacheable like any other field) instead of `record.name_get()[0][1]`. If you inherit a model that still overrides `name_get()` from a third-party module not yet ported to 17, be aware it will keep working via Odoo's compatibility shim but should be migrated to `_compute_display_name()` at the next opportunity — new code should never introduce a fresh `name_get()` override in Odoo 17.
