# Module Architecture

Governs: standard module structure, `__manifest__.py`, file organization, naming conventions, dependencies, separation of responsibilities.

A module is the unit of deployment, upgrade, and dependency management in Odoo. Getting its shape wrong doesn't cause bugs on day one — it causes merge conflicts, impossible code reviews, and multi-day upgrades two years later. Structure is a performance property of your *team*, not of the runtime.

---

## 1. Standard module structure

### Explanation

Odoo's own coding guidelines define a canonical directory layout. Every core and OCA module follows it, which means any Odoo developer can open an unfamiliar module and know where to look in under a minute. Deviating from it taxes every future reader, including future-you.

```
addons/plant_nursery/
├── __init__.py
├── __manifest__.py
├── controllers/
│   ├── __init__.py
│   ├── plant_nursery.py
│   └── portal.py                  # inherits portal/controllers/portal.py
├── data/
│   ├── plant_nursery_data.xml
│   ├── plant_nursery_demo.xml
│   └── mail_data.xml
├── models/
│   ├── __init__.py
│   ├── plant_nursery.py           # main model, same name as module
│   ├── plant_order.py             # secondary main model
│   └── res_partner.py             # inherited core model — own file
├── report/
│   ├── __init__.py
│   ├── plant_order_report.py      # SQL-view based statistics model
│   ├── plant_order_report_views.xml
│   ├── plant_order_reports.xml    # report actions, paperformat
│   └── plant_order_templates.xml  # QWeb report templates
├── security/
│   ├── ir.model.access.csv
│   ├── plant_nursery_groups.xml
│   └── plant_nursery_security.xml # record rules
├── static/
│   ├── description/
│   │   └── icon.png
│   ├── img/
│   └── src/
│       ├── js/
│       ├── scss/
│       └── xml/
├── views/
│   ├── plant_nursery_menus.xml
│   ├── plant_nursery_views.xml
│   ├── plant_order_views.xml
│   └── res_partner_views.xml
├── wizard/
│   ├── make_plant_order.py
│   └── make_plant_order_views.xml
└── tests/
    ├── __init__.py
    └── test_plant_order.py
```

### Best Practice

- `models/`, `views/`, `security/`, `static/`, `data/`, `controllers/` are the "core" directories — a reader should understand the module's purpose from these alone.
- `wizard/`, `report/`, `tests/` are optional and added only when the module actually has transient models, printable/statistical reports, or automated tests.
- Every Python package directory (`models/`, `controllers/`, `wizard/`, `report/`) needs its own `__init__.py` that imports its sibling files — Python won't discover them otherwise.

### Why It Matters

