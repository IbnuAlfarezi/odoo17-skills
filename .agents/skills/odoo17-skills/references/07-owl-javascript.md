# OWL / JavaScript (Odoo 17 — OWL 2)

Governs: component structure, registries, services, hooks, patching, client actions, field widgets, view customization, asset bundles.

Odoo 17 is where the web client's frontend framework, **OWL (Odoo Web Library), moved to version 2.x** — a genuine breaking change from OWL 1.x's class-based, `willStart`/constructor-heavy style used in Odoo ≤16. Code copied from an Odoo 16 tutorial or generated from older training data will very likely use OWL 1 idioms that don't work in 17. This file uses OWL 2 syntax throughout.

---

## 1. Component structure

### Explanation

An OWL 2 component is an ES6 class extending `Component` from `@odoo/owl`, with a static `template` (a QWeb template name, usually defined in a companion `.xml` file) and, ideally, static `props` for validation. All setup logic — state, hooks, lifecycle — happens in a `setup()` method, not the constructor.

```javascript
/** @odoo-module **/

import { Component, useState } from "@odoo/owl";

export class OrderPriorityBadge extends Component {
    static template = "plant_nursery.OrderPriorityBadge";
    static props = {
        priority: { type: String },
        onToggle: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({ expanded: false });
    }

    onClick() {
        this.state.expanded = !this.state.expanded;
        this.props.onToggle?.();
    }
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">
    <t t-name="plant_nursery.OrderPriorityBadge">
        <span t-attf-class="badge badge-{{ props.priority }}" t-on-click="onClick">
            <t t-esc="props.priority"/>
        </span>
    </t>
</templates>
```

### Best Practice

- One component = one `.js` (or `.js` + `.xml`, optionally `.scss`) file group, named after the component, under `static/src/<feature>/`.
- Always declare `static props` — even a loose `{ type: Object, optional: true }` — so prop-shape mistakes fail fast in dev mode instead of surfacing as a confusing runtime `undefined` deep in a template.
- Do initialization (state, service lookups, subscriptions) in `setup()`, not the constructor — `setup()` runs with the component's reactive/hook context properly established; a raw constructor does not give you that.
- Keep templates in a separate `.xml` file (not an inline `xml` template string) for anything beyond a trivial component — separate files get proper editor tooling, are easier to diff, and are the convention used throughout Odoo's own codebase.
- Register the template `.xml` file in the manifest's `assets` (§9) so it's actually loaded — a component whose template file exists but isn't in the asset bundle fails with a "template not found" error that's easy to misdiagnose as a JS bug.

### Why It Matters

`setup()` exists specifically because OWL 2's hooks (`useState`, `useService`, `onWillStart`, etc. — §4) rely on being called within a specific "current component" context that OWL tracks during `setup()`. Code that tries to call `useState()` outside `setup()` (e.g., lazily, inside a method triggered by a click) fails outright — this is one of the most common "it worked as a plain class but not as an OWL component" mistakes when porting.

### ❌ Wrong (OWL 1 style — does not work in Odoo 17)

```javascript
odoo.define('plant_nursery.OrderPriorityBadge', function (require) {
    "use strict";
    const Widget = require('web.Widget');   // OWL 1 / legacy widget system
    return Widget.extend({
        template: 'OrderPriorityBadge',
        events: { 'click': '_onClick' },
        _onClick: function () { /* ... */ },
    });
});
```

### ✅ Correct (Odoo 17 / OWL 2)

```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";

export class OrderPriorityBadge extends Component {
    static template = "plant_nursery.OrderPriorityBadge";
    static props = { priority: { type: String } };
    setup() {
        this.state = useState({ expanded: false });
    }
}
```

### Performance Considerations

OWL 2's reactivity (`useState`) is proxy-based and fine-grained — only templates that actually read a changed reactive property re-render, so prefer `useState` over manually forcing re-renders. Avoid creating new object/array literals inline in a template expression on every render (`t-att-class="{active: someComputationEachRender()}"` where the computation allocates) — it defeats memoization and can cause unnecessary child re-renders.

### Odoo 17 Notes

