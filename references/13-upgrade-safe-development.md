# Upgrade-safe Development

Governs: extension instead of modification, proper inheritance, stable XML IDs, migration-friendly customization.

Odoo modules get upgraded — the core, other installed modules, and your own module all evolve over time, and a database that installed version 1.0 of your module today will eventually run version 1.4, then get migrated to Odoo 18. Everything in this file is about writing customizations today that survive that process without manual, database-by-database surgery.

---

## 1. Extension instead of modification

### Explanation

This is the umbrella principle the rest of this file (and much of `references/01-module-architecture.md` §6 and `references/05-xml-views.md` §2) already establishes: **never edit a file that belongs to another module.** Every customization need has an extension mechanism — `_inherit` for Python, view/report inheritance for XML, `patch()` for JS (`references/07-owl-javascript.md` §5) — and reaching for direct modification instead of the matching extension mechanism is close to always the wrong call.

### Best Practice

- If you find yourself opening a core or third-party module's file to change it directly, stop — there is almost always an inheritance/extension mechanism for what you're trying to do; find it instead.
- Keep 100% of your customization inside your own module(s). A deployment should be able to identify every piece of custom behavior by looking at which custom modules are installed — not by diffing core files against a pristine copy.
- If a genuine core bug blocks you and no extension point exists, the correct paths are (in order of preference): report/fix it upstream, use a documented monkey-patch **isolated in your own module** with clear versioning/removal criteria (see §2), or as an absolute last resort, a maintained fork — never a silent, undocumented direct edit to vendored core code.

### Why It Matters

A directly-modified core file is invisible to Odoo's own upgrade tooling — the next `apt`/`pip` update, Docker image rebuild, or `odoo.sh`/hosted-platform update **overwrites it silently**, discarding your change with no warning. Worse, if it *doesn't* get overwritten (a manually-managed on-prem install), it now conflicts with every future patch to that file, turning routine security/bugfix updates into a merge-conflict exercise on code you were never supposed to be maintaining a fork of in the first place.

### ❌ Wrong

```python
# Directly editing addons/sale/models/sale_order.py to add a field
# This file will be silently overwritten on the next Odoo update.
class SaleOrder(models.Model):
    _name = 'sale.order'
    my_custom_field = fields.Char()   # added directly into core source
```

### ✅ Correct

```python
# your_module/models/sale_order.py — a proper extension, safe across updates
class SaleOrder(models.Model):
    _inherit = 'sale.order'
    my_custom_field = fields.Char()
```

### Odoo 17 Notes

Not version-specific — this is the foundational principle Odoo's whole module system is designed around, and it holds identically across every version.

---

## 2. Proper inheritance

### Explanation

"Proper" inheritance means using the *narrowest, most targeted* extension mechanism for the change, rather than reaching for a broader or more invasive one out of habit or unfamiliarity with the more precise tool.

### Best Practice — pick the right tool

| You want to... | Use |
|---|---|
| Add/change a field or method on an existing model | Classical `_inherit` (`references/03-python-orm-advanced.md` §9) |
| Add/rearrange elements in an existing view | View inheritance + XPath (`references/05-xml-views.md` §§2–3) |
| Add/change a column in an existing report | Report inheritance (`references/08-reports.md` §2) |
| Change existing JS component/service behavior | `patch()` (`references/07-owl-javascript.md` §5) |
| Change behavior only for records matching a condition | Override a method, call `super()`, branch on the condition — don't fork the whole method |
| Add genuinely new, unrelated functionality | A new model/module, not a forced extension of an unrelated existing one |

- When overriding a method via `_inherit`, **change only what's necessary** and **always call `super()`** unless you have a specific, documented reason to fully replace the base behavior — a full override that doesn't call `super()` silently stops receiving any future logic the base method gains (bug fixes, new required side effects added by a later core version).
- Prefer additive XPath positions (`before`/`after`/`inside`/`attributes`) over `replace` wherever the intent is genuinely additive (`references/05-xml-views.md` §3) — `replace` opts a specific node out of ever benefiting from upstream changes to it again.

### Why It Matters

The gap between "technically uses `_inherit`" and "properly, narrowly inherits" is where a lot of fragile customization lives — a method override that doesn't call `super()` is nominally "using inheritance" but behaves, from an upgrade-safety standpoint, almost like a direct modification: it freezes behavior at whatever your override implements and stops tracking the base method's future evolution.

### ❌ Wrong

```python
class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def action_confirm(self):
        # Full reimplementation, no super() call — any future core fix or
        # side effect added to action_confirm() in a later Odoo version
        # (e.g., a new required stock reservation step) never happens for
        # orders confirmed through this override
        self.state = 'sale'
        self._send_confirmation_email()
```

### ✅ Correct

```python
class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def action_confirm(self):
        res = super().action_confirm()
        self._send_confirmation_email()
        return res
```

### Odoo 17 Notes

