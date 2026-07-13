# Multi-company

Governs: `company_dependent` fields, `with_company()`, `company_id` handling, cross-company safety.

Multi-company support is one of the areas where code that's "correct" for a single-company deployment quietly breaks the moment a client enables a second company — and because most developers test against single-company demo data, these bugs routinely ship undetected. Treat every model touching business data as if it will eventually run in a multi-company database, even if the current deployment has only one.

---

## 1. `company_dependent` fields

### Explanation

`company_dependent=True` on a field makes its value **vary per company** for the same record, backed by `ir.property` storage rather than a plain column — the canonical example is `product.template.standard_price`, which can differ by company for the same product.

```python
list_price = fields.Float(company_dependent=True, string="Sales Price")
```

### Best Practice

- Reach for `company_dependent=True` only when the field's value **genuinely should differ per viewing company** for what is conceptually the same shared record (a shared product catalog with per-company pricing/accounts) — not as a general-purpose way to "add multi-company support" to a field.
- For the far more common case — a record that simply *belongs to* one company (an order, an invoice, a document) — use a plain `company_id = fields.Many2one('res.company', ...)` field instead (§3), not `company_dependent`.
- Be aware `company_dependent` fields cannot be efficiently used in some SQL-level operations (bulk raw-SQL updates, certain report SQL views) the way plain columns can, since the value isn't a simple column — factor this in before choosing it for a high-volume field.

### Why It Matters

`company_dependent` and "has a `company_id`" solve two different problems that are easy to conflate: the former is "one shared record, many per-company values"; the latter is "this record itself is owned by exactly one company." Using `company_dependent` where a plain `company_id` was needed (or vice versa) produces a data model that doesn't match the actual business reality and is difficult to refactor later without a data migration.

### ❌ Wrong

```python
# A plant order clearly belongs to ONE company — it shouldn't have a "value that
# varies by viewing company"; company_dependent is the wrong tool here
class PlantOrder(models.Model):
    _name = 'plant.order'
    responsible_company = fields.Many2one('res.company', company_dependent=True)
```

### ✅ Correct

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    company_id = fields.Many2one(
        'res.company', string="Company", required=True,
        default=lambda self: self.env.company,
    )
```

### Odoo 17 Notes

No mechanism change to `company_dependent`/`ir.property` in 17.

---

## 2. `with_company()`

### Explanation

`with_company(company)` returns a **new recordset** whose environment has `company.id` as the "active company" for the purposes of company-dependent field resolution, default `company_id` values on newly created records, and various core methods that branch on "the current company" — it is the modern, correct replacement for manually juggling `with_context(allowed_company_ids=[...], force_company=...)`.

```python
# Read/act "as" a specific company, regardless of the user's active company selector
order = self.env['plant.order'].with_company(other_company).create({
    'partner_id': partner.id,
    'line_ids': [...],
})
```

### Best Practice

- Use `with_company(company)` whenever code needs to **act on behalf of a specific company** that isn't necessarily `self.env.company` (the user's currently-selected company in the UI) — e.g., a cron job processing all companies in turn, or an integration explicitly scoped to one company regardless of who's logged in.
- Don't reach for `with_company()` as a default for every method — most code should simply respect `self.env.company` (the user's active selection) and let the framework's own company-switching UI handle the rest.
- When looping over multiple companies (a cron that must process each company's data separately, respecting each company's own settings/sequences/currency), use `with_company()` per iteration rather than trying to process all companies' data in one undifferentiated pass with manual company filtering sprinkled through the logic.

```python
def _cron_process_all_companies(self):
    for company in self.env['res.company'].search([]):
        self.with_company(company)._process_for_active_company()
```

### Why It Matters

Before `with_company()` was standardized, multi-company code relied on manually setting context keys (`force_company`, `allowed_company_ids`) — easy to get subtly wrong (setting one but not the other, or setting it on the wrong recordset) in ways that produce correct-looking behavior for the *currently* active company while silently misbehaving for others. `with_company()` centralizes the correct combination of context changes into one documented call.

### Performance Considerations

`with_company()` is cheap (it derives a new recordset/environment, no extra query) — don't avoid it for performance reasons; use it wherever the *correctness* case calls for explicit company scoping.

### Odoo 17 Notes

`with_company()` is the current, standard API — this is not new in 17 specifically (introduced a few versions prior) but remains the correct idiom in 17 and should be preferred over any remaining `with_context(force_company=...)` pattern found in older code you're maintaining or porting.

---

## 3. `company_id` handling

### Explanation

For the common case of "this record belongs to one company," the field itself needs a sensible default, and every place that creates or filters such records needs to handle it deliberately rather than accidentally.

```python
class PlantOrder(models.Model):
    _name = 'plant.order'

    company_id = fields.Many2one(
        'res.company', string="Company", required=True, index=True,
        default=lambda self: self.env.company,
    )
