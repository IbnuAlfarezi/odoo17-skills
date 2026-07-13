# XML Development — Views, Inheritance & UI Structure

Governs: views, view inheritance, XPath best practices, menus, actions, search views, form views, tree views, kanban views, notebook organization, smart buttons, widgets, decorations.

---

## 1. Views — general principles

### Explanation

A view record (`ir.ui.view`) declares `arch` (the XML architecture) for a given `model` and view type (`form`, `tree`, `kanban`, `search`, `graph`, `pivot`, `calendar`, `activity`). Views are pure presentation: what to show and how, never business rules (see `references/01-module-architecture.md` §6).

### Best Practice

- One view record per file section, named per the convention in `references/01-module-architecture.md`: `<model>_view_<type>` XML ID, in `views/<main_model>_views.xml`.
- Never define a *new* base view for a model that already has one from the module you're building on — inherit it (§2).
- Keep field order in the arch meaningful to the end user's workflow, not the order fields happen to be declared in Python.

### Why It Matters

Views are the highest-churn XML in most modules (every UI tweak touches one), so predictable naming and one-file-per-model-per-purpose is what keeps merge conflicts and review diffs small.

### Odoo 17 Notes

The single most disruptive Odoo 17 view change is the removal of the `attrs`/`states` XML attributes — covered in full in §3 below, since it affects nearly every view you'll touch.

---

## 2. View inheritance

### Explanation

Instead of redefining a whole view, an inheriting view record sets `inherit_id` to the base view's external ID and provides an `arch` containing one or more `<xpath>` (or shorthand `<field name="x" position="...">`) elements that locate a node in the parent's compiled arch and modify it.

```xml
<record id="plant_order_view_form_inherit_acme" model="ir.ui.view">
    <field name="name">plant.order.form.inherit.acme</field>
    <field name="model">plant.order</field>
    <field name="inherit_id" ref="plant_nursery.plant_order_view_form"/>
    <field name="arch" type="xml">
        <xpath expr="//field[@name='partner_id']" position="after">
            <field name="delivery_window_id"/>
        </xpath>
    </field>
</record>
```

### Best Practice

- **Never copy a base view and redefine it from scratch** to make a small change — that duplicate silently stops receiving any future upstream changes to the original (new fields, fixed bugs, security-relevant attribute changes) and is the single most common upgrade-breaking mistake in customization work. Always inherit.
- Use the shorthand `<field name="x" position="after|before|replace|inside">` form when targeting a specific, uniquely-named field — it's more concise than full `<xpath>` and equally robust as long as the field name is unique in the parent view.
- Use full `<xpath expr="...">` when you need to target something without a unique `name` attribute (a `<group>`, a `<notebook>`, a specific `<button>` by its `name` action, a `<div>` by class).
- Give every inheriting view record a descriptive `name` field (shown in Settings → Technical → Views) — `<model>.<view_type>.inherit.<module_or_feature>` is a good pattern.
- Chain inheritance depth is fine (module C can inherit module B's view which inherits module A's base view) — Odoo resolves the whole chain at render time.

### Why It Matters

View inheritance is what makes Odoo's whole customization ecosystem non-destructive: dozens of modules can each add a field to `res.partner`'s form without conflicting, because each is a small, independent diff against the same parent, not a competing full redefinition. It's also what keeps your customization forward-compatible — when the base module updates its view, your XPath still applies (as long as the node you targeted still exists) and you inherit the base module's improvements automatically.

### ❌ Wrong

```xml
<!-- Copy-pasting sale's entire order form and modifying it -->
<record id="plant_order_view_form" model="ir.ui.view">
    <field name="name">plant.order.form</field>
    <field name="model">plant.order</field>
    <!-- no inherit_id — this is a full redefinition living in the WRONG module,
         and it will silently diverge from plant_nursery's own updates -->
    <field name="arch" type="xml">
        <form>
            <!-- ...entire form copy-pasted and tweaked... -->
        </form>
    </field>
</record>
```

### ✅ Correct

