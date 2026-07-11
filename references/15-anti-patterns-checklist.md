# Common Anti-patterns — Consolidated Checklist

A cross-cutting, pre-commit / PR-review checklist. Each row links to the reference file with the full Explanation / Wrong / Correct treatment — use this file to scan quickly, and open the linked file when you need the reasoning or a code example.

How to use this file: before considering an Odoo change "done," scan every row below against the diff. A "yes" in the "Signal you'll see" column is a stop-and-check moment, not necessarily an automatic rejection — but it should always be a deliberate decision, not an accident.

---

## Architecture & structure

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| Editing a core/third-party module's file directly | A diff touching a path outside your own module's addon folder | Silently overwritten on next update; unmergeable with upstream fixes | `_inherit` / view inheritance / `patch()` — see `13-upgrade-safe-development.md` §1 |
| One giant file for all models/views | `models.py`, `views.xml` with 1,000+ lines covering unrelated models | Impossible to review diffs, no predictable place to find things | Split by main model per `01-module-architecture.md` §3 |
| Incomplete `depends` in manifest | Module uses `mail.thread`/other module's model but doesn't list it in `depends` | Works by luck of install order; breaks in a different environment | List every module actually used — `01-module-architecture.md` §5 |
| Business rule enforced only in a view attribute or only in JS | A `UserError`-worthy rule expressed only as `invisible=`/only in an OWL component | Bypassable via API, import, shell, another module | Enforce in a model method / `@api.constrains` — `01-module-architecture.md` §6 |

## Python / ORM

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `create()` override not batch-first | `def create(self, vals):` (singular), no `@api.model_create_multi` | Breaks/degrades batch-calling code | `02-python-models-fields.md` §8 |
| Incomplete `@api.depends` | A compute reads `line_ids.subtotal` but only depends on `line_ids` | Stale values that don't recompute on the write that should trigger them | `02-python-models-fields.md` §3 |
| Non-stored computed field used in a search domain / list column | `store=` omitted (defaults to `False`) on a field also used in a `<filter>`/list | Forces full-table Python-side filtering, no index, no SQL pushdown | `02-python-models-fields.md` §5, `10-performance.md` §8 |
| Business rule enforced only via `@api.onchange` | A `raise` or hard rule inside an `@api.onchange` method | Never runs for RPC-created/imported records | `02-python-models-fields.md` §7 |
| `name_get()` override in new Odoo 17 code | `def name_get(self):` in code written/ported for 17 | Deprecated mechanism; inconsistent with `display_name` elsewhere | Override `_compute_display_name()` — `02-python-models-fields.md` §8 |
| Re-`browse()`-ing single IDs inside a loop | `for id in ids: self.browse(id).field` | Breaks prefetch batching → N+1 queries | `03-python-orm-advanced.md` §6, `10-performance.md` §2 |
| `search()` called inside a loop | A `self.env['x'].search(...)` call textually inside a `for` block | One query per iteration instead of one batched query | `10-performance.md` §2–3 |
| Broad, unjustified `sudo()` | `sudo()` chained "to make an AccessError go away" with no comment explaining why | Silently bypasses the security model for every caller of that method | `03-python-orm-advanced.md` §3, `06-security.md` §5 |
| Missing `self.ensure_one()` | A method reading `self.some_field` (singular-style) with no `ensure_one()` guard | Silently misbehaves (uses only the first record) when called on a multi-record recordset | `03-python-orm-advanced.md` §2 |
| Method override without `super()` | An overridden CRUD/action method with no `super()` call and no comment justifying a full replacement | Silently stops receiving the base method's future fixes/side effects | `13-upgrade-safe-development.md` §2 |

