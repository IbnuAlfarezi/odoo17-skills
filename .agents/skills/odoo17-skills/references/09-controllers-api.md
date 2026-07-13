# Controllers & APIs

Governs: HTTP controllers, JSON controllers, authentication, request handling, error handling, API best practices.

---

## 1. HTTP Controllers

### Explanation

A controller subclasses `odoo.http.Controller` and registers routes with `@http.route`. Odoo 17 controllers should type their routes explicitly and interact with the ORM through `request.env`, which carries the authenticated user's environment (or the public user's, for `auth='public'` routes).

```python
from odoo import http
from odoo.http import request


class PlantNurseryController(http.Controller):

    @http.route('/nursery/orders/<int:order_id>', type='http', auth='user', website=True)
    def order_page(self, order_id, **kwargs):
        order = request.env['plant.order'].browse(order_id)
        if not order.exists():
            return request.not_found()
        return request.render('plant_nursery.order_page_template', {'order': order})
```

### Best Practice

- Declare `type=` (`'http'` or `'json'`), `auth=`, and, for `type='http'` routes rendering a page, `website=True` if it should participate in the website's menu/branding/error-page handling.
- Use typed route converters (`<int:order_id>`, `<string:token>`, `<model("plant.order"):order>`) instead of parsing raw strings inside the method — it's less code and rejects malformed input before your method body even runs.
- Always check `.exists()` (or catch the `browse()` of a non-existent/inaccessible ID) rather than assuming a client-supplied ID is valid — see §5.
- Keep the controller method thin: parse/validate input, call model methods for actual logic (`references/04-business-logic.md` §1), shape the response.

### Why It Matters

`request.env` is what makes the controller respect the same access rights and record rules as any other entry point — using it consistently (instead of, say, a hand-built cursor/query) is what keeps controllers from becoming a security-bypass side door into the same data the rest of the application carefully protects.

### Odoo 17 Notes

No controller-registration mechanism changes in 17. `request.env` remains the correct, security-respecting way to reach the ORM from a controller.

---

## 2. JSON Controllers

### Explanation

`type='json'` routes are the backbone of the web client's own RPC calls and are commonly used for custom AJAX/fetch-driven endpoints called from OWL components (typically via the `"orm"`/`rpc` services rather than hand-rolled `fetch()` — see `references/07-owl-javascript.md` §3). Odoo 17 JSON routes accept parameters as keyword arguments derived from the request body and return a JSON-serializable value directly (no manual envelope construction needed).

```python
@http.route('/nursery/orders/<int:order_id>/confirm', type='json', auth='user')
def confirm_order(self, order_id):
    order = request.env['plant.order'].browse(order_id)
    if not order.exists():
        raise NotFound()
    try:
        order.action_confirm()
    except UserError as e:
        return {'success': False, 'error': str(e)}
    return {'success': True, 'state': order.state}
```

### Best Practice

- Return small, predictable JSON-serializable structures (`dict`/`list`/primitives) — never return a recordset or an ORM object directly.
- Translate model-layer exceptions (`UserError`, `ValidationError`) into a structured `{'success': False, 'error': ...}'`-style response rather than letting a raw traceback reach the client, while still logging the underlying exception server-side for debugging.
- Validate that any ID passed in the URL/body actually belongs to the model/scope you expect **before** acting on it — a JSON route is just as reachable by a crafted request as by your own frontend code.
- Keep JSON controllers stateless between calls — don't rely on server-side session state beyond what `request.env`'s authenticated user naturally provides.

### Why It Matters

A JSON controller is a public API surface the moment it exists, regardless of whether you intended it to be "just for our own frontend" — anything reachable from the browser is reachable by any client that can construct the same HTTP request, so it needs the same input validation and authorization discipline as a documented external API.

### Odoo 17 Notes

Route typing/parameter handling is unchanged from recent prior versions; there's no 17-specific JSON-controller API break analogous to the `attrs`/OWL2 changes elsewhere in this handbook.

