# Testing

Governs: unit tests, `TransactionCase`, `SavepointCase`, common testing strategies.

---

## 1. Unit tests

### Explanation

Odoo tests are plain Python `unittest`-based tests, discovered from a `tests/` subpackage (imported from `tests/__init__.py`, module names starting with `test_`), and run against a real (test) database — there's no separate mocked-ORM layer; tests exercise the actual ORM, actual constraints, and actual security.

```
plant_nursery/
├── tests/
│   ├── __init__.py
│   └── test_plant_order.py
```

```python
# tests/__init__.py
from . import test_plant_order
```

### Best Practice

- Test **business logic and behavior**, not framework mechanics — you don't need a test asserting that `fields.Char()` stores a string; you do need a test asserting that `action_confirm()` raises `UserError` for an order with no lines.
- One test method = one behavior/scenario, named descriptively (`test_confirm_fails_without_lines`, not `test_1`).
- Use `assertRaises` for expected exceptions, and assert on the *specific* exception type (`UserError`, `ValidationError`, `AccessError`) — a bare `assertRaises(Exception)` passes even if the code raises the wrong kind of error for the wrong reason.
- Run the module's tests on every change (`--test-enable --test-tags /plant_nursery` or `-i plant_nursery --test-enable` on a disposable database) as part of your normal development loop, not just before a release.

### Why It Matters

Because Odoo tests run against a real ORM and real database, they catch a class of bugs (missing `@api.depends`, a record rule that's too permissive, a constraint that doesn't actually fire) that a mocked-unit-test approach in a framework without this design would miss entirely — but only if the tests actually exercise those paths (create real records, call the real action methods, assert on real resulting state) rather than testing in a way that bypasses them.

### Odoo 17 Notes

Test discovery/structure is unchanged in 17. See §2 for the one genuinely version-relevant change: which base test class to use.

---

## 2. `TransactionCase` (and the retirement of `SavepointCase`)

### Explanation

**In Odoo 17, `SavepointCase` no longer exists as a separate class you should reach for — `TransactionCase` itself now provides the behavior `SavepointCase` used to provide.** Historically: `TransactionCase` ran every test method in its own fully independent transaction (heavier, since any `setUp` work re-runs per test), while `SavepointCase` ran all test methods in one shared transaction with per-test savepoints (faster shared setup via `setUpClass`, since expensive fixture creation happens once). Since Odoo 15, that faster, savepoint-based behavior was **merged into `TransactionCase` itself**, and `SavepointCase` became a deprecated alias. By Odoo 17, the idiomatic — and only necessary — base class for the overwhelming majority of tests is plain `TransactionCase`.

```python
from odoo.tests.common import TransactionCase
from odoo.exceptions import UserError


class TestPlantOrder(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Runs ONCE for the whole test class — expensive shared fixtures go here
        cls.partner = cls.env['res.partner'].create({'name': "Test Nursery Customer"})
        cls.product = cls.env['product.product'].create({'name': "Fern", 'list_price': 12.0})

    def test_confirm_fails_without_lines(self):
        order = self.env['plant.order'].create({'partner_id': self.partner.id})
        with self.assertRaises(UserError):
            order.action_confirm()

    def test_confirm_succeeds_with_lines(self):
        order = self.env['plant.order'].create({
            'partner_id': self.partner.id,
            'line_ids': [Command.create({'product_id': self.product.id, 'qty': 1})],
        })
        order.action_confirm()
        self.assertEqual(order.state, 'confirmed')
```

### Best Practice

- **Use `TransactionCase` for essentially all model/business-logic tests.** Put shared, expensive fixture creation in `setUpClass` (runs once for the whole class, wrapped so each test method still gets an isolated savepoint-based rollback) rather than `setUp` (runs before every single method) when the fixture doesn't need to be re-created per test.
- Use `setUp` (instance method, not `@classmethod`) only for genuinely per-test mutable state that different test methods need fresh/independent — most fixture data belongs in `setUpClass`.
- Use `HttpCase` (a `TransactionCase` subclass) instead of plain `TransactionCase` specifically when you need to exercise actual HTTP requests (controller routes) or browser-driven tours — not for ordinary model-method tests, which don't need an HTTP layer at all.
- Don't write your own `SavepointCase` import or reference in new Odoo 17 code — if you see it in code you're maintaining/porting, replace it with `TransactionCase`; the behavior you were getting from `SavepointCase` is what plain `TransactionCase` now provides.
- Use `odoo.tests.Form` to test form-view-driven flows (onchange cascades, default-value resolution as a user would actually experience them) rather than only testing direct `create()`/`write()` calls, when the behavior under test specifically depends on onchange/UI-driven flow rather than the model API directly.

