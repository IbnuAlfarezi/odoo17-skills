# Data

Governs: XML data files, CSV data, demo data, `noupdate` records, external IDs.

---

## 1. XML data files

### Explanation

XML `data`/`demo` files load records declaratively via `<record model="...">` (and shorthand elements like `<menuitem>`, `<template>`) — this is how configuration data (sequences, email templates, default categories, cron jobs, security groups) ships with a module.

```xml
<odoo>
    <record id="sequence_plant_order" model="ir.sequence">
        <field name="name">Plant Order</field>
        <field name="code">plant.order</field>
        <field name="prefix">PO/%(year)s/</field>
        <field name="padding">5</field>
    </record>
</odoo>
```

### Best Practice

- One conceptual dataset per file, named per `references/01-module-architecture.md` (`data/<main_model>_data.xml`).
- Give every record a stable, descriptive `id` (external ID) — see §5. Never rely on positional/implicit IDs.
- Load order in the manifest's `data` list matters: sequences/config before the models that reference them, security before views (see `references/01-module-architecture.md` §2).
- Use `eval="..."` sparingly and only for genuinely dynamic values (e.g., relative dates in demo data via `eval="(DateTime.today() + relativedelta(days=3)).strftime('%Y-%m-%d')"`) — prefer plain field values wherever possible for readability.

### Odoo 17 Notes

No XML data-loading mechanism changes in 17.

---

## 2. CSV data

### Explanation

`ir.model.access.csv` (`references/06-security.md` §1) is the most common CSV data file, but CSV can load any model's records when you have a large, uniform, tabular dataset (e.g., a country's postal code list, a product catalog import) — one header row naming fields (using `field:id`/`field/id` suffixes for relational fields by external ID), one row per record.

```csv
id,name,parent_id/id,type
plant_tag_indoor,Indoor,,category
plant_tag_outdoor,Outdoor,,category
plant_tag_succulent,Succulent,plant_tag_indoor,tag
```

### Best Practice

- Use CSV for genuinely tabular, uniform data (flat field values, no nested one2many structures) — reach for XML instead the moment a record needs nested child records, `eval` expressions, or non-trivial structure.
- Reference related records by external ID via the `/id` (or legacy `:id`) column suffix, exactly as XML's `ref=` does — never hardcode a numeric database ID in shipped data (see §5).
- Keep the header row's field list minimal and explicit — don't include columns for fields that should simply take their model-level default.

### Why It Matters

CSV is compact and fast to load for large, uniform datasets, but that same flatness makes it the wrong tool the moment your data has real structure — forcing structured data into CSV (e.g., encoding a one2many relationship as a delimited string in a single cell, then parsing it in a post-init hook) is more fragile and harder to review than the equivalent XML would have been.

### Odoo 17 Notes

No CSV-loading mechanism changes in 17.

---

## 3. Demo data

### Explanation

Files listed under the manifest's `demo` key (as opposed to `data`) load **only** when a database is created with demo data enabled — used for realistic-looking sample records that let evaluators/testers see the module "populated" without shipping to production installs.

```python
'demo': [
    'data/plant_nursery_demo.xml',
],
```

### Best Practice