---

## 3. Authentication

### Explanation

`auth=` on `@http.route` selects the authentication mode, which determines what `request.env.user` resolves to and what happens to unauthenticated requests.

| `auth=` value | Meaning | `request.env.user` |
|---|---|---|
| `'user'` | Requires an authenticated session; redirects to login (HTTP routes) or errors (JSON routes) otherwise | The logged-in user |
| `'public'` | No login required; usable by anonymous website visitors | The configured "Public User" (a real, restricted `res.users` record) |
| `'none'` | No user/environment resolution at all — for infrastructure endpoints (health checks) that shouldn't touch the ORM as a specific user | N/A — don't use `request.env` expecting a real user |
| `'admin'` (rare, mostly internal) | Runs with elevated system rights | Effectively unrestricted — reserve for genuinely system-level integration endpoints |

### Best Practice

- Default to `auth='user'` for anything that should require a logged-in employee/portal user; use `auth='public'` deliberately, only for content genuinely meant to be anonymous-accessible.
- Remember that `auth='public'`'s "Public User" is still a real user with its own `ir.model.access.csv`/record-rule exposure — audit what that user's groups can actually read/write just as carefully as any other role (`references/06-security.md`).
- Never implement your own ad hoc authentication (a custom API-key check inside the method body) as a substitute for `auth=` without a specific, deliberate reason (e.g., a webhook endpoint validating an external provider's signature) — and even then, keep the route's declared `auth=` as restrictive as the actual logic allows (often `'public'` combined with your own signature/token check, still going through `request.env` afterward with an explicitly resolved, intentional user, e.g. via `sudo()` with a documented justification per `references/03-python-orm-advanced.md` §3).
- For portal-facing routes, layer `auth='user'` with an explicit ownership check (the requesting portal user actually owns/is related to the record requested) — portal users are authenticated but should typically see only their own data, and that scoping needs a record rule (`references/06-security.md` §2) plus, often, a controller-level sanity check.

### Security Considerations

This is inherently a security-critical decision on every single route — `auth=` misconfiguration (an internal admin action accidentally exposed as `auth='public'`) is one of the highest-severity, easiest-to-miss mistakes in controller code, because the route "works" perfectly for its intended (authenticated) caller during normal testing and only reveals the problem when an unauthenticated request is deliberately tried.

### Odoo 17 Notes

No changes to the `auth=` mechanism itself in 17.

---

## 4. Request handling

### Explanation

`request` (imported from `odoo.http`) is the thread-local proxy giving access to `request.env`, `request.params`/route kwargs, `request.httprequest` (the underlying Werkzeug request for headers/raw body/files), and response helpers (`request.render`, `request.redirect`, `request.make_response`).

### Best Practice

- Prefer typed route parameters and explicit method keyword arguments over manually parsing `request.params`/`request.httprequest.form` — let the routing layer do the parsing and validation.
- Use `request.make_response(...)` (with explicit headers/content-type) for non-standard responses (file downloads, custom content types) rather than constructing a raw Werkzeug `Response` yourself from scratch.
- For file uploads, validate size and content-type server-side before processing — don't trust a client-reported `Content-Type` header alone for anything security-relevant.
- Access query-string/body parameters with `.get()` and explicit defaults/validation, exactly as with ORM context (`references/03-python-orm-advanced.md` §4) — never assume a parameter is present or well-typed just because your own frontend always sends it that way.

### Why It Matters

Every request-handling shortcut that skips validation "because our own JS always sends valid data" quietly becomes a vulnerability the moment the route is hit by anything other than your own JS — a malformed request, a replay, a deliberately crafted payload, or simply a future version of your own frontend that changed its payload shape without the controller being updated in lockstep.

### Odoo 17 Notes

No `request` API changes in 17 relevant to this discipline.

---

## 5. Error handling

### Explanation

Odoo's model-layer exceptions (`odoo.exceptions.UserError`, `ValidationError`, `AccessError`, `AccessDenied`, `MissingError`) are designed to propagate meaningfully all the way to the HTTP layer — `type='http'` routes get a rendered error page, `type='json'` routes get a structured error object — but a controller can and often should catch them explicitly to shape a better client-facing response.

```python
from odoo.exceptions import UserError, AccessError, MissingError
from werkzeug.exceptions import NotFound, Forbidden

@http.route('/nursery/orders/<int:order_id>/confirm', type='json', auth='user')
def confirm_order(self, order_id):
    order = request.env['plant.order'].browse(order_id)
    if not order.exists():
        raise NotFound()
    try:
        order.action_confirm()
    except UserError as e:
        return {'success': False, 'error': str(e)}
    except AccessError:
        raise Forbidden()
    return {'success': True}
```

### Best Practice

- Distinguish "the resource doesn't exist / isn't visible to this user" (respond `404`, don't leak whether it exists-but-is-forbidden vs. genuinely doesn't exist, unless your application specifically needs that distinction) from "the resource exists but the operation isn't allowed right now" (`UserError`, a `400`-class structured error) from "the user isn't authorized at all" (`AccessError`/`403`).
- Never let a raw, unhandled Python traceback reach a JSON API's client response in production — catch broadly enough at the boundary to always return a well-formed error object, while still logging the full exception server-side (`_logger.exception(...)`) for debugging.
- Don't swallow exceptions silently (a bare `except: pass`) — an operation that silently no-ops on error is far harder to debug than one that fails loudly, and can mask real security-relevant failures (e.g., a write that should have raised `AccessError` but was swallowed, leaving the caller believing it succeeded).
- Return error messages that are safe to show a client (translated, user-appropriate) — don't leak internal details (stack traces, SQL, file paths) into a response body reachable by any authenticated (or, worse, `auth='public'`) caller.

### Why It Matters

Consistent, deliberate error handling at the controller boundary is what keeps a genuine security/data-integrity error (an `AccessError` because a user tried to reach data outside their record rules) from being silently converted into "the button did nothing" or, worse, into an unhandled `500` that leaks a traceback with internal paths/model names to the client.

### Odoo 17 Notes

Exception classes and their HTTP-layer translation are unchanged in 17.

---

## 6. API best practices (cross-cutting)

### Explanation & Best Practice

- **Version deliberately if you expose a stable external integration surface** — a `/api/v1/...` prefix (even if you only ever ship v1) makes future breaking changes possible without silently breaking existing integrations.
- **Treat every controller input as untrusted**, including IDs, domains, and field names if a route is generic/flexible enough to accept them — never let a client dictate an arbitrary field list or domain that bypasses the model's normal access-controlled read/write path; if you need a flexible query endpoint, still route it through the ORM's `search`/`read` (which enforce ACLs/record rules) rather than raw SQL built from client input.
- **Prefer `type='json'` routes returning structured data over ad hoc `type='http'` routes hand-building JSON strings** — you get consistent error/response handling from the framework for free.
- **Document non-obvious routes** (a short docstring: purpose, expected auth, expected caller) — controllers are often the least-tested, least-documented part of a module precisely because they're easy to write quickly, which is exactly why they benefit most from a little extra documentation discipline.
- **Rate-limit / validate payload size for any public-facing route accepting user input** (`auth='public'` file uploads, webhook receivers) — an unbounded, unauthenticated endpoint is a resource-exhaustion vector even without any deeper business-logic vulnerability.

### Security Considerations

Controllers are the layer most directly exposed to the public internet (for `auth='public'`/website-adjacent routes) or to arbitrary authenticated clients (for `auth='user'` JSON APIs) — apply the same rigor here you would to any other application's public API surface: input validation, authorization checks that don't just trust client-supplied scope, and no raw error leakage. Everything in `references/06-security.md` about not trusting client-supplied IDs/domains applies directly here.

### Odoo 17 Notes

No 17-specific API-design change; this section is standing practice independent of framework version.