### Why It Matters

Getting this wrong doesn't produce incorrect test *results* (both old classes were functionally similar for correctness) — it produces unnecessarily slow test suites (needlessly re-running expensive `setUp` fixture creation per test when `setUpClass` would do) or, worse, confusion for anyone reading test code written against outdated documentation/tutorials who doesn't realize `SavepointCase` is now just an alias for behavior `TransactionCase` already provides, and spends time "choosing" between two options that are no longer meaningfully different in 17.

### ❌ Wrong (Odoo 16-and-earlier idiom — avoid in new Odoo 17 code)

```python
from odoo.tests.common import SavepointCase   # deprecated; don't use in new 17 code

class TestPlantOrder(SavepointCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': "Test Customer"})
```

### ✅ Correct (Odoo 17)

```python
from odoo.tests.common import TransactionCase

class TestPlantOrder(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': "Test Customer"})
```

### Performance Considerations

Putting fixture creation in `setUpClass` instead of `setUp` is the single biggest lever for keeping a large test suite fast — fixtures created once per class instead of once per test method scale much better as a test file grows from a handful of tests to dozens.

### Odoo 17 Notes

This entire section *is* the Odoo-17-relevant testing note: default to `TransactionCase`, and treat any `SavepointCase` reference you encounter as a signal the code predates the Odoo 15 merge and should be modernized.

---

## 3. Common testing strategies

### Explanation & Best Practice

**Test the guard, not just the happy path.** For every `@api.constrains`/`UserError`-raising guard you write, write at least one test that deliberately violates it and asserts the error — not just a test that the happy path works. Guards without a corresponding "does it actually block the bad case" test are exactly the ones that silently stop working when refactored.

```python
def test_confirm_fails_without_lines(self):
    order = self.env['plant.order'].create({'partner_id': self.partner.id})
    with self.assertRaises(UserError):
        order.action_confirm()
```

**Test security with `with_user(...)`, not just as the test-runner's default (often superuser-like) user.** A test suite that never runs anything as a restricted user will never catch a missing `ir.model.access.csv` row or an overly permissive record rule.

```python
def test_regular_user_cannot_see_other_users_orders(self):
    other_order = self.env['plant.order'].with_user(self.other_user).create({...})
    orders_visible_to_regular_user = self.env['plant.order'].with_user(self.regular_user).search([])
    self.assertNotIn(other_order, orders_visible_to_regular_user)
```

**Test multi-company behavior explicitly** (`references/11-multi-company.md`) if your model has a `company_id` — create two companies and two company-scoped users in the test, and assert cross-company invisibility, rather than relying on the (usually single-company) default test database to happen to catch a leak.

**Test computed-field dependency correctness by mutating a dependency and asserting recomputation**, not just by asserting the initial value is right — this is what actually catches an incomplete `@api.depends` list (`references/02-python-models-fields.md` §3).

```python
def test_amount_total_recomputes_on_line_change(self):
    order = self.env['plant.order'].create({'partner_id': self.partner.id})
    line = self.env['plant.order.line'].create({'order_id': order.id, 'product_id': self.product.id, 'qty': 1})
    self.assertEqual(order.amount_total, line.subtotal)
    line.qty = 3
    self.assertEqual(order.amount_total, line.subtotal)   # must reflect the NEW subtotal
```

**Use `tagged()` to control which tests run when.** Odoo tests are `standard` and `at_install` by default; use `@tagged('post_install', '-at_install')` for tests that need other modules fully installed/configured first (common for tests touching cross-module integration), and `@tagged('-standard')` to exclude genuinely slow/exploratory tests from the default fast run.

**Don't test framework guarantees.** You don't need a test asserting `create()` returns a recordset, or that `search([])` returns all records — that's the ORM's own test suite's job. Spend test-writing effort on *your* business logic's behavior and edge cases.

### Why It Matters

The single most valuable habit in this section is testing guards/security/recomputation *by deliberately trying to break them*, not just confirming the happy path — happy-path-only test suites reliably pass even after a regression silently removes a validation or a security boundary, because nothing in the suite ever exercises the case that regression affects.

### Odoo 17 Notes

`tagged()` and the `standard`/`at_install`/`post_install` tag conventions are unchanged in 17. Combine this section with §2: put shared multi-company/multi-user fixtures (companies, restricted users) in `setUpClass` so they're created once and reused across every test in the class, keeping the suite fast even as you add the security/multi-company tests recommended above.