```xml
<record id="plant_order_view_form_inherit_acme_delivery" model="ir.ui.view">
    <field name="name">plant.order.form.inherit.acme.delivery</field>
    <field name="model">plant.order</field>
    <field name="inherit_id" ref="plant_nursery.plant_order_view_form"/>
    <field name="arch" type="xml">
        <field name="partner_id" position="after">
            <field name="delivery_window_id"/>
        </field>
    </field>
</record>
```

### Performance Considerations

Every inheriting view adds a small amount of arch-resolution cost the first time a view is rendered after a cache invalidation (views are cached after resolution) — this is negligible in practice even with dozens of inheriting layers; don't avoid inheritance for performance reasons.

### Odoo 17 Notes

See `references/13-upgrade-safe-development.md` for the full "extension instead of modification" discipline — view inheritance is the concrete mechanism that principle relies on.

---

## 3. XPath best practices — and the Odoo 17 `attrs`/`states` removal

### Explanation

**This is the single most important Odoo-17-specific fact in this handbook.** Odoo 17 removed the `attrs` and `states` XML attributes entirely. Any `<field>`, `<button>`, `<page>`, or other view element that conditionally shows/hides, becomes readonly, or becomes required now expresses that directly as a **Python-expression string** on the relevant attribute — no more domain-tuple dictionaries.

| Modifier | Odoo 16 and earlier | Odoo 17 |
|---|---|---|
| Conditionally invisible | `attrs="{'invisible': [('state','=','draft')]}"` | `invisible="state == 'draft'"` |
| Conditionally readonly | `attrs="{'readonly': [('state','!=','draft')]}"` | `readonly="state != 'draft'"` |
| Conditionally required | `attrs="{'required': [('type','=','service')]}"` | `required="type == 'service'"` |
| Multiple combined conditions | `attrs="{'invisible': ['|', ('state','=','draft'), ('type','=','internal')]}"` | `invisible="state == 'draft' or type == 'internal'"` |
| Field/page visible only in given states | `states="draft,sent"` | `invisible="state not in ('draft', 'sent')"` |
| Hide a whole **list/tree column** | `attrs="{'invisible': [...]}"` also hid the column | `invisible` on a list-view field now hides only the **cell contents**; use `column_invisible="..."` to hide the whole column |

```xml
<!-- Odoo 17 correct form-view usage -->
<field name="partner_id"
       invisible="state == 'draft'"
       readonly="state not in ('draft', 'sent')"
       required="state == 'confirmed'"/>

<button name="action_confirm" type="object" string="Confirm"
        invisible="state != 'draft'"/>

<page string="Delivery" invisible="delivery_type == 'none'"/>
```

```xml
<!-- Odoo 17 correct list-view usage: column_invisible, not invisible, to hide the column -->
<tree>
    <field name="name"/>
    <field name="internal_note" column_invisible="not context.get('show_internal_notes')"/>
</tree>
```

### Best Practice

- Write conditions as plain boolean-ish Python expressions referencing sibling field names directly (`state == 'draft'`, `not line_ids`, `qty > 0 and state == 'draft'`) — no tuples, no `'&'`/`'|'` prefix operators; use `and`/`or`/`not` like normal Python.
- In a **list/tree view**, always ask "do I want to hide the cell, or the whole column?" — `invisible` and `column_invisible` are not interchangeable in that context, and picking the wrong one is a very easy, very common Odoo 17 mistake (using `invisible` when `column_invisible` was intended leaves an empty column visible instead of removing it).
- When inheriting an existing field to add a condition, set the attribute directly rather than via `<attribute name="attrs">` (which no longer exists as a mechanism):

```xml
<field name="field_a" position="attributes">
    <attribute name="invisible">field_b or field_c == 3</attribute>
</field>
```

- If you're porting/adapting code you found from a v16 tutorial (or generated from an LLM trained mostly on older examples), assume `attrs=`/`states=` are wrong for Odoo 17 and translate them using the table above before using them.

### Why It Matters

This isn't a cosmetic syntax change — `attrs`/`states` XML simply **fails to load** in Odoo 17 (`ParseError: Since 17.0, the "attrs" and "states" attributes are no longer used.`). Any view (your own, or a third-party/OCA module not yet ported) using the old syntax breaks module installation outright, not just at runtime. This is the #1 cause of "my module worked in the tutorial but won't install" reports for anyone learning on mixed-version material.

