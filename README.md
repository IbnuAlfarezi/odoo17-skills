# Odoo 17 Community Development Best Practices Guide

![Odoo 17](https://img.shields.io/badge/Odoo-17.0-714B67?style=flat&logo=odoo&logoColor=white)
![Edition](https://img.shields.io/badge/Edition-Community-0d6efd)
![Format](https://img.shields.io/badge/format-Agent%20Skill-6f42c1)
![Status](https://img.shields.io/badge/status-active-brightgreen)

> A senior-architect-level engineering handbook for **Odoo 17 Community** development, packaged as a portable [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — so Claude, Claude Code, and Google Antigravity can apply it automatically while you write Odoo code, not just when you remember to ask.

Not a beginner tutorial. This is the kind of internal standard a technical architect hands a team: standard module structure, ORM discipline, layered security, performance patterns, and upgrade-safety — with the Odoo 17-specific breaking changes called out everywhere they're actually relevant, not buried in a single changelog nobody rereads.

---

## Contents

| # | Topic | File |
|---|---|---|
| — | **Router** — architecture diagram, golden rules cheat sheet, Odoo 17 vs. 16 changes table | [`SKILL.md`](SKILL.md) |
| 1 | Module architecture — structure, manifest, naming, dependencies, separation of concerns | [`references/01-module-architecture.md`](references/01-module-architecture.md) |
| 2 | Models & fields — computed/related/stored fields, constraints, onchange, CRUD overrides | [`references/02-python-models-fields.md`](references/02-python-models-fields.md) |
| 3 | ORM internals — recordsets, env, context, domains, prefetching, `_inherit`/`_inherits`, mixins | [`references/03-python-orm-advanced.md`](references/03-python-orm-advanced.md) |
| 4 | Business logic — where it lives, services, wizards, server actions, cron, duplication | [`references/04-business-logic.md`](references/04-business-logic.md) |
| 5 | XML views — inheritance, XPath, search/form/tree/kanban, smart buttons, widgets | [`references/05-xml-views.md`](references/05-xml-views.md) |
| 6 | Security — `ir.model.access.csv`, record rules, groups, multi-company, pitfalls | [`references/06-security.md`](references/06-security.md) |
| 7 | OWL 2 / JavaScript — components, registries, services, hooks, patching, widgets, assets | [`references/07-owl-javascript.md`](references/07-owl-javascript.md) |
| 8 | Reports — QWeb reports, report inheritance, print performance | [`references/08-reports.md`](references/08-reports.md) |
| 9 | Controllers & APIs — HTTP/JSON controllers, auth, request/error handling | [`references/09-controllers-api.md`](references/09-controllers-api.md) |
| 10 | Performance — N+1 queries, `search()`, `read_group`/`_read_group`, batching, raw SQL | [`references/10-performance.md`](references/10-performance.md) |
| 11 | Multi-company — `company_dependent`, `with_company()`, cross-company safety | [`references/11-multi-company.md`](references/11-multi-company.md) |
| 12 | Data files — XML/CSV data, demo data, `noupdate`, external IDs | [`references/12-data-files.md`](references/12-data-files.md) |
| 13 | Upgrade-safe development — extension vs. modification, stable XML IDs, migrations | [`references/13-upgrade-safe-development.md`](references/13-upgrade-safe-development.md) |
| 14 | Testing — `TransactionCase`, the `SavepointCase` merge, testing strategies | [`references/14-testing.md`](references/14-testing.md) |
| 15 | Anti-patterns checklist — consolidated, scannable pass for PR review | [`references/15-anti-patterns-checklist.md`](references/15-anti-patterns-checklist.md) |

Every reference file follows the same shape: **Explanation → Best Practice → Why It Matters → ❌ Wrong → ✅ Correct → Performance → Security (where relevant) → Odoo 17 Notes.**

## Why this exists

Most "Odoo best practices" content floating around is either the official docs (accurate but reference-style, not opinionated) or scattered blog posts (opinionated but frequently stale or version-mixed). This handbook is written as a single, internally-consistent engineering standard — the kind you'd actually hold a code review against — and it's version-pinned to Odoo 17 Community on purpose, since "Odoo best practices" that don't say which version they mean are a common source of subtly broken generated code.

## Odoo 17 corrections baked in

These are the details most likely to be wrong in code copied from a v16 tutorial or generated from older training data — every relevant file calls them out explicitly:

| Area | Changed to (Odoo 17) | Where |
|---|---|---|
| `attrs="{...}"` / `states="..."` | Removed entirely — direct expressions like `invisible="state == 'draft'"` | [`05-xml-views.md`](references/05-xml-views.md) §3 |
| List/tree column visibility | `invisible` now hides only the cell; use `column_invisible` for the column | [`05-xml-views.md`](references/05-xml-views.md) §3, §8 |
| `name_get()` | Deprecated — override `_compute_display_name()` instead | [`02-python-models-fields.md`](references/02-python-models-fields.md) §8 |
| JS framework | OWL 2 (`setup()` + hooks), not OWL 1's `willStart`/constructor style | [`07-owl-javascript.md`](references/07-owl-javascript.md) |
| `SavepointCase` | Gone — `TransactionCase` now provides that behavior natively | [`14-testing.md`](references/14-testing.md) §2 |
| List view root tag | Still `<tree>` — the `<list>` rename is an 18+ change | [`05-xml-views.md`](references/05-xml-views.md) §8 |

## Repository structure

```
odoo-17-dev-standards/
├── README.md                                 ← you are here
├── SKILL.md                                  ← Agent Skill entry point (router)
└── references/
    ├── 01-module-architecture.md
    ├── 02-python-models-fields.md
    ├── 03-python-orm-advanced.md
    ├── 04-business-logic.md
    ├── 05-xml-views.md
    ├── 06-security.md
    ├── 07-owl-javascript.md
    ├── 08-reports.md
    ├── 09-controllers-api.md
    ├── 10-performance.md
    ├── 11-multi-company.md
    ├── 12-data-files.md
    ├── 13-upgrade-safe-development.md
    ├── 14-testing.md
    └── 15-anti-patterns-checklist.md
```

---

## Using this as an AI agent Skill

`SKILL.md` follows the open **Agent Skills** format (YAML frontmatter with `name`/`description`, Markdown instructions, linked reference files) — the same format across every surface below, so nothing needs to be reformatted per tool.

### Claude ([claude.ai](https://claude.ai))

1. Zip the folder if you don't already have `odoo-17-dev-standards.skill`: `zip -r odoo-17-dev-standards.skill odoo-17-dev-standards/`
2. **Settings → Features** → upload it as a custom Skill. Requires Pro, Max, Team, or Enterprise with code execution enabled.
3. Skills on claude.ai are per-user — each teammate who wants it uploads their own copy; there's currently no org-wide push from admin settings.

### Claude Code

No upload — Claude Code Skills are filesystem-based:

```bash
# Personal — available in every project
cp -r odoo-17-dev-standards ~/.claude/skills/

# Project-only — commit this alongside your Odoo addon repo
cp -r odoo-17-dev-standards <your-odoo-repo>/.claude/skills/
```

### Claude API / Claude Platform

Upload via the [Skills API](https://platform.claude.com/docs/en/build-with-claude/skills-guide) (`/v1/skills`) for workspace-wide sharing across your team. Requires the code execution tool plus the `skills-2025-10-02` and `files-api-2025-04-14` beta headers.

### Google Antigravity

Antigravity adopted the same open Agent Skills standard, so the folder works as-is:

```bash
unzip odoo-17-dev-standards.skill

# Global — every project
mkdir -p ~/.gemini/config/skills && cp -r odoo-17-dev-standards ~/.gemini/config/skills/

# Project-only
mkdir -p <your-odoo-repo>/.agents/skills && cp -r odoo-17-dev-standards <your-odoo-repo>/.agents/skills/
```

Antigravity is a young, fast-moving product and its skills directory has moved once or twice already — if it isn't picked up, check the Skills section of its settings for the current path.

### Just read it

No installation required. Every file is plain Markdown — clone the repo and start with `SKILL.md`, or use `references/15-anti-patterns-checklist.md` directly as a PR-review checklist regardless of what tooling (if any) you use.

### How it gets triggered

Every surface above uses the same **progressive disclosure** model: only `name` + `description` from `SKILL.md`'s frontmatter are loaded up front (cheap, always-on); the full `SKILL.md` body loads only once a request looks relevant; individual `references/*.md` files load only when the specific topic is actually needed. You don't have to invoke it by name — describe the Odoo task normally and it activates on its own — though naming it explicitly (e.g. "use the Odoo 17 standards skill") guarantees it fires.

---

## Contributing

- Keep `SKILL.md`'s index and the `references/` folder in sync — every file it links to must exist, and every file in `references/` should be linked from somewhere.
- Verify any Odoo-17-specific claim against the current official documentation before merging a change; don't extrapolate from v16 material or assume an LLM's memory is current on framework version details.
- Preserve the section shape (Explanation → Best Practice → Why It Matters → ❌ Wrong → ✅ Correct → Performance → Security → Odoo 17 Notes) in new content so the handbook stays consistent to scan.
- If you repackage this as a `.skill` zip, keep `name` lowercase-with-hyphens (≤64 chars) and `description` ≤1024 characters — both are hard limits of the Skill format, not just style preferences.

## Security note

This Skill is plain Markdown — no bundled scripts, no network calls, nothing executable. Even so, treat any Skill (this one included) the way you'd treat installing software: read it before you trust it, and only load Skills — yours or anyone else's — from sources you actually trust.

## Scope & disclaimer

Targets **Odoo 17.0 Community** only — no Enterprise-only apps (Studio, Documents, Sign, IoT) or SaaS/Odoo.sh operations. This is an independent engineering reference, not affiliated with or endorsed by Odoo S.A. Odoo evolves quickly even within a stable version; treat this as a strong, current default rather than a permanent substitute for the [official developer documentation](https://www.odoo.com/documentation/17.0/).

## License

No license is set yet — add one before treating this as open source or sharing it outside your organization (e.g. MIT for the code snippets, or CC BY 4.0 for the handbook text as a whole).