`/** @odoo-module **/` at the top of the file is required for Odoo's native ES module loader to treat the file as a module (as opposed to the legacy `odoo.define(...)` wrapper, which is retired for new code in this era of Odoo). Every new JS file should start with it.

---

## 2. Registries

### Explanation

Odoo's web client is assembled almost entirely through **registries** — named collections (`registry.category("services")`, `registry.category("actions")`, `registry.category("fields")`, `registry.category("view_widgets")`, etc.) that modules add entries to instead of the core patching a central switch statement.

```javascript
/** @odoo-module **/
import { registry } from "@web/core/registry";
import { OrderPriorityBadge } from "./order_priority_badge";

registry.category("fields").add("order_priority_badge", {
    component: OrderPriorityBadge,
    supportedTypes: ["selection"],
});
```

### Best Practice

- Register into the **most specific applicable category** — `fields` for field widgets, `actions` for client actions, `services` for services, `view_widgets` for non-field view-level widgets — rather than improvising a new global mechanism.
- Pick a unique, namespaced key (`"plant_nursery.order_kanban_widget"` or at minimum a name unlikely to collide with core) for anything registered into a shared registry — a colliding key silently overwrites (last-registered-wins), which is a hard bug to spot.
- Import only what you register from a dedicated small file, and keep the registry-registration call itself trivial (a few lines) — the actual component/service implementation lives in its own file.

### Why It Matters

Registries are what let dozens of independent modules extend the web client's behavior (add a field widget, add a client action, add a service) without any of them needing to edit a shared core file — the same non-destructive-extension principle as Python's `_inherit` and XML view inheritance, applied to the frontend.

### Odoo 17 Notes

The registry API itself has been stable across recent Odoo versions (14–19) — what changed at 17 is *what* you register into it (OWL 2 components with static properties, instead of legacy Widget subclasses).

---

## 3. Services

### Explanation

A service is a registry entry (category `"services"`) providing a shared piece of functionality (state, an API wrapper, a notification bus) to any component via the `useService` hook — Odoo's dependency-injection mechanism for the frontend.

```javascript
/** @odoo-module **/
import { registry } from "@web/core/registry";

export const nurseryAlertService = {
    dependencies: ["orm", "notification"],
    start(env, { orm, notification }) {
        async function checkLowStock(nurseryId) {
            const result = await orm.call("plant.nursery", "check_low_stock", [nurseryId]);
            if (result.is_low) {
                notification.add(`Low stock: ${result.product_name}`, { type: "warning" });
            }
        }
        return { checkLowStock };
    },
};

registry.category("services").add("nurseryAlert", nurseryAlertService);
```

```javascript
// consuming component
import { useService } from "@web/core/utils/hooks";

setup() {
    this.nurseryAlert = useService("nurseryAlert");
    this.orm = useService("orm");
}
```

### Best Practice

- Declare `dependencies` explicitly and destructure only what you use — this documents the service's real requirements and lets the framework guarantee start-order.
- Use the built-in `"orm"` service for all model calls from JS (`orm.call`, `orm.searchRead`, `orm.write`, ...) instead of hand-rolling `fetch()`/RPC calls — it handles the JSON-RPC envelope, error formatting, and integrates with the framework's loading/error UI consistently.
- Use `"notification"` for toasts/banners, `"dialog"` for modal dialogs, and `"action"` for triggering navigation/`ir.actions` from JS, rather than DOM-manipulating your own equivalents.
- Keep a service's public surface (the object it returns from `start()`) small and purpose-specific — a service is effectively a singleton for the whole web client session; don't let it accumulate unrelated responsibilities.

### Why It Matters

The service layer is what makes components testable and composable — a component that calls `useService("orm")` can be tested with a mocked ORM service, while a component that reaches for `fetch()` or a global directly cannot be isolated the same way. It's also the sanctioned integration point with the rest of the web client (notifications, dialogs, routing) — bypassing it tends to produce UI that doesn't match the rest of the application's behavior (wrong toast styling, dialogs that don't respect the standard stacking/backdrop behavior, etc.).

### Odoo 17 Notes

The service registry and `useService` hook are stable, current-generation APIs as of 17 — this is the correct, non-legacy way to access ORM/notification/dialog/action functionality from any new component.

