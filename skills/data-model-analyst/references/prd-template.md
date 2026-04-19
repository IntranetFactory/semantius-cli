# PRD Template — Semantic Data Model

Use this template verbatim for the final PRD output in Stage 5. Each `{{placeholder}}` gets replaced with the value gathered during the workflow. Keep the section order and the table columns identical — downstream agents rely on the structure to parse entities and fields deterministically.

---

## Template starts below this line

```markdown
---
artifact: semantic-data-model-prd
system_name: {{System display name}}
system_slug: {{system_slug}}
domain: {{CRM | ITSM | HRIS | LMS | ERP | PIM | Project Management | Field Service | Subscription Billing | CMS | custom}}
naming_mode: {{template:<vendor> | agent-optimised}}
created_at: {{YYYY-MM-DD}}
---

# {{System display name}} — Data Model PRD

## 1. Overview

{{Two or three sentences describing the system, its users, and the problem it solves. Written for a human reviewer; keep it concrete and avoid marketing tone.}}

## 2. Entity summary

| # | Table name | Singular label | Purpose |
|---|---|---|---|
| 1 | `{{table_name}}` | {{Singular Label}} | {{one-line purpose}} |
| 2 | … | … | … |

## 3. Entities

For each entity, repeat the following sub-structure.

### 3.{{N}} `{{table_name}}` — {{Singular Label}}

**Plural label:** {{Plural Label}}
**Label column:** `{{field_name_used_as_label}}`  _(the human-identifying field; auto-wired by Semantius)_
**Description:** {{1-2 sentence description of what a record represents and when it's created}}

**Fields**

| Field name | Format | Required | Label | Reference / Notes |
|---|---|---|---|---|
| `{{field_name}}` | `{{format}}` | {{yes \| no}} | {{Human Label}} | {{e.g., → `accounts` (N:1), unique, enum values: [a,b,c], searchable}} |
| … | … | … | … | … |

> Do not include `id`, `created_at`, `updated_at`, or the auto-generated `label` field — Semantius creates these automatically.

**Relationships**

- {{Prose description of each relationship this entity participates in, including cardinality and ownership. Example: "A `{{this}}` belongs to one `{{parent}}` (N:1, required, cascade on delete)." / "A `{{this}}` may have many `{{child}}` records (1:N, via `{{child}}.{{this}}_id`)." / "`{{this}}` ↔ `{{other}}` is many-to-many through the `{{junction}}` junction table."}}

---

_(repeat section 3 per entity, numbered 3.1, 3.2, …)_

## 4. Relationship summary

A single table showing every link between entities. An agent uses this to sanity-check that each reference field in §3 has a corresponding row here.

| From | Field | To | Cardinality | Kind | Delete behaviour |
|---|---|---|---|---|---|
| `{{table_a}}` | `{{field}}` | `{{table_b}}` | {{N:1 \| 1:1 \| 1:N \| M:N}} | {{reference \| parent \| junction}} | {{restrict \| clear \| cascade}} |
| … | … | … | … | … | … |

## 5. Enumerations

Collect every `enum` field's allowed values here, one sub-section per enum. If two fields share an enum, note it and list once.

### 5.{{N}} `{{table_name}}.{{field_name}}`
- `{{value_1}}`
- `{{value_2}}`
- `{{value_3}}`

## 6. Open questions

Things the analyst flagged during the session that the user should decide before implementation. Keep this section even if empty — a literal "None identified." sentence is fine.

- {{Open question 1}}
- {{Open question 2}}

## 7. Implementation notes for the downstream agent

A short checklist for the agent who will materialise this model in Semantius (or equivalent):

1. Create one module named `{{module_slug}}` and two baseline permissions (`{{module_slug}}:read`, `{{module_slug}}:manage`) before any entity.
2. Create entities in the order given in §2 — entities referenced by others first.
3. For each entity: set `label_column` to the snake_case field marked as label in §3, pass `module_id`, `view_permission`, `edit_permission`. Do **not** manually create `id`, `created_at`, `updated_at`, or the auto-label field.
4. For each field in §3: pass `table_name`, `field_name`, `format`, `title` (the Label column), `is_nullable` (inverse of Required), and for `reference`/`parent` fields also `reference_table` and a `reference_delete_mode` consistent with §4.
5. After creation, spot-check that `label_column` on each entity resolves to a real field and that all `reference_table` targets exist.
```

## Template ends above this line

---

## Authoring guidance

- Use the fenced `markdown` block so the PRD is self-contained when copied.
- Table columns are fixed — don't rename or reorder them. Agents parse by header.
- If a field is a reference, always put the arrow + target + cardinality in the "Reference / Notes" column, e.g. `→ accounts (N:1)`. If it's a parent (ownership), use `↳ accounts (N:1, cascade)` so the distinction is visible.
- Keep the "Open questions" section even when empty. Downstream agents use its presence to decide whether to escalate before implementation.
- The front-matter is YAML — every value must be quoted if it contains a colon.
- If the system has no enums, §5 can read "No enumerations defined." — don't omit the section; keeping section numbers stable helps humans navigate multiple PRDs.