A predictable structure is what makes `_inherit` and view inheritance safe across modules: you can find "the form view for `sale.order`" without reading code, just by pattern-matching a filename. It also makes automated tooling (linters, upgrade scripts, OCA's `pre-commit` hooks) reliable, since they assume this layout.

### ❌ Wrong

```
my_module/
├── __manifest__.py
├── code.py              # everything in one file: models, wizards, reports
├── my_views.xml         # views, menus, actions, security all mixed together
└── security.csv         # wrong filename — Odoo expects ir.model.access.csv
```

### ✅ Correct

Use the layout above. Split `code.py` into `models/`, `wizard/`, `report/` by responsibility, and split `my_views.xml` into `<model>_views.xml`, `<model>_menus.xml`, and `security/ir.model.access.csv` + `security/<module>_security.xml`.

### Performance Considerations

Directory layout has no runtime cost, but a bloated single file (`models.py` with 3,000 lines) slows down `-u module` reloads during development because your editor, linter, and Odoo's Python import all pay the parsing cost on every change to any model. Small, focused files make iterative development faster.

### Odoo 17 Notes

No structural change from 16→17 here — this layout has been stable for many major versions and is safe to treat as a long-term convention.

---

## 2. The manifest (`__manifest__.py`)

### Explanation

`__manifest__.py` is a plain Python dict literal (never executed as arbitrary code beyond `ast.literal_eval`-safe content) that declares the module's metadata, dependencies, and the data files to load at install/update time.

```python
{
    'name': "Plant Nursery",
    'version': '17.0.1.2.0',
    'category': 'Inventory/Inventory',
    'summary': "Manage plant orders and nursery stock",
    'description': """
Plant Nursery Management
=========================
Track plants, orders, and delivery schedules for a nursery business.
""",
    'author': "Your Company",
    'website': "https://www.yourcompany.com",
    'license': 'LGPL-3',
    'depends': [
        'base',
        'mail',
        'stock',
    ],
    'data': [
        'security/plant_nursery_groups.xml',
        'security/ir.model.access.csv',
        'security/plant_nursery_security.xml',
        'data/plant_nursery_data.xml',
        'views/plant_nursery_menus.xml',
        'views/plant_nursery_views.xml',
        'views/plant_order_views.xml',
        'wizard/make_plant_order_views.xml',
        'report/plant_order_reports.xml',
    ],
    'demo': [
        'data/plant_nursery_demo.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'plant_nursery/static/src/js/**/*',
            'plant_nursery/static/src/scss/**/*',
            'plant_nursery/static/src/xml/**/*',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
}
```

### Best Practice

| Key | Guidance |
|---|---|
| `name` | Human-readable app/module title shown in Apps. Not a technical identifier. |
| `version` | `17.0.MAJOR.MINOR.PATCH` — the `17.0` prefix lets the Apps store and upgrade tooling match modules to the right Odoo series. |
| `license` | Required as of recent Odoo versions; use an [OSI-approved identifier](https://spdx.org/licenses/) such as `LGPL-3` or `OPL-1` for paid/proprietary. |
| `depends` | List every module whose models, views, or security groups you directly reference — even if a transitive dependency happens to pull it in already. Don't rely on transitivity. |
| `data` | Load order matters: security groups before `ir.model.access.csv` before record rules before views before actions/menus that reference them. |
| `demo` | Only files meant purely to populate a demo/trial database — never business-critical configuration. |
| `assets` | Odoo 17 uses the dict-based `assets` key (glob patterns), not manually maintained `<script>`/`<link>` tags in XML templates. |
| `application` | `True` only for the module that should appear as a top-level "App" in the Apps grid. |
| `auto_install` | Leave `False` unless this module is a "glue" module that should install automatically the moment all of its dependencies are present. |

### Why It Matters

The `depends` list is the *only* thing the module system trusts to compute install/update order and to decide what's safe to uninstall together. An incomplete `depends` list is a landmine: your module might work today because some other installed module happens to load its dependency first, and then break in a different environment, a different install order, or after that other module is uninstalled.

### ❌ Wrong

```python
{
    'name': "Plant Nursery",
    'depends': ['base'],      # module actually uses mail.thread and stock.move
    'data': [
        'views/plant_order_views.xml',    # references a group defined in groups.xml,
        'security/plant_nursery_groups.xml',  # but groups.xml is listed AFTER the view
        'security/ir.model.access.csv',
    ],
}
```

This installs successfully in some environments (if `mail`/`stock` happen to already be loaded by another dependency) and throws a `ParseError: unknown group` in others, depending purely on install order.

### ✅ Correct

```python
{
    'name': "Plant Nursery",
    'version': '17.0.1.0.0',
    'license': 'LGPL-3',
    'depends': ['base', 'mail', 'stock'],   # every module actually used
    'data': [
        'security/plant_nursery_groups.xml',   # groups first
        'security/ir.model.access.csv',        # then access rights that reference them
        'security/plant_nursery_security.xml', # then record rules
        'views/plant_nursery_views.xml',       # then views/actions/menus
    ],
}
```

### Performance Considerations

Every file listed in `data`/`demo` is parsed and loaded sequentially on install/update — keep XML files focused so a change to one view doesn't force re-parsing an unrelated 2,000-line data file. Glob patterns in `assets` are resolved at asset-bundle build time; overly broad globs (`static/src/**/*`) can accidentally pull in test-only JS into the production bundle — scope globs to `js/`, `scss/`, `xml/` subfolders.

### Security Considerations

`depends` also matters for the security graph: uninstalling a module cleanly removes only what that module owns. If you silently rely on another module without declaring the dependency, uninstalling *that* module later can leave your module in a broken, undeclared state that the framework didn't know to warn about.

### Odoo 17 Notes

- `license` is mandatory — modules without it fail to load with a clear error.
- Use the `assets` dict key for all JS/SCSS/XML asset registration; don't hand-roll `<template inherit_id="web.assets_backend">` XML for new modules — it still works but the manifest key is the modern, preferred mechanism and is far less error-prone for ordering.
- `'application': True` plus a `category` controls where the module shows up in Apps; get the category right so it isn't lost in "Uncategorized" during a review.

---

## 3. File organization (naming files, not just folders)

### Explanation

Beyond directories, Odoo's guidelines prescribe *which file* a given piece of code or XML belongs in, keyed off the **main model** it concerns.

### Best Practice

| Content | File pattern | Example |
|---|---|---|
| Model definition | `models/<main_model>.py` | `models/plant_order.py` |
| Inherited *core* model | `models/<inherited_model>.py` (own file, never appended to another file) | `models/res_partner.py` |
| Backend views (form/tree/kanban/search) | `views/<main_model>_views.xml` | `views/plant_order_views.xml` |
| Menus (if extracted) | `views/<module>_menus.xml` | `views/plant_nursery_menus.xml` |
| Website/portal QWeb templates | `views/<main_model>_templates.xml` | `views/plant_order_templates.xml` |
| Access rights | `security/ir.model.access.csv` | (single file, fixed name) |
| Groups | `security/<module>_groups.xml` | `security/plant_nursery_groups.xml` |
| Record rules | `security/<main_model>_security.xml` | `security/plant_order_security.xml` |
| Demo/data | `data/<main_model>_data.xml` / `_demo.xml` | `data/plant_nursery_demo.xml` |
| Transient model + its view | `wizard/<transient_name>.py` + `_views.xml` | `wizard/make_plant_order.py` |
| Printable report (data prep + template) | `report/<main_model>_reports.xml`, `_templates.xml` | `report/plant_order_templates.xml` |
| Statistical report (SQL view model) | `report/<main_model>_report.py` | `report/plant_order_report.py` |
| JS component | `static/src/js/<feature>/<component>.js` (+ matching `.xml`, `.scss`) | `static/src/js/order_kanban/order_kanban.js` |

### Why It Matters

This is what makes `grep`-free navigation possible in a codebase with hundreds of modules. When a teammate says "the sale order form view is misbehaving," you know it's in `sale/views/sale_order_views.xml` before you've opened an editor. It also structurally discourages god-files: if the convention is one main model per file, a file that starts accumulating 4 unrelated models is a visible smell in the file tree, not just in a code review comment.

### ❌ Wrong

```
models/plant_nursery.py     # contains PlantNursery, PlantOrder, ResPartner (inherited), and MailTemplate glue
views/all_views.xml         # every view in the module, 1400 lines
```

### ✅ Correct

Split by main model as shown in the table: `models/plant_nursery.py`, `models/plant_order.py`, `models/res_partner.py`; `views/plant_nursery_views.xml`, `views/plant_order_views.xml`, `views/res_partner_views.xml`.

### Performance Considerations

Purely a maintainability property — no runtime effect. The indirect performance win is in *code review and CI time*: small, single-purpose files produce small, reviewable diffs, which is what actually keeps defect rates low in a fast-moving Odoo codebase.

### Odoo 17 Notes

Unchanged from prior versions; still the current official guidance at the 17.0 documentation.

---

## 4. Naming conventions

### Explanation

Odoo enforces almost no naming rules at the framework level — model names, field names, and XML IDs can technically be anything. The *convention* is a team discipline that keeps generated SQL, generated labels, and cross-module references predictable.

### Best Practice

| Element | Convention | Example |
|---|---|---|
| Technical module name (folder) | `snake_case`, prefixed for community/custom modules (company or project prefix) | `acme_plant_nursery` |
| Model `_name` | dot-separated, singular, lowercase | `plant.nursery`, `plant.order.line` |
| Model class name | `CamelCase`, ideally matching `_name` | `class PlantOrder(models.Model)` |
| Many2one field | suffix `_id` | `partner_id`, `user_id` |
| One2many / Many2many field | suffix `_ids` | `order_line_ids`, `tag_ids` |
| Boolean field | prefix `is_`/`has_`/`active` phrasing | `is_confirmed`, `has_discount` |
| Selection/state field | `state` by convention for workflow status | `state = fields.Selection(...)` |
| Compute method | prefix `_compute_` | `_compute_amount_total` |
| Inverse method | prefix `_inverse_` | `_inverse_amount_total` |
| Search method (for related/computed fields used in domains) | prefix `_search_` | `_search_amount_total` |
| Default value method | prefix `_default_` | `_default_currency_id` |
| Onchange method | prefix `_onchange_` | `_onchange_partner_id` |
| Constraint method | prefix `_check_` | `_check_dates` |
| Action method bound to a button (`type="object"`) | prefix `action_`, and call `self.ensure_one()` first | `action_confirm` |
| Cron-called method | prefix `_cron_` | `_cron_send_reminders` |
| "Private", non-API method | leading underscore | `_get_eligible_lines` |
| XML ID for a view | `<model_name>_view_<view_type>` | `plant_order_view_form` |
| XML ID for an action | `<model_name>_action[_<detail>]` | `plant_order_action` |
| XML ID for a menu | `<model_name>_menu[_<detail>]` | `plant_order_menu` |
| XML ID for a group | `<module>_group_<role>` | `plant_nursery_group_manager` |
| XML ID for a record rule | `<model_name>_rule_<scope>` | `plant_order_rule_company` |

### Why It Matters

Consistent suffixes (`_id`/`_ids`) let any developer read a domain or a `mapped()` call and know the type without opening the model definition: `order.line_ids.mapped('product_id.name')` is self-describing. Consistent method prefixes (`_compute_`, `_onchange_`, `_check_`) are also what let tools and reviewers instantly classify a method's contract — a `_compute_` method is expected to be pure and side-effect-free on other records, an `_onchange_` method is expected to only touch fields on the in-memory record, and so on.

### ❌ Wrong

```python
class PlantOrder(models.Model):
    _name = 'plant.order'

    plant = fields.Many2one('plant.nursery')          # relational field missing _id suffix
    tags = fields.Many2many('plant.tag')               # relational field missing _ids suffix
    confirmed = fields.Boolean()                        # ambiguous: confirmed by whom, when?

    def confirm(self):                                  # button action without action_ prefix
        ...

    def calc_total(self):                                # compute method not prefixed/registered as compute
        for rec in self:
            rec.total = sum(rec.line_ids.mapped('price'))
```

### ✅ Correct

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    _description = 'Plant Nursery Order'

    plant_id = fields.Many2one('plant.nursery', string="Plant")
    tag_ids = fields.Many2many('plant.tag', string="Tags")
    is_confirmed = fields.Boolean(default=False)
    amount_total = fields.Float(compute='_compute_amount_total', store=True)

    @api.depends('line_ids.price')
    def _compute_amount_total(self):
        for order in self:
            order.amount_total = sum(order.line_ids.mapped('price'))

    def action_confirm(self):
        self.ensure_one()
        self.is_confirmed = True
```

### Security Considerations

Naming discipline has an indirect but real security payoff: `_check_*` and `_compute_*` prefixes make it obvious during review which methods are validation (must raise, never silently pass) versus derived data (must never mutate other records). Reviewers catch far more logic bugs — including authorization bugs — in consistently named codebases.

### Odoo 17 Notes

No naming-convention changes in 17 itself, but remember that `name_get()` is deprecated in favor of overriding `_compute_display_name()` (see `references/02-python-models-fields.md`) — so the "prefix method with underscore + verb" convention now also covers `_compute_display_name`.

---

## 5. Dependencies

### Explanation

`depends` in the manifest is a directed acyclic graph edge: "my module needs everything in these modules to be loaded first." Odoo uses it for install order, update propagation (updating a dependency schedules your module for update too, if it changed), and uninstall safety (you can't uninstall a module something else still depends on without cascading).

### Best Practice

- **Depend on the smallest module that provides what you need**, not the biggest "kitchen sink" module in the same family. If you only need `res.partner` fields, depend on `base`, not `sale`.
- **Declare every module whose model, field, view ID, or security group you directly reference** — including "soft" dependencies like `mail` for `mail.thread`, or `web` for a JS asset bundle target.
- **Avoid circular dependencies** between custom modules — if module A's model needs to reference module B's model and vice versa, that's a signal the shared concept belongs in a third, lower-level module both depend on.
- Use `auto_install: True` only for genuine "bridge/glue" modules (e.g., `sale_stock` connecting `sale` and `stock`) — never for a module with real, opinionated business logic that installers should choose deliberately.

### Why It Matters

Odoo resolves `data`/`demo` file *load order across all installed modules* using this graph. If your module's record rule references a group defined in a module you didn't declare a dependency on, whether the install succeeds is pure luck of module discovery order — and it will eventually fail in a fresh environment or a different install command.

### ❌ Wrong

```python
{
    'depends': ['sale'],   # module only touches res.partner and mail.thread;
                            # 'sale' is a huge, unrelated transitive dependency
}
```

```python
# module_a/models/thing.py
class Thing(models.Model):
    _name = 'module_a.thing'
    other_id = fields.Many2one('module_b.other')   # module_a does NOT depend on module_b
```

### ✅ Correct

```python
{
    'depends': ['base', 'mail'],   # exactly what is used
}
```

If two custom modules need to reference each other's models, extract the shared model/interface into a small `*_base` module that both depend on, instead of a circular reference.

### Performance Considerations

Bloated dependency chains slow down every install/update of a database that has your module, because Odoo must load and register every transitively-depended module's models and views even if you use 1% of them. Minimal, precise dependencies keep dev/CI cycle times down.

### Odoo 17 Notes

No mechanical change in 17, but because `attrs`/`states` were removed (see the XML views reference), a module that inherits a view with an `attrs` XPath from an old OCA/community module that hasn't been ported to 17 will fail to load — this shows up as a dependency-adjacent failure (`ParseError` on install) even though the manifest graph itself is fine. Verify third-party dependencies are actually 17.0-native, not just present in an addons path.

---

## 6. Separation of responsibilities

### Explanation

"Separation of responsibilities" here means: each *kind* of file does exactly one job, and business rules live in exactly one place (models/services), not smeared across views, controllers, and JS.

### Best Practice

| Layer | Responsible for | Must NOT contain |
|---|---|---|
| Models (`models/`) | Data shape, validation, computed values, all business rules | Presentation logic, HTTP concerns |
| Views (`views/*.xml`) | Layout and presentation of existing fields/actions | New business rules (a view should never be the only place a rule is enforced) |
| Controllers (`controllers/`) | HTTP/JSON request parsing, auth, response shaping | Business rules — controllers should call a model method and translate its result, not compute the result themselves |
| Wizards (`wizard/`) | Multi-step/one-off user input collection, then delegate to model methods | Long-lived business rules that should survive the wizard's transient record |
| Reports (`report/`) | Data selection/formatting for print/PDF | Business rules that also need to hold outside of printing context |
| JS/OWL (`static/src/`) | UI interactivity, optimistic UI, client-side validation for UX | The *authoritative* validation (server must re-validate everything client JS checks) |

### Why It Matters

If "an order can't be confirmed with zero lines" is enforced only in a button's `invisible` view attribute, it's trivially bypassed via the external API, `write()` from another module, or the Odoo shell. If it's enforced only in JS, it's bypassed by anyone calling the JSON-RPC endpoint directly. The model layer is the only layer every code path — UI, API, cron, import, other modules — is guaranteed to pass through, so that's where the rule must live, expressed as a constraint or a guarded state-transition method.

### ❌ Wrong

```xml
<!-- "Business rule" enforced only by hiding the button -->
<button name="action_confirm" string="Confirm"
        invisible="not line_ids"/>
```

```python
def action_confirm(self):
    self.write({'state': 'confirmed'})   # no guard — assumes the view always protected this
```

### ✅ Correct

```python
def action_confirm(self):
    for order in self:
        if not order.line_ids:
            raise UserError(_("You cannot confirm an order with no lines."))
    self.write({'state': 'confirmed'})
```

```xml
<!-- View still hides the button for a good UX, but it's not the enforcement point -->
<button name="action_confirm" string="Confirm"
        invisible="not line_ids"/>
```

### Security Considerations

This is fundamentally a security property, not just a style one: any rule expressed only in XML or JS is advisory, not enforced. Treat "is this rule checked server-side, in the model layer, regardless of caller" as a mandatory review question for anything described as validation, approval, or access control. See `references/06-security.md` for the record-rule/ACL side of this same principle.

### Performance Considerations

Correct separation also tends to be the performant shape: putting a computation in a `compute=` method lets the ORM cache and batch it; duplicating the same computation independently in a report, a controller, and a JS widget means three implementations to keep in sync and three chances to compute it inefficiently (e.g., the report re-querying per-record instead of reusing the batched compute).

### Odoo 17 Notes

Odoo 17's removal of `attrs`/`states` makes it *easier* to accidentally treat a view attribute as if it were a business rule, because `invisible="state == 'draft'"` reads like real logic. It is still purely presentational — the server-side guard in the action method is still mandatory.