---

## 4. Hooks

### Explanation

OWL 2 hooks are plain functions (not decorators) called inside `setup()` that attach reactive state or lifecycle behavior to the current component.

| Hook | Purpose |
|---|---|
| `useState(obj)` | Wrap a plain object in a reactive proxy; template reads to its properties trigger re-render on change |
| `useRef(name)` | Get a reference to a DOM element/sub-component tagged `t-ref="name"` in the template |
| `useService(name)` | Inject a registered service (§3) |
| `onWillStart(async () => {...})` | Run async setup before the component's first render (e.g., an initial data fetch) |
| `onMounted(() => {...})` | Run after the component's DOM is attached (DOM measurements, third-party JS library init) |
| `onWillUnmount(() => {...})` | Cleanup (timers, subscriptions) before the component is destroyed |
| `useSubEnv({...})` | Extend the environment passed to child components |
| `useAutofocus()` / `useHotkey()` / `useBus()` | Common UI-behavior hooks from `@web/core/utils/hooks` |

```javascript
/** @odoo-module **/
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class LowStockPanel extends Component {
    static template = "plant_nursery.LowStockPanel";
    static props = {};

    setup() {
        this.orm = useService("orm");
        this.state = useState({ products: [] });
        onWillStart(async () => {
            this.state.products = await this.orm.searchRead(
                "plant.nursery", [["stock_qty", "<", 10]], ["name", "stock_qty"]
            );
        });
    }
}
```

### Best Practice