Nothing version-specific in the principle itself. Practically, though: **when porting an override written for Odoo 16 to 17**, re-check whether the base method's signature, return contract, or the fields it touches changed (`name_get()` → `_compute_display_name()` is exactly this kind of change — `references/02-python-models-fields.md` §8) before assuming a `super()` call still does the same thing it used to.

---

## 3. Stable XML IDs

### Explanation

Once an external ID (`references/12-data-files.md` §5) has shipped in a module version that real databases have installed, it becomes part of your module's effective public interface: those databases' `ir.model.data` tables now map that ID to a specific internal record, and anything — your own future module versions, other modules inheriting your views, manual references in customer-specific customizations — may depend on it continuing to exist and mean the same thing.

### Best Practice

- **Never rename or remove a shipped external ID** without a deliberate, documented migration step (see §4) — a rename is, from the upgrade system's perspective, indistinguishable from "delete the old record, create an unrelated new one," which orphans anything that referenced the old ID and can silently drop data (e.g., an old view's customizations if the ID it was inheriting from disappears).
- If a record genuinely needs to be restructured, prefer **keeping the old external ID pointing at *a* valid, working record** (even if its internal implementation changes) over deleting and recreating it under a new ID.
- Choose external IDs carefully *before* shipping (per the naming conventions in `references/01-module-architecture.md` §4) specifically because changing them later is expensive — a few extra minutes naming things well up front avoids a painful migration later.
- When you do need to deprecate a record, prefer marking it inactive/deprecated in place (where the model supports it) over deleting it outright, and only actually remove the external ID in a major version bump with an explicit migration script handling the transition (§4).

### Why It Matters

A renamed/removed XML ID doesn't fail loudly in the way a Python `AttributeError` would — the next module update simply orphans whatever pointed at it (an inheriting view silently stops applying, a `ref()` call starts raising `ValueError: External ID not found` for every database that already had the old install), often discovered only when a customer reports "my customization disappeared after the update."

### ❌ Wrong

```xml
<!-- v1.0 shipped this -->
<record id="plant_order_view_form" model="ir.ui.view">...</record>
```
```xml
<!-- v1.1 "cleans up" the ID naming — breaks every database that has a
     customization inheriting plant_nursery.plant_order_view_form from v1.0 -->
<record id="plant_order_form_view" model="ir.ui.view">...</record>
```

### ✅ Correct

Keep the original ID for the life of the module's major version line; if the naming genuinely must change, do it as part of a documented major-version migration (§4) with an explicit rename step, not a silent rename in a minor update.

### Odoo 17 Notes

Not version-specific — but directly relevant to any 16→17 migration project: if your migration touches view IDs at all (e.g., while adapting `attrs`/`states` usage — `references/05-xml-views.md` §3), make sure you're editing the **content** of the existing view record, not incidentally renaming its `id=`.

---

## 4. Migration-friendly customization

### Explanation

Beyond "don't break within a version," migration-friendliness is about minimizing the pain of moving a database (and its accumulated customizations) from one Odoo major version to the next — e.g., 16 → 17, or a future 17 → 18.

### Best Practice

- **Isolate customizations by concern into small, focused modules** rather than one monolithic "customizations" module — smaller modules are easier to evaluate individually for "does this still make sense / does this still work" during a migration, and easier to selectively drop if a customization has become obsolete (e.g., core now natively does what your customization used to add).
- **Avoid deep coupling to another module's private (underscore-prefixed) methods** where a public method or a documented extension point exists — private methods are more likely to change shape across major versions without any deprecation warning, since they're not considered part of the stable API.
- **Keep customization logic in Python/XML using documented ORM/view APIs**, not in raw SQL against Odoo's internal table structure (`references/10-performance.md` §6) — internal table/column layouts are far more likely to change across major versions than the ORM's public surface.
- **Write and maintain a migration script** (`migrations/17.0.1.1.0/post-migrate.py` following the OCA/Odoo migration-script convention) for any change that needs to transform existing data — a new required field, a restructured relation, a changed meaning for an existing field's values — rather than assuming existing databases will "just work" after the update.
- **Track which core behaviors you're relying on that are newer/version-specific** (like the `attrs`/`states` removal or `_compute_display_name()` in this handbook) in your own module's changelog/comments, so the *next* migration (17→18 and beyond) has a documented starting point instead of requiring fresh archaeology.

### Why It Matters

The cost of a major-version migration is dominated by custom code, not core upgrade tooling (which handles core/OCA modules reasonably well via the standard upgrade path) — the more your customizations lean on documented, stable extension points and the less they lean on private internals or direct modification, the closer a migration gets to "update the dependency, run the tests, fix the handful of things that genuinely changed" instead of "re-derive what this customization was even trying to do from scratch."

### Odoo 17 Notes

If you are migrating a codebase *into* Odoo 17 right now, budget real time specifically for the `attrs`/`states` removal (`references/05-xml-views.md` §3) and the OWL 1→2 rewrite (`references/07-owl-javascript.md`) — these are consistently reported as the two most time-consuming parts of a 16→17 upgrade for real-world module portfolios, precisely because they touch nearly every view file and every custom JS component respectively, not because either change is conceptually difficult in isolation.
