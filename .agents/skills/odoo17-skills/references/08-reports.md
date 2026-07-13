# Reports

Governs: QWeb reports, report inheritance, report performance, printing best practices.

Community edition uses QWeb (HTML/XML templating) rendered to PDF via a headless rendering engine (`wkhtmltopdf`) for printable documents — the same QWeb templating language used for website pages, evaluated server-side against report data instead of client-side against reactive state.

---

## 1. QWeb reports

### Explanation

A printable report is the combination of an `ir.actions.report` record (what model it prints, which template, paper format) and a QWeb `<template>` (the actual layout), typically wrapped in the standard `web.external_layout`/`web.internal_layout` for consistent letterhead-style presentation.

```xml
<record id="action_report_plant_order" model="ir.actions.report">
    <field name="name">Plant Order</field>
    <field name="model">plant.order</field>
    <field name="report_type">qweb-pdf</field>
    <field name="report_name">plant_nursery.report_plant_order_document</field>
    <field name="report_file">plant_nursery.report_plant_order_document</field>
    <field name="print_report_name">'Order - %s' % (object.name)</field>
    <field name="binding_model_id" ref="model_plant_order"/>
    <field name="binding_type">report</field>
</record>

<template id="report_plant_order_document">
    <t t-call="web.html_container">
        <t t-foreach="docs" t-as="o">
            <t t-call="web.external_layout">
                <div class="page">
                    <h2>Order <span t-field="o.name"/></h2>
                    <div class="row">
                        <div class="col-6">
                            <strong>Customer:</strong>
                            <span t-field="o.partner_id"/>
                        </div>
                        <div class="col-6">
                            <strong>Order Date:</strong>
                            <span t-field="o.date_order"/>
                        </div>
                    </div>
                    <table class="table table-sm o_main_table mt-4">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th class="text-end">Qty</th>
                                <th class="text-end">Unit Price</th>
                                <th class="text-end">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr t-foreach="o.line_ids" t-as="line">
                                <td><span t-field="line.product_id"/></td>
                                <td class="text-end"><span t-field="line.qty"/></td>
                                <td class="text-end"><span t-field="line.price_unit"/></td>
                                <td class="text-end"><span t-field="line.subtotal"/></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="row">
                        <div class="col-4 offset-8">
                            <strong>Total:</strong>
                            <span t-field="o.amount_total"/>
                        </div>
                    </div>
                </div>
            </t>
        </t>
    </t>
</template>
```

### Best Practice

- Always wrap the document body in `web.html_container` → `t-foreach="docs" t-as="o"` → `web.external_layout` (or `web.internal_layout` for internal-only documents without full letterhead branding) — this is what gives you consistent multi-record batch printing, page breaks between records, and standard header/footer/company-branding behavior for free.
- Use `t-field="o.some_field"` instead of `t-esc="o.some_field"` for model field values — `t-field` applies the correct type-aware formatting (currency symbols/decimals for `Monetary`, locale-aware date formatting, proper `Many2one` display-name rendering) automatically.
- Set `binding_model_id`/`binding_type="report"` so the report shows up in the model's own Print menu — don't make users hunt for it elsewhere.
- Use `print_report_name` to control the generated PDF's filename — the default is a generic template-name-based file, which is a poor experience for anything users will save/email.
- Keep the template's own logic minimal (loops over already-loaded relations, field display) — non-trivial data preparation belongs in Python (§2), not embedded as complex QWeb expressions.

### Why It Matters

`web.external_layout` isn't just cosmetic boilerplate — it's what makes your report automatically pick up the company's configured logo, address, and footer, and what makes multi-record printing ("select 20 orders → Print") correctly paginate with one document per record instead of requiring you to hand-implement pagination.

### ❌ Wrong

```xml
<template id="report_plant_order_document">
    <!-- No web.html_container / web.external_layout: no company branding,
         no consistent multi-record page-break handling -->
    <div>
        <h2>Order <t t-esc="doc.name"/></h2>   <!-- t-esc instead of t-field: loses currency/date formatting -->
    </div>
</template>
```

### ✅ Correct

Use the structure shown above: `web.html_container` → `t-foreach="docs" t-as="o"` → `web.external_layout` → `t-field` for every model value.

### Performance Considerations