## XML views

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `attrs=`/`states=` in Odoo 17 XML | `attrs="{...}"` or `states="..."` anywhere in a view | **Fails to load at all** in Odoo 17 (`ParseError`) | Direct `invisible=`/`readonly=`/`required=` expressions — `05-xml-views.md` §3 |
| `invisible` used to hide a whole list/tree column | `invisible="..."` on a `<field>` inside a `<tree>`, column still visually present | In 17, `invisible` in a list view only hides the *cell*, not the column | Use `column_invisible="..."` — `05-xml-views.md` §3, §8 |
| Copy-pasted base view instead of inherited | A new `ir.ui.view` record with no `inherit_id`, duplicating an existing view's content | Diverges from and stops benefiting from upstream changes | View inheritance — `05-xml-views.md` §2 |
| XPath targeting by position or translated label | `//field[3]`, `//button[@string='Confirm']` | Breaks on reorder, relabel, or translation | Target by `name=` — `05-xml-views.md` §3 |
| `<list>` used as the Odoo 17 tree-view root tag | `<list>` where `<tree>` is expected | `<list>` is an **Odoo 18+** rename; wrong in 17 | Use `<tree>` — `05-xml-views.md` §8 |
| Menu `groups=` treated as access control | No corresponding `ir.model.access.csv`/record rule restricting the underlying model | Hiding a menu doesn't stop direct/API access | Real model-layer security — `05-xml-views.md` §4, `06-security.md` |

## Security

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| Model with no `ir.model.access.csv` row | A new model with no matching CSV entry | Completely inaccessible to non-superusers (or, if partially configured, unintended exposure) | `06-security.md` §1 |
| Blank `group_id:id` with full CRUD | `...,,1,1,1,1` in the access CSV | Grants full CRUD including delete to every internal user | Scope to a specific group — `06-security.md` §1 |
| Record rule with no `groups` when one was intended | `<field name="domain_force">...</field>` with no `<field name="groups">` | Rule becomes global, ANDed against every other rule for every user | `06-security.md` §2 |
| Wizard with no access rights | A `TransientModel` with no `ir.model.access.csv` entry | "Feels like UI," but is access-controlled exactly like any model | `06-security.md` §1 |
| `company_id` field with no company-scoping record rule | A custom model with `company_id` but no rule filtering on it | Leaks all companies' data to any multi-company user | `06-security.md` §4, `11-multi-company.md` §4 |
| Client-supplied ID/domain trusted unchecked in a controller | `request.env[model].browse(kwargs['id'])` used without an ownership/access check | Lets a client widen its own visibility/authority | `09-controllers-api.md` §5, `06-security.md` §5 |