- Never put anything business-critical (a required sequence, a default category the module's own logic depends on existing) in `demo` — production installs (demo data disabled) will be missing it, and code that assumes it exists will break in exactly the installs that matter most.
- Make demo data realistic and varied enough to actually exercise the module's features (different states, a range of dates, a few edge-case-adjacent records) — sparse, uniform demo data hides bugs that realistic data would surface.
- Keep demo data in its own file(s), separate from functional `data/` — the distinction between "the module needs this to function" and "this is just sample content" should be structurally obvious from the file layout, not just from which manifest list it's mentioned in.

### Why It Matters

The `data` vs. `demo` split exists specifically so that production databases (which almost always disable demo data) get exactly the configuration the module needs to function and nothing else — misplacing functional configuration into `demo` is a subtle bug class that only manifests in production-like installs, which developers frequently don't test against locally (most local dev databases have demo data enabled by default).

### Odoo 17 Notes

No mechanism change in 17.

---

## 4. `noupdate`

### Explanation

`noupdate="1"` on a `<data>` block (or the `<odoo noupdate="1">` root, or per-record) tells Odoo: **load this record on install, but never touch it again on module update** — the record becomes "owned" by whatever the database currently holds (including any manual edits an admin made), not by the shipped XML.

```xml
<odoo noupdate="1">
    <record id="mail_template_order_confirmation" model="mail.template">
        <field name="name">Order Confirmation</field>
        <field name="subject">Your order {{ object.name }} is confirmed</field>
        <field name="body_html" type="html">...</field>
    </record>
</odoo>
```

### Best Practice

- Use `noupdate="1"` for anything an admin is expected/allowed to customize after install without a future module update silently overwriting their changes — email templates, default sequences' starting numbers, cron job scheduling (interval, active state), and (always) demo data.
- Leave records **without** `noupdate` (the default, updatable) for anything that should track the module's own evolution — most views, most security definitions, most core configuration that isn't meant to be admin-tunable.
- Mixing both in one file is fine and common: wrap only the specific records that should freeze after install in their own `<data noupdate="1">` block, leaving the rest of the file normally updatable.
- Remember `noupdate="1"` records are still created on **install** — the "no update" behavior only kicks in on subsequent module *updates*, not on the initial load.

### Why It Matters

Getting this wrong in either direction causes real, user-visible problems: forgetting `noupdate` on something admins customize (an email template) means every module update silently reverts their customization; wrongly adding `noupdate` to something that should track upstream changes (a view fix, a security correction) means a bug you fixed in the module will never actually reach existing installs, because the "fixed" record is frozen at whatever the database first loaded.

### ❌ Wrong

```xml
<!-- Email template WITHOUT noupdate: any admin customization to the subject/body
     is silently wiped out the next time this module is updated -->
<record id="mail_template_order_confirmation" model="mail.template">
    <field name="subject">Your order {{ object.name }} is confirmed</field>
</record>
```

```xml
<!-- A security-critical record rule WITH noupdate: a future fix to this rule's
     domain_force will never reach databases that already installed this module -->
<data noupdate="1">
    <record id="plant_order_rule_own_orders" model="ir.rule">
        <field name="domain_force">[('user_id', '=', user.id)]</field>
    </record>
</data>
```

### ✅ Correct

```xml
<!-- Email template: noupdate, so admin customization survives future updates -->
<data noupdate="1">
    <record id="mail_template_order_confirmation" model="mail.template">
        <field name="subject">Your order {{ object.name }} is confirmed</field>
    </record>
</data>
```

```xml
<!-- Security rule: normally updatable, so fixes propagate to existing installs -->
<record id="plant_order_rule_own_orders" model="ir.rule">
    <field name="domain_force">[('user_id', '=', user.id)]</field>
</record>
```

### Security Considerations

Security-relevant data (record rules, access rights, groups) should almost always be **updatable** (no `noupdate`), specifically so that a security fix you ship in a later module version actually reaches every existing install automatically on upgrade — this is a case where "frozen at install time" is actively dangerous.

### Odoo 17 Notes

No mechanism change in 17; the `data`/`demo` manifest keys automatically imply `noupdate="1"` for **demo** data specifically — you don't need to additionally wrap demo XML in an explicit `noupdate` block for that reason alone, though being explicit doesn't hurt readability.

---

## 5. External IDs

### Explanation

Every record loaded from a data file gets an **external ID** (`module.identifier`, e.g. `plant_nursery.plant_order_view_form`) — the stable, portable reference used by `ref=`/`ir.model.data` lookups, XPath inheritance targeting (indirectly, via the view it identifies), and cross-module references, as opposed to the database's internal numeric `id`, which varies per-database and is never safe to hardcode.

### Best Practice

- Reference other records exclusively via external ID (`ref="module.xml_id"` in XML, `self.env.ref('module.xml_id')` in Python) — **never** hardcode a numeric database ID anywhere in shipped code or data.
- Choose external IDs deliberately and treat them as a stable public interface the moment they ship (see `references/13-upgrade-safe-development.md` for the full upgrade-safety treatment of this) — follow the naming conventions in `references/01-module-architecture.md` §4 so IDs are predictable to other developers who need to reference or inherit from your records.
- Prefix custom/OCA module external IDs are automatically namespaced by the module they're declared in (`plant_nursery.plant_order_view_form`) — you don't need to manually prefix the `id=` attribute with the module name inside that module's own files, only when *referencing* it from another module.
- `self.env.ref('module.xml_id')` raises by default if the ID doesn't exist — use `self.env.ref('module.xml_id', raise_if_not_found=False)` deliberately when the reference is genuinely optional (e.g., a soft dependency on another module's data that may or may not be installed), and handle the `None` case explicitly.

### Why It Matters

External IDs are what make Odoo's data portable across databases and safely mergeable/upgradable across module versions — two different installations of the same module produce different internal numeric IDs for "the same" record, but the same external ID. Any code or data that hardcodes a numeric ID will work by coincidence in the database it was written against and break unpredictably everywhere else.

### ❌ Wrong

```python
# Hardcoded numeric ID — happens to be 42 in the developer's local database,
# will reference an unrelated (or nonexistent) record everywhere else
group = self.env['res.groups'].browse(42)
```

```xml
<field name="group_id" eval="17"/>   <!-- same problem, in data-file form -->
```

### ✅ Correct

```python
group = self.env.ref('plant_nursery.group_nursery_manager')
```

```xml
<field name="groups" eval="[(4, ref('plant_nursery.group_nursery_manager'))]"/>
```

### Odoo 17 Notes

No mechanism change in 17. See `references/13-upgrade-safe-development.md` for why external IDs, once shipped, should be treated as effectively permanent — renaming one is a breaking change for every database that already has it in its `ir.model.data` table.