- Call hooks **unconditionally, at the top level of `setup()`** — never inside a condition, loop, or nested function. This mirrors React's "rules of hooks" for the same underlying reason: OWL tracks hook call order/identity against the current component instance.
- Prefer `onWillStart` for data that must be ready **before** first render (avoids a flash of empty state); prefer `onMounted` for anything that needs actual DOM nodes to exist (measuring size, initializing a non-OWL JS library on a ref'd element).
- Always pair a subscription/timer set up in `onMounted` with cleanup in `onWillUnmount` — an OWL component that outlives its subscriptions is a memory leak and, worse, can fire callbacks against an already-destroyed component's stale state.
- Use `useRef` instead of raw `document.querySelector` to reach into your own component's DOM — it's scoped correctly and doesn't risk grabbing an element from an unrelated part of the page.

### Why It Matters

Hooks are how OWL 2 achieves component-scoped reactive state and lifecycle without a constructor-based inheritance chain — get the call-order/unconditional-call rule wrong and you get subtle, hard-to-reproduce bugs (state that's reactive on first render but silently stops being reactive after a re-render, for instance) rather than a clear error every time.

### ❌ Wrong

```javascript
setup() {
    if (this.props.showStock) {
        this.state = useState({ products: [] });   // conditional hook call — fragile
    }
}
```

### ✅ Correct

```javascript
setup() {
    this.state = useState({ products: [] });   // always called; branch on this.props.showStock
    onWillStart(async () => {                     // when reading/using it inside render logic instead
        if (this.props.showStock) {
            this.state.products = await this.orm.searchRead(/* ... */);
        }
    });
}
```

### Odoo 17 Notes

This whole hook system (as distinct from OWL 1's lifecycle methods like `willStart`/`mounted` defined directly as class methods) is the headline OWL 2 change landing at Odoo 17 — if you see `willStart(){}`/`mounted(){}` defined as plain class methods rather than hooks called in `setup()`, that's OWL 1 code and needs porting.

---

## 5. Patching

### Explanation

"Patching" is Odoo's supported mechanism for **modifying the behavior of an existing component/service/object from another module** without editing its source file — the frontend equivalent of Python's `_inherit`.

```javascript
/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { ListController } from "@web/views/list/list_controller";

patch(ListController.prototype, {
    async onClickCreate() {
        if (this.props.resModel === "plant.order" && !this._canCreateOrder()) {
            this.notification.add(_t("You cannot create orders right now."), { type: "danger" });
            return;
        }
        return super.onClickCreate(...arguments);
    },

    _canCreateOrder() {
        return true; // custom eligibility logic
    },
});
```

### Best Practice

- Always call `super.<method>(...arguments)` from a patched method unless you specifically intend to fully replace the original behavior — same discipline as Python's `super()` in `references/03-python-orm-advanced.md`.
- Patch the **narrowest** target that achieves the goal — patch a specific component's prototype, not a shared base class, if the behavior change is only meant for one context.
- Give the patch a clear origin in code comments/naming (which module, why) — patches are inherently "spooky action at a distance" (the patched file gives no indication from reading it alone that behavior has been modified elsewhere), so make it easy for the next developer to find your patch when debugging the patched component.
- Avoid patching the same target from multiple places in your own module — consolidate into one patch per target to keep the modification easy to reason about.

### Why It Matters

Without a sanctioned patch mechanism, customizing existing core UI behavior would require either forking core JS files (an upgrade-safety disaster — see `references/13-upgrade-safe-development.md`) or convincing core to add an extension point for every conceivable customization in advance (not scalable). `patch()` gives third-party modules the same non-destructive extension power over JS objects that `_inherit` gives them over Python models.

### Odoo 17 Notes

`patch()` from `@web/core/utils/patch` is the current, OWL-2-era patching utility — it replaces older, less consistent patching approaches used in some legacy (pre-OWL) widget code. Use it for any JS-level customization of existing Odoo web client behavior in 17.

---

## 6. Client Actions

### Explanation

A client action (`ir.actions.client`) opens an arbitrary OWL component as a full "page" in the web client — used for custom dashboards, wizards-that-aren't-really-forms, or any UI that doesn't map cleanly onto a standard model view.

```javascript
/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class NurseryDashboard extends Component {
    static template = "plant_nursery.NurseryDashboard";
    static props = ["*"];   // client actions receive action-related props; keep permissive unless you rely on specifics

    setup() {
        this.orm = useService("orm");
        this.state = useState({ kpis: {} });
        onWillStart(async () => {
            this.state.kpis = await this.orm.call("plant.nursery", "get_dashboard_kpis", []);
        });
    }
}

registry.category("actions").add("plant_nursery.dashboard", NurseryDashboard);
```

```xml
<record id="plant_nursery_dashboard_action" model="ir.actions.client">
    <field name="name">Nursery Dashboard</field>
    <field name="tag">plant_nursery.dashboard</field>
</record>
```

### Best Practice

- Register the client action's `tag` in the `actions` registry category, matching the `tag` field on the `ir.actions.client` record exactly.
- Reach for a client action only when a standard `act_window` view genuinely can't express the UI (a dashboard mixing several data sources, a highly custom interactive tool) — for "a form with some extra JS interactivity," extend the form view with a field widget (§7) or a small embedded component instead of a full client action.
- Give the component real `static props` reflecting what the action framework actually passes, rather than defaulting to `["*"]` everywhere — use the permissive form only when you deliberately don't want prop validation on this entry point.

### Odoo 17 Notes

Client actions as OWL 2 components registered this way are the current standard; no `ir.actions.client` schema change in 17.

---

## 7. Field Widgets

### Explanation

A field widget is a component registered into `registry.category("fields")`, implementing a small, well-defined contract (read `props.record`/the field's value, call `props.record.update(...)` or the standard field-editing API on change) so it can be dropped into any form/list/kanban view via `widget="..."`.

```javascript
/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

export class StockLevelBar extends Component {
    static template = "plant_nursery.StockLevelBar";
    static props = { ...standardFieldProps };

    get percentage() {
        const value = this.props.record.data[this.props.name] || 0;
        return Math.min(100, Math.round((value / 100) * 100));
    }
}

registry.category("fields").add("stock_level_bar", {
    component: StockLevelBar,
    supportedTypes: ["integer", "float"],
});
```

```xml
<field name="stock_qty" widget="stock_level_bar"/>
```

### Best Practice

- Spread `standardFieldProps` into your widget's `static props` — it gives you the standard contract (`record`, `name`, `readonly`, etc.) that the views framework expects every field widget to accept, instead of reinventing it.
- Read the current value via `this.props.record.data[this.props.name]`, and write changes via `this.props.record.update({ [this.props.name]: newValue })` — this keeps your widget correctly integrated with the record's dirty-tracking, validation, and save flow.
- Declare `supportedTypes` accurately — it's what lets the widget picker/validation warn a developer who mistakenly applies your widget to an incompatible field type.
- Check the standard widget library first (§12 of `references/05-xml-views.md`) — a genuinely new field widget should be reserved for interactions the standard library doesn't cover.

### Odoo 17 Notes

The `standardFieldProps` + `registry.category("fields")` pattern is the current (OWL 2) field-widget contract used throughout 17's own core widgets — model new widgets directly on a core widget's source (e.g., `@web/views/fields/boolean/boolean_field`) as a working reference implementation.

---

## 8. View customization

### Explanation

Beyond field widgets, the views framework exposes extension points for customizing whole view types: `viewRegistry`/`registry.category("views")` for registering an entirely custom view type, and controller/renderer patching (§5) for adjusting an existing view type's behavior (e.g., a custom button in the list view's control panel).

### Best Practice

- For "add a button to every list view under a condition," patch the relevant controller (§5) rather than trying to inject it purely from XML — the control panel/button area is JS-rendered, not XML-arch-driven the way form fields are.
- For "a wholly new way to visualize this model's data" (a custom Gantt-like view, a specialized planner), register a new view type via the views registry — but recognize this is a significant undertaking; check whether Odoo's existing view types (`calendar`, `gantt` if available in your edition, `graph`, `pivot`, `kanban` with heavy customization) can be configured to do the job first.
- Keep view-level JS customizations additive and scoped by model (`props.resModel === 'plant.order'`) so a patch written for one model's screen doesn't silently affect every other model using the same base view type.

### Odoo 17 Notes

View architecture (Controller/Renderer/ArchParser split) is OWL-2-based throughout in 17; this is a more advanced extension surface than field widgets/client actions and is comparatively rare in day-to-day module work — most "customize this view" needs are met by XML inheritance (`references/05-xml-views.md`) plus a targeted field widget or patch, not a new view type.

---

## 9. Asset bundles

### Explanation

Odoo 17 registers frontend assets (JS, SCSS, XML templates) via the manifest's `assets` dict (see `references/01-module-architecture.md` §2), keyed by bundle name — most commonly `web.assets_backend` (logged-in web client), `web.assets_frontend` (website/portal), and `web.assets_tests` (test-only JS).

```python
'assets': {
    'web.assets_backend': [
        'plant_nursery/static/src/**/*.js',
        'plant_nursery/static/src/**/*.xml',
        'plant_nursery/static/src/**/*.scss',
    ],
    'web.assets_frontend': [
        'plant_nursery/static/src/website/**/*',
    ],
},
```

### Best Practice

- Scope globs to the actual `static/src/` subtree you intend to ship in each bundle — an overly broad glob (`static/**/*`) can accidentally pull in `static/description/` assets or test-only files into the production bundle.
- Put backend-only code under a path pattern that's only referenced by `web.assets_backend`, and website/portal-facing code under one only referenced by `web.assets_frontend` — don't ship the whole `static/src/` tree into both bundles indiscriminately.
- Order matters within a bundle for genuine load-order dependencies (rare with ES modules, since imports handle most of it) — but SCSS still benefits from deliberate ordering (variables/mixins before the files that use them) if you're not using `@use`/`@forward` module-scoped imports.
- Use `('include', 'other.bundle')` sparingly and only when you deliberately want your bundle to also pull in another bundle's full contents.

### Why It Matters

Getting bundle scoping wrong is a common source of two specific symptoms: (1) a component "doesn't exist" in the browser console because its file was never actually included in any loaded bundle, and (2) backend-only JS accidentally shipped to anonymous website visitors, unnecessarily growing the public bundle size (and, in the worst case, exposing internal-only functionality/strings to unauthenticated users).

### Odoo 17 Notes

The dict-based `assets` manifest key (as opposed to defining `<template inherit_id="web.assets_backend">` XML records to manually append `<script>`/`<link>` tags) is the current, preferred registration mechanism — use it for all new modules' assets.