## OWL / JavaScript

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| OWL 1 idioms in new Odoo 17 code | `odoo.define(...)`, `willStart()`/`mounted()` as plain class methods, `owl.hooks.useState` | OWL 1 patterns don't work the same way against OWL 2's `setup()`-based lifecycle | `07-owl-javascript.md` §§1, 4 |
| Hook called conditionally or outside `setup()` | `useState`/`useService` inside an `if` or a click handler | Breaks OWL's hook-tracking; subtle reactivity bugs | `07-owl-javascript.md` §4 |
| Patch without calling `super` | `patch(X.prototype, { method() { /* no super call */ } })` | Silently drops the original (and any other patch's) behavior | `07-owl-javascript.md` §5 |
| Hand-rolled `fetch()` instead of the `orm`/`rpc` service | Direct `fetch('/web/dataset/call_kw', ...)` in a component | Bypasses standard error handling/loading UI integration | `07-owl-javascript.md` §3 |
| Overly broad asset glob | `'module/static/**/*'` in the manifest `assets` | Ships test-only or wrong-bundle files into production/public bundles | `07-owl-javascript.md` §9 |

## Reports

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| Copy-pasted base report template | A new template duplicating `web.external_layout` structure instead of inheriting | Loses upstream fixes/branding updates | `08-reports.md` §2 |
| `t-esc` instead of `t-field` for model values | `<span t-esc="o.amount_total"/>` | Loses currency/date/relation formatting | `08-reports.md` §1 |
| Per-record queries inside the report's `t-foreach` | A relation accessed inside the loop that wasn't prefetched for the whole batch | Print time scales badly with batch size | `08-reports.md` §3, `10-performance.md` §2 |

## Controllers & APIs

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `auth='public'` on something meant to be internal-only | An admin/internal-data route not requiring login | Exposes internal data/actions to anonymous users | `09-controllers-api.md` §3 |
| Raw traceback/internal detail returned to the client | An unhandled exception reaching a JSON response, or an error string containing file paths/SQL | Leaks internals; poor client experience | Structured, translated error handling — `09-controllers-api.md` §5 |
| Business logic implemented in the controller itself | Validation/state-changing logic inline in the route method, not delegated to a model method | Invisible to every other caller (API, cron, shell) | `01-module-architecture.md` §6, `04-business-logic.md` §1 |

## Performance

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `len(search(domain))` for a count | `len(self.env[...].search([...]))` | Fetches full records just to count them | `search_count()` — `10-performance.md` §3 |
| `search(domain)[0]` for a single record | Indexing into a full search result | Fetches everything just to keep one | `search(domain, limit=1)` — `10-performance.md` §3 |
| Manual Python accumulation instead of `read_group`/`_read_group` | A `for record in records: totals[key] += record.field` pattern | Transfers/iterates every row instead of aggregating in SQL | `10-performance.md` §4 |
| Per-record `create()`/`write()` in a loop | `for x in items: model.create({...})` | Loses batched INSERT/constraint/compute benefits | `10-performance.md` §5 |
| Raw SQL used for convenience, not necessity | `cr.execute(...)` replacing a straightforward ORM `search`/`write` | Skips constraints, security, compute triggers, chatter | `10-performance.md` §6 |
| Unparametrized raw SQL | f-string/`%`-formatted SQL text | SQL-injection risk | Parametrize with `%s` + a tuple — `10-performance.md` §6 |

## Multi-company

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `company_id` defaulted from `env.user.company_id` | `default=lambda self: self.env.user.company_id` | Ignores the user's currently *active* company selection | Use `self.env.company` — `11-multi-company.md` §3 |
| Relational field with no company-consistency domain | A `Many2one` offering records from every company indiscriminately | Lets users create invalid cross-company relations | Company-consistency `domain=` — `11-multi-company.md` §3 |
| Aggregation query with no company scoping | A `search([])`/report query with no `company_id` filter | Silently mixes figures across companies | Explicit, deliberate scoping — `11-multi-company.md` §4 |

## Data files

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| Functional/required data placed under `demo` | A sequence/config record only in the `demo` manifest list | Missing entirely from production (non-demo) installs | Move to `data` — `12-data-files.md` §3 |
| Admin-customizable data shipped without `noupdate` | An email template / default config record, freely updatable | Admin customizations silently wiped on every module update | Wrap in `noupdate="1"` — `12-data-files.md` §4 |
| Security-relevant data shipped with `noupdate` | A record rule / access right wrapped in `noupdate="1"` | Future security fixes never reach existing installs | Leave updatable — `12-data-files.md` §4 |
| Hardcoded numeric database ID | `browse(42)`, `eval="17"` | Works by coincidence in one database, wrong/broken everywhere else | Reference by external ID (`ref=`/`env.ref()`) — `12-data-files.md` §5 |

## Upgrade safety

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| Renaming a shipped external ID | An `id=` attribute changed on a record that previously shipped under a different ID | Orphans anything that referenced the old ID; can silently drop customizations/data | Keep IDs stable once shipped — `13-upgrade-safe-development.md` §3 |
| Deep coupling to another module's private (`_`-prefixed) methods | Calling `other_model._some_private_helper()` from your own module | Private methods can change shape across versions with no deprecation notice | Use public methods/documented extension points — `13-upgrade-safe-development.md` §4 |

## Testing

| Anti-pattern | Signal you'll see | Why it's a problem | Fix |
|---|---|---|---|
| `SavepointCase` imported in new Odoo 17 test code | `from odoo.tests.common import SavepointCase` | Deprecated; `TransactionCase` already provides this behavior | Use `TransactionCase` — `14-testing.md` §2 |
| Only happy-path tests | No test that deliberately violates a constraint/guard and asserts the error | Regressions to validation/security pass silently | Test the guard, not just success — `14-testing.md` §3 |
| Tests only run as the default (often superuser-like) test user | No `with_user(...)` anywhere in the suite | Never catches missing/incorrect access rights or record rules | Test as a restricted user — `14-testing.md` §3 |

---

## Suggested review flow

1. Run this checklist top-to-bottom against the diff.
2. For every row that matches something in the diff, open the linked reference file section and confirm the fix is genuinely applied (not just superficially — e.g., confirm `@api.depends` actually lists *every* read field, not just that the decorator is present).
3. Re-run `references/06-security.md`'s three-layer mental model (ACL → record rule → field-level groups) specifically for any new model or any new field on a sensitive existing model.
4. For anything touching views, specifically grep the diff for `attrs=`/`states=` — this single check catches the most common Odoo 17 breakage.
5. For anything touching JS, specifically grep for `odoo.define(` and `owl.hooks`/`owl.Component` — signals of unported OWL 1 code.