### ❌ Wrong (fails to load in Odoo 17)

```xml
<field name="partner_id"
       attrs="{'invisible': [('state', '=', 'draft')], 'required': [('state', '=', 'confirmed')]}"/>
<button name="action_confirm" type="object" string="Confirm" states="draft"/>
```

### ✅ Correct (Odoo 17)

```xml
<field name="partner_id"
       invisible="state == 'draft'"
       required="state == 'confirmed'"/>
<button name="action_confirm" type="object" string="Confirm" invisible="state != 'draft'"/>
```

### XPath targeting best practices (independent of the attrs/states change)

- **Target by stable identity, not position.** `//field[@name='partner_id']` survives the base view being reordered; `//field[4]` breaks the moment anyone reorders fields upstream.
- **Prefer the shorthand field-position form** (`<field name="x" position="after">`) over `<xpath>` when targeting a uniquely-named field — same robustness, less ceremony.
- **Scope XPath as tightly as the base view's structure allows** — `//group[@name='sale_info']//field[@name='partner_id']` is more resilient than a bare `//field[@name='partner_id']` if the base view could plausibly gain a *second* field with a similar name in an unrelated group (rare for `name`, more relevant when targeting by `string=` text, which you should avoid entirely — labels get translated and edited far more often than field names).
- **Never target by translated text (`@string='Confirm'`)** — a locale change or a future rename of the button label silently breaks your XPath. Target by `name` (field name) or the action method's `name` attribute on buttons.
- **Use `position="replace"` sparingly** — it's the one form of inheritance that behaves like a rewrite of that node, so it inherits none of the base module's future changes to that specific node. Prefer `before`/`after`/`inside`/`attributes` wherever the intent is additive.

### ❌ Wrong

```xml
<xpath expr="//page[3]" position="after">          <!-- brittle: breaks if a page is added/removed upstream -->
    <page string="Custom"/>
</xpath>
<xpath expr="//button[@string='Confirm']" position="attributes">   <!-- brittle: breaks on relabel/translation -->
    <attribute name="invisible">1</attribute>
</xpath>
```

### ✅ Correct

```xml
<xpath expr="//page[@name='delivery_info']" position="after">
    <page name="custom_info" string="Custom Info">
        ...
    </page>
</xpath>
<xpath expr="//button[@name='action_confirm']" position="attributes">
    <attribute name="invisible">state != 'draft'</attribute>
</xpath>
```

### Performance Considerations

`invisible`/`readonly`/`required` expressions are evaluated **client-side in JavaScript** in Odoo 17 (no server round-trip per field per keystroke) — this is actually a performance improvement over the old `attrs` mechanism, which required more post-processing. Keep expressions simple booleans over already-loaded fields; don't reference a field that isn't otherwise present on the view just to use it in a condition — add it with `column_invisible="1"` (list) or `invisible="1"` plus no visible placement (form, rare) so it's fetched but not rendered, or better, confirm it's already loaded via a related computed field.

### Odoo 17 Notes

Summarized above — this section *is* the Odoo 17 XML view story. If your team is migrating from 16, budget real time for this: it is described industry-wide as the most disruptive single change in the 16→17 jump, precisely because it touches nearly every view file in a nontrivial codebase.

---

## 4. Menus

### Explanation

`<menuitem>` records form a tree (`parent=`) and each leaf typically points at an `action=`.

```xml
<menuitem id="plant_nursery_menu_root" name="Plant Nursery" sequence="10" web_icon="plant_nursery,static/description/icon.png"/>
<menuitem id="plant_nursery_menu_orders" name="Orders" parent="plant_nursery_menu_root" sequence="10"/>
<menuitem id="plant_order_menu_action" name="Plant Orders" parent="plant_nursery_menu_orders" action="plant_order_action" sequence="10"/>
```

### Best Practice