```

### Best Practice

- Default `company_id` to `self.env.company` (the active company), not `self.env.user.company_id` — `env.company` reflects the currently *selected* company in a multi-company session, which is usually what a new record should be scoped to; `env.user.company_id` is the user's single "main" company and can differ from what they're currently working in.
- Set `index=True` on `company_id` — it's filtered on constantly (both explicitly and via record rules, `references/06-security.md` §4) and deserves an index on any non-trivial table.
- Validate consistency between a record's `company_id` and its related records' `company_id` where it matters (an order's `partner_id` and `company_id` should generally agree with what that partner is allowed to transact with, an order line's product should be available in the order's company) — via `@api.constrains`, not just convention.
- When a `Many2one` should only offer choices from the *same* company, add a domain expressing that: `domain="[('company_id', 'in', (False, company_id))]"` (allowing company-agnostic records, i.e. `company_id = False`, plus same-company ones) is the standard pattern for optionally-shared reference data.

### Why It Matters

`env.company` vs `env.user.company_id` is a common, subtle bug: a user whose main company is "Company A" but who has switched their active company to "Company B" in the UI should get new records defaulted to Company B — using `env.user.company_id` instead silently defaults every new record to the wrong company for any user who ever switches context, which is exactly the multi-company scenario most likely to go untested.

### ❌ Wrong

```python
company_id = fields.Many2one('res.company', default=lambda self: self.env.user.company_id)
# ^ ignores the user's currently active/selected company
```

```python
partner_id = fields.Many2one('res.partner')   # no domain — offers partners from every
                                                  # company indiscriminately, regardless of
                                                  # which company this order belongs to
```

### ✅ Correct

```python
company_id = fields.Many2one('res.company', default=lambda self: self.env.company)
partner_id = fields.Many2one(
    'res.partner',
    domain="[('company_id', 'in', (False, company_id))]",
)
```

### Odoo 17 Notes

No API change; this remains the standard, current pattern in 17.

---

## 4. Cross-company safety

### Explanation

"Cross-company safety" means: a user with access to multiple companies should never be able to (even accidentally) mix data across companies in a way that violates the business's separation expectations — creating an order for Company A using a product only enabled in Company B, or a report silently aggregating figures across companies the user didn't intend to combine.

### Best Practice

- Pair every `company_id` field with a real record rule (`references/06-security.md` §4) — a `company_id` field alone is metadata, not enforcement.
- Apply company-consistency domains on relational fields (§3) so the UI itself steers users toward valid combinations, in addition to (not instead of) a server-side `@api.constrains` check for the same rule.
- When aggregating across companies is *intentional* (a consolidated multi-company report for a holding-company administrator), make that scope explicit and deliberate in the code/UI (a dedicated "Consolidated" view/action, an explicit `with_context(allowed_company_ids=...)` covering exactly the intended set) rather than something that happens implicitly because a filter was forgotten.
- Test multi-company scenarios explicitly — create at least two companies in your test/dev database and verify a user restricted to Company A genuinely cannot see, search, or relate to Company B's records through your new model, not just that the "happy path" single-company flow works.

### Why It Matters

Cross-company leaks are a business-critical, often contractually/legally significant failure mode (financial data, customer data, or pricing agreements from one company visible to staff of another the business explicitly wants separated) — and because most development and demo databases have exactly one company, this class of bug is systematically under-tested unless a team makes a deliberate habit of checking it.

### ❌ Wrong

```python
def get_all_products_summary(self):
    # No company scoping at all — aggregates across every company in the database,
    # visible to any caller regardless of which company(ies) they're restricted to
    products = self.env['product.template'].search([])
    return {'count': len(products), 'total_value': sum(products.mapped('list_price'))}
```

### ✅ Correct

```python
def get_all_products_summary(self):
    # Respects the calling user's active company scope via the standard company_id
    # domain/record-rule path — no special-casing needed if the model is set up per §§3-4
    products = self.env['product.template'].search([('company_id', 'in', (False, self.env.company.id))])
    return {'count': len(products), 'total_value': sum(products.mapped('list_price'))}
```

### Security Considerations

This section is, at its core, a security topic wearing a "multi-company" label — treat cross-company data exposure with the same seriousness as cross-user data exposure in `references/06-security.md`, because from an affected customer's perspective, it often is exactly that (different legal entities, different customers, different confidentiality expectations).

### Odoo 17 Notes

No mechanism change in 17; the discipline above (record rules + consistent `company_id` defaulting + explicit, deliberate cross-company aggregation only where intended) is standing best practice.