See §3 below — report performance is dominated by how the *data* backing the template is fetched, not by QWeb rendering itself, which is fast. The most common report performance bug is a template that triggers per-record queries inside a loop (accessing a relational field that wasn't prefetched together with the batch of `docs`).

### Odoo 17 Notes

Report infrastructure (`ir.actions.report`, `web.html_container`/`web.external_layout`, `t-field`) is unchanged in 17 relative to 16 — no attrs/states-style breaking change here. `wkhtmltopdf` remains the underlying PDF rendering engine for Community in 17.

---

## 2. Report inheritance

### Explanation

Report templates are QWeb `<template>` records, and like views, they support `inherit_id` + XPath to extend an existing report — the same non-destructive extension principle as `references/05-xml-views.md` §2, applied to printable documents.

```xml
<template id="report_plant_order_document_inherit_acme" inherit_id="plant_nursery.report_plant_order_document">
    <xpath expr="//table[hasclass('o_main_table')]/thead/tr/th[last()]" position="after">
        <th class="text-end">Discount</th>
    </xpath>
    <xpath expr="//table[hasclass('o_main_table')]/tbody/tr/td[last()]" position="after">
        <td class="text-end"><span t-field="line.discount"/></td>
    </xpath>
</template>
```

### Best Practice

- **Never copy-paste a base report template to change one column** — inherit it, exactly as you would a view. A copied report template stops receiving upstream fixes/improvements and is a common upgrade-safety violation (`references/13-upgrade-safe-development.md`).
- Target structural, stable hooks (`hasclass('o_main_table')`, a specific `<div>`'s role) rather than positional indices, for the same brittleness reasons as view XPath (`references/05-xml-views.md` §3).
- If you're adding a genuinely new column to a base report's table, remember to add both the header cell (`<thead>`) **and** the corresponding body cell inside the `t-foreach` row — a common mistake is patching one and forgetting the other, producing a misaligned table.

### Why It Matters

Report templates in core/OCA modules change over time (new legal/compliance fields, layout fixes, translation improvements) — inheriting instead of copying is what lets your customization keep receiving those changes automatically.

### Odoo 17 Notes

No mechanism change; report template inheritance uses the same `<template inherit_id="...">` + `<xpath>` machinery as regular views, and the same guidance about `attrs`/`states` (not applicable to report templates directly, since reports don't have form-view-style conditional attributes in the same way, but any embedded form-view snippets reused inside a report would follow the same rules).

---

## 3. Report performance

### Explanation

A report renders once per print action but iterates `docs` (potentially many records) inside the template — if the template (or the Python method preparing report values) triggers a query per record instead of batch-fetching everything up front, print time scales badly with the number of selected records.

### Best Practice

- Override `_get_report_values()` on the report's model (or the report itself) to **pre-fetch and pre-compute** everything the template needs in one batch pass, rather than letting the template pull data lazily field-by-field per record inside the loop.

```python
class PlantOrder(models.Model):
    _name = 'plant.order'
    _inherit = ['plant.order', 'mail.thread']

    def _get_report_values_for_print(self):
        # one batch prefetch of everything the template will touch
        self.mapped('line_ids.product_id')
        self.mapped('partner_id')
        return {'docs': self}
```

- Avoid calling `search()` or a heavy compute *inside* the QWeb template's `t-foreach` — resolve any needed lookups once, before rendering, in Python.
- For reports commonly printed in large batches (hundreds of invoices at once), specifically test with a realistic batch size, not just a single record — small-N performance can hide big-N problems that only appear at production scale.
- Cache/precompute expensive per-report values (e.g., an aggregate computed via `read_group`) once for the whole batch rather than recomputing per record inside the template.

### Why It Matters

A report that looks fast in development (testing with 1–2 records) can be dramatically slower in production the first time a user selects "all orders this month" and prints 300 of them, if the template's data access pattern is N+1 in disguise. This is the same underlying failure mode as `references/10-performance.md`'s N+1 discussion, specifically manifesting in the reporting/printing context.

### Performance Considerations

`wkhtmltopdf` rendering time itself scales roughly linearly with page count/complexity and is rarely the bottleneck compared to data-fetching — profile the Python side (`_get_report_values`, template data access) before assuming the PDF engine itself needs optimization.

### Odoo 17 Notes

No 17-specific report-performance API change; the batching discipline above applies identically across recent versions.

---

## 4. Printing best practices

### Explanation

Beyond the template/data concerns above, a handful of presentation details separate a professional-looking printed document from an amateur one.

### Best Practice

- Set an appropriate `ir.actions.report.paperformat` (margins, orientation, header/footer spacing) rather than accepting defaults sized for a generic A4 invoice if your document has different needs (a landscape report, a label format, a narrow receipt).
- Respect the configured company report layout (logo, colors, font) via `web.external_layout` (§1) instead of hardcoding a different visual style per report — consistency across a company's printed documents matters to end users far more than developers usually expect.
- Provide both `qweb-pdf` and, where useful, a `qweb-html` preview path (Odoo generates both from the same template) — don't assume every consumer wants a PDF; some integrations want the HTML.
- Internationalize all static template text (`t-esc="_('Total')"`/proper translation-marked strings, not hardcoded English) — printed documents are exactly the kind of artifact that ends up in front of a customer in another locale.
- Test with realistic data lengths (a customer name that wraps, a product list long enough to span multiple pages) — QWeb reports that look fine with short demo data frequently break visually with real-world data.

### Why It Matters

Printed documents (invoices, order confirmations, delivery slips) are often the most customer-facing artifact your module produces — a misaligned table or a missing page break reads as unprofessional in a way that an internal screen's minor UI rough edge usually doesn't, precisely because it leaves the organization's hands and goes to a customer or partner.

### Odoo 17 Notes

`ir.actions.report.paperformat` and the multi-company external layout system are unchanged mechanically in 17 — this remains standing best practice rather than a version-specific change.