- Set `sequence=` deliberately on every menu level — the default ordering (registration order) is not something you want to depend on implicitly.
- Restrict menu visibility with `groups=` on the `<menuitem>` itself for role-based navigation — this is a UX/discoverability control, **not** a security boundary (see `references/06-security.md`; hiding a menu doesn't revoke access to the underlying action/model).
- Keep the menu tree shallow (2–3 levels) — deeply nested menus hurt discoverability more than they help organization.
- Name menus for what the *user* is looking for, not the internal model name.

### Security Considerations

`groups=` on a menu only hides it from users outside those groups — it does not stop a user from reaching the underlying action/model another way (a direct URL, a smart button, a related record's form) if the model's `ir.model.access.csv`/record rules don't independently enforce the restriction. Always pair menu-level `groups=` with real access control at the model layer.

### Odoo 17 Notes

No structural changes to `<menuitem>` in 17.

---

## 5. Actions

### Explanation

`ir.actions.act_window` (open a model in some view mode), `ir.actions.server` (run logic — see `references/04-business-logic.md` §4), `ir.actions.report` (print — see `references/08-reports.md`), and `ir.actions.client` (open a JS client action — see `references/07-owl-javascript.md`) are the action types you'll define most often.

```xml
<record id="plant_order_action" model="ir.actions.act_window">
    <field name="name">Plant Orders</field>
    <field name="res_model">plant.order</field>
    <field name="view_mode">tree,form,kanban</field>
    <field name="context">{'search_default_my_orders': 1}</field>
    <field name="help" type="html">
        <p class="o_view_nocontent_smiling_face">
            Create your first plant order
        </p>
    </field>
</record>
```

### Best Practice

- List `view_mode` in the order you want the view-switcher tabs to appear, and only include modes the model actually has views for.
- Always provide a `help` block with `o_view_nocontent_smiling_face` (or `_empty_folder`) for any user-facing action — an empty list with no guidance is a poor first-run experience.
- Use `context` on the action to set sensible default filters (`search_default_<filter_name>: 1`) rather than forcing users to manually filter every time they open the menu.
- Prefer scoping actions with `domain=` when the menu is meant to show a *subset* (e.g., "My Orders" as a separate menu item reusing the same model) instead of duplicating the model's views.

### Odoo 17 Notes

No structural action-record changes in 17; `view_mode` still lists `tree` (not `list`) as the mode name — matching the arch root tag, which also remains `<tree>` in 17 (see §7).

---

## 6. Search views

### Explanation

The `<search>` arch defines what a `search_view_id` offers: `<field>` for free-text/typed search, `<filter>` for one-click domain toggles, and `<searchpanel>`/`groupBy` for the sidebar/group-by menu.

```xml
<record id="plant_order_view_search" model="ir.ui.view">
    <field name="name">plant.order.search</field>
    <field name="model">plant.order</field>
    <field name="arch" type="xml">
        <search>
            <field name="name"/>
            <field name="partner_id"/>
            <filter name="my_orders" string="My Orders" domain="[('user_id', '=', uid)]"/>
            <filter name="draft" string="Draft" domain="[('state', '=', 'draft')]"/>
            <separator/>
            <filter name="confirmed" string="Confirmed" domain="[('state', '=', 'confirmed')]"/>
            <group expand="0" string="Group By">
                <filter name="group_by_partner" string="Customer" context="{'group_by': 'partner_id'}"/>
                <filter name="group_by_state" string="Status" context="{'group_by': 'state'}"/>
            </group>
        </search>
    </field>
</record>
```

### Best Practice

- Give every `<filter>` a `name=` — undecorated filters can't be targeted by inheriting views or referenced via `context="{'search_default_x': 1}"`.
- Group related toggle filters with `<separator/>` between logically distinct groups (status filters vs. ownership filters vs. date filters).
- Put `groupBy` options inside a collapsed (`expand="0"`) `<group string="Group By">` block, matching core Odoo's own convention, so search views feel consistent across the whole application.
- Only expose fields as searchable that make sense for the model's actual usage patterns — a `<search>` view cluttered with every field is worse than a focused one with the 5–8 that matter.

### Odoo 17 Notes

No structural search-view changes in 17.

---

## 7. Form views

### Explanation

```xml
<record id="plant_order_view_form" model="ir.ui.view">
    <field name="name">plant.order.form</field>
    <field name="model">plant.order</field>
    <field name="arch" type="xml">
        <form string="Plant Order">
            <header>
                <button name="action_confirm" string="Confirm" type="object"
                        class="oe_highlight" invisible="state != 'draft'"/>
                <field name="state" widget="statusbar" statusbar_visible="draft,confirmed,done"/>
            </header>
            <sheet>
                <div class="oe_button_box" name="button_box">
                    <button name="action_view_invoices" type="object" class="oe_stat_button" icon="fa-pencil-square-o">
                        <field name="invoice_count" widget="statinfo" string="Invoices"/>
                    </button>
                </div>
                <div class="oe_title">
                    <h1><field name="name" readonly="1"/></h1>
                </div>
                <group>
                    <group>
                        <field name="partner_id"/>
                        <field name="date_order"/>
                    </group>
                    <group>
                        <field name="amount_total"/>
                        <field name="currency_id" groups="base.group_multi_currency"/>
                    </group>
                </group>
                <notebook>
                    <page string="Order Lines" name="order_lines">
                        <field name="line_ids">
                            <tree editable="bottom">
                                <field name="product_id"/>
                                <field name="qty"/>
                                <field name="price_unit"/>
                                <field name="subtotal" sum="Total"/>
                            </tree>
                        </field>
                    </page>
                    <page string="Notes" name="notes">
                        <field name="note_html"/>
                    </page>
                </notebook>
            </sheet>
            <chatter/>
        </form>
    </field>
</record>
```

### Best Practice

- `<header>` holds workflow buttons and the status bar — never business data fields.
- `<sheet>` holds the record's own data; smart buttons go in `<div class="oe_button_box">` at the top of the sheet, before the title.
- Always use `groups=` on fields/sections that are only relevant to specific roles (e.g., `groups="base.group_multi_currency"` on a currency field) rather than showing every field to every user regardless of relevance — this is a UX practice, not a substitute for real security.
- Odoo 17's simplified chatter: use the self-closing `<chatter/>` element at the end of the form instead of manually assembling `<div class="oe_chatter">` with `<field name="message_follower_ids"/>`/`<field name="activity_ids"/>`/`<field name="message_ids"/>` — it's shorter and matches current core modules (requires the model to inherit `mail.thread`; see `references/03-python-orm-advanced.md` §10).
- Name every `<page>` (`name=`) and every `<group>` you expect inheriting modules to target, per the XPath guidance in §3.

### Why It Matters

The `<header>`/`<sheet>`/notebook structure is a shared visual language across the entire Odoo UI — deviating from it (e.g., putting a workflow button inside the sheet body) makes your module feel foreign to users who are used to every other screen following the convention, and makes it harder for other developers to extend predictably.

### Odoo 17 Notes

The `<chatter/>` shorthand is the current, preferred way to add chatter to a form view in recent Odoo versions including 17 — prefer it in new modules over manually wiring the three chatter-related fields.

---

## 8. Tree views

### Explanation

Odoo 17 still uses `<tree>` as the list-view root tag (the rename to `<list>` is an **Odoo 18+** change — do not "correct" it to `<list>` in 17 code, that will break).

```xml
<tree string="Plant Orders" decoration-danger="state == 'cancel'" decoration-muted="state == 'done'" decoration-bf="priority == 'high'">
    <field name="name"/>
    <field name="partner_id"/>
    <field name="date_order"/>
    <field name="amount_total" sum="Total"/>
    <field name="state" widget="badge" decoration-success="state == 'done'" decoration-info="state == 'confirmed'"/>
    <field name="priority" column_invisible="1"/>
</tree>
```

### Best Practice

- Use `decoration-*` attributes (`decoration-danger`, `decoration-success`, `decoration-warning`, `decoration-info`, `decoration-muted`, `decoration-bf`, `decoration-it`) for row-level visual cues instead of a `widget`-only approach — they're the idiomatic way to make a list scannable at a glance (overdue rows in red, done rows muted, etc.).
- Set `sum=`/`avg=` on numeric columns you want aggregated in the list footer.
- Use `editable="bottom"` (or `"top"`) only for genuinely simple, fast-entry line models (order lines, timesheet lines) — not for a model with complex validation better handled in a full form.
- Remember `column_invisible`, not `invisible`, to actually remove a column (see §3) — a field you need available for a decoration/domain expression but don't want displayed should use `column_invisible="1"`, keeping it in the model's fetched fields without rendering a column.

### Performance Considerations

Every column in a tree/list view is a field fetched for every visible row (batch-fetched per page, per the prefetching discussion in `references/03-python-orm-advanced.md`) — don't add columns "just in case"; each one is real, if usually small, per-request cost multiplied by the page size.

### Odoo 17 Notes

- Root tag is `<tree>`, not `<list>` — confirmed above, worth restating because so much current tutorial content already targets 18+.
- `column_invisible` vs `invisible` is the sharpest new footgun in list views specifically (§3) — the two now mean genuinely different things in Odoo 17, where before 17 a field's `invisible` always meant "hide the column."

---

## 9. Kanban views

### Explanation

Kanban views in Odoo 17 are OWL 2 templates (QWeb syntax with `t-` directives), typically grouped by a `Selection` or `Many2one` field (commonly `state` or `stage_id`).

```xml
<kanban default_group_by="state" class="o_kanban_small_column">
    <field name="name"/>
    <field name="partner_id"/>
    <field name="amount_total"/>
    <field name="priority"/>
    <templates>
        <t t-name="card">
            <div class="oe_kanban_card oe_kanban_global_click">
                <div class="o_kanban_record_top">
                    <strong><field name="name"/></strong>
                    <field name="priority" widget="priority"/>
                </div>
                <div class="o_kanban_record_body">
                    <field name="partner_id"/>
                </div>
                <div class="o_kanban_record_bottom">
                    <span class="o_kanban_record_subtitle">
                        <field name="amount_total" widget="monetary"/>
                    </span>
                </div>
            </div>
        </t>
    </templates>
</kanban>
```

### Best Practice

- Declare every field the card template reads with a top-level `<field name="..."/>` — kanban cards don't auto-fetch fields only referenced inside the template the way a form view implicitly does.
- Use `oe_kanban_global_click` on the card root so the whole card is clickable, not just a title link — matches user expectations set by every core kanban view.
- Reach for the `priority` widget (stars), `kanban_state_selection` (block/red-yellow-green dots), and `progressbar` widgets for the same visual language core apps use — don't hand-build these from scratch in the template.

### Odoo 17 Notes

Confirm your kanban template uses `<t t-name="card">` (the current, simplified template name) — some older documentation and community modules use `<t t-name="kanban-box">`, which is the legacy pre-simplification convention. Both may be encountered in the wild depending on how recently a given core/OCA module was touched, but `card` is the current standard entry-point name for new Odoo 17 kanban card templates.

---

## 10. Notebook organization

### Explanation

`<notebook>`/`<page>` groups a form's secondary information into tabs, keeping the primary sheet focused on the handful of fields that matter for every record, every time.

### Best Practice

- Keep the top-level sheet (outside the notebook) to the fields a user needs on *every* visit to the record — identity, status, the 4–6 most important values.
- Push anything conditional, secondary, or role-specific into a named page.
- Order pages by frequency of use, not alphabetically or by implementation order — the most-visited tab (often "Order Lines"/"Lines"/the model's core content) should be first.
- Name every page (`name=`) for inheritance targeting (§3), and keep `string=` short — it's a tab label, not a sentence.

### Why It Matters

A notebook that's just "everywhere we didn't know where else to put a field" defeats its own purpose — the value of tabs is *reducing* what the user has to process at a glance; an unstructured notebook with 15 tabs is worse than a flat form with good grouping.

### Odoo 17 Notes

No structural change; the discipline above is evergreen UX guidance independent of version.

---

## 11. Smart buttons

### Explanation

A "smart button" is the `oe_stat_button` pattern in the button box — a compact, clickable KPI (e.g., "3 Invoices") that both surfaces a count and navigates to the related records.

```xml
<div class="oe_button_box" name="button_box">
    <button name="action_view_invoices" type="object" class="oe_stat_button" icon="fa-pencil-square-o"
            invisible="invoice_count == 0">
        <field name="invoice_count" widget="statinfo" string="Invoices"/>
    </button>
</div>
```

```python
invoice_count = fields.Integer(compute='_compute_invoice_count')

@api.depends('invoice_ids')
def _compute_invoice_count(self):
    for order in self:
        order.invoice_count = len(order.invoice_ids)

def action_view_invoices(self):
    self.ensure_one()
    return {
        'type': 'ir.actions.act_window',
        'res_model': 'account.move',
        'view_mode': 'tree,form',
        'domain': [('id', 'in', self.invoice_ids.ids)],
        'context': {'default_partner_id': self.partner_id.id},
    }
```

### Best Practice

- Back every smart button with a small `compute=`d integer field (`store=True` if the underlying relation is large/frequently listed — see `references/02-python-models-fields.md` §5) — never a hardcoded count.
- The button's `name=` action method should `ensure_one()` and return a proper `ir.actions.act_window` dict — a smart button that silently does nothing on click is a common, easy-to-miss bug.
- Consider `invisible="x_count == 0"` for smart buttons that are only meaningful once related records exist, to avoid button-box clutter on brand-new records — this is a judgment call weighed against the value of the button also indicating "you could create one of these" for a still-empty count.

### Odoo 17 Notes

No structural change; this remains the standard pattern.

---

## 12. Widgets

### Explanation

`widget=` on a `<field>` selects an alternate rendering/editing component instead of the type's default (e.g., `many2one_tags` for a compact tag-style `Many2one`/`Many2many`, `monetary` for currency-aware number formatting, `priority` for a star-rating `Selection`, `statusbar` for a workflow `Selection`, `badge` for a colored pill).

### Best Practice

- Use `many2many_tags` for `Many2many` fields displayed inline (categories, tags) rather than the default (heavier) list-style widget.
- Use `monetary` (with a resolvable `currency_field=`) for any amount field, not a plain `float`/`integer` widget — it's what gives correct currency symbol/decimal formatting.
- Use `badge`/`statusbar` for `Selection` fields representing workflow state — plain dropdown rendering for a `state` field reads as unpolished compared to the rest of the application.
- Check for an existing core widget before writing a custom OWL field widget (`references/07-owl-javascript.md` §6) — the standard library covers the overwhelming majority of real needs (`boolean_toggle`, `percentage`, `image`, `binary`, `url`, `email`, `phone`, `daterange`, `color_picker`, and more).

### Odoo 17 Notes

Widgets are implemented as OWL 2 field components in 17 (see `references/07-owl-javascript.md`); the `widget=` XML attribute usage itself is unchanged from prior versions.

---

## 13. Decorations

### Explanation

Covered in context in §8 (tree views) — `decoration-*` attributes apply a Bootstrap-derived visual treatment to a row (or, in some widget/kanban contexts, an element) based on a Python-expression condition evaluated per record, using the same expression syntax as `invisible`/`readonly`/`required` (§3).

### Best Practice

| Decoration | Typical use |
|---|---|
| `decoration-danger` | Overdue, cancelled, or error states |
| `decoration-warning` | Needs attention, pending approval |
| `decoration-success` | Completed, confirmed, paid |
| `decoration-info` | Informational, in-progress |
| `decoration-muted` | Archived, cancelled, low-priority |
| `decoration-bf` / `decoration-it` | Bold / italic emphasis (e.g., unread, high priority) |

Combine decorations meaningfully rather than applying every color to every list — reserve red (`danger`) for things that genuinely need attention.

### Why It Matters

Decorations are what make a dense list scannable without reading every cell — a well-decorated order list lets a nursery manager spot cancelled/overdue orders at a glance. Overusing them (every row a different color) defeats that purpose just as much as using none.

### Odoo 17 Notes

Decoration expressions follow the same direct-Python-expression syntax as the rest of Odoo 17's conditional attributes (§3) — no change in mechanism, just consistent with the broader `attrs` removal.
