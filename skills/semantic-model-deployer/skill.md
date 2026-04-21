---
name: semantic-model-deployer
description: Safely deploys a *-semantic-model.md file (produced by the semantic-model-analyst skill; legacy *-data-model-prd.md files are also accepted) to a live Semantius instance using the semantius-cli. Before any writes, reconciles the model against the existing catalog — updates an existing module in place when the slug matches, extends Semantius built-ins (`users`, `roles`, `permissions`, …) additively instead of replacing them, refuses duplicate entity names across modules, and surfaces explicit merge/rename decisions for near-duplicates (e.g. `contracts` vs `saas_contracts` vs `vendor_contracts`). Use whenever a semantic-model file exists and the user wants to deploy, apply, push, sync, integrate, reconcile, or roll out the model — including phrasings like "implement the model", "deploy the model", "apply the schema", "set up the entities", "create the entities in Semantius", "push this to Semantius", "integrate this model with what's already there", or "now make it real". Also trigger when the user uploads or references a *-semantic-model.md (or legacy *-data-model-prd.md) and asks to do anything that would materialize it. Trigger proactively when such a file is present and the user's intent is clearly to deploy it.
---

# semantic-model-deployer Skill

This skill bridges the gap between a self-contained semantic model (produced by the `semantic-model-analyst` skill) and a live Semantius instance.

**Division of responsibility:**
- This skill owns the *workflow* — parsing the model, inspecting what's already deployed, diffing, deduplicating against built-ins, **detecting name collisions and near-collisions across the entire entity catalog**, planning, and orchestrating the sequence of steps.
- The **semantius-cli skill** owns the *execution* — all Semantius operations are done via the `semantius-cli` CLI tool, following that skill's patterns and reference docs.

## Your role: gatekeeper of a unified catalog

Semantius is a **unified platform — a universal system of records**. It is **not** a collection of independent silos stitched together. Each semantic model you implement is a *point solution* that drops into a shared catalog of modules, entities and fields. Other point solutions have been — or will be — installed into the same instance.

**Two entities called `contracts` owned by two different modules is exactly the kind of drift that makes the platform unusable for both humans and agents.** The moment the catalog contains ambiguous names, downstream reasoning falls apart: users don't know which table to use, agents pick the wrong one, reports double-count, and FK references point to the wrong concept.

Your job as the implementer is to **refuse to introduce ambiguity**. Before creating any entity you must:

1. Check whether it already exists as a built-in (see Stage 2b) — never replace, may extend additively.
2. Check whether it already exists as a custom entity in this same module (Stage 2c) — this is a re-run; update in place.
3. Check whether an entity with the **same** name already exists in a **different** module (Stage 2d) — **ambiguity gate; the user must decide merge vs rename before you proceed.**
4. Check whether an entity with a **similar** name exists anywhere (Stage 2d) — **ambiguity gate; the user must decide.**

Never silently coexist conflicting names. Never pick a side for the user. Resolving catalog ambiguity is the single most important thing this skill does.

**This skill is designed to be re-run whenever the model changes.** Because it always inspects Semantius before acting, re-running on an updated model is safe — it diffs the new model against what's already deployed and applies only the delta (new entities, new fields, updated labels/enums). If a module with the same `system_slug` already exists, **always update that module** — never create a duplicate. Things that haven't changed are skipped. Things in Semantius that are no longer in the model are left alone.

**The model is self-contained.** The semantic-model file produced by `semantic-model-analyst` declares every entity the domain needs, including ones that happen to overlap with Semantius built-ins (e.g. `users`, `roles`, `permissions`, `webhook_receivers`). Those built-ins are platform infrastructure — they control authentication, RBAC, and integration, and **must never be replaced**. They *may* be extended additively (new nullable fields on `users`, for instance). See Stage 2b.

---

## Step 0: Load the semantius-cli Skill

Before doing anything else, read the semantius-cli skill and its data-modeling reference:

```
Read: <skills-root>/semantius-cli/SKILL.md
Read: <skills-root>/semantius-cli/references/data-modeling.md
```

The data-modeling reference gives you the mandatory creation order, all field formats, the Golden Rules, and exact CLI syntax. Everything in the execution stages below follows those patterns. Also read `references/cli-usage.md` if you need help with CLI invocation, piping, or error handling.

All Semantius operations in this skill are performed using the **`semantius-cli` command-line tool**, for example:

```bash
semantius-cli call crud read_module '{"filters": "name=eq.lead_manager"}'
semantius-cli call crud create_entity '{"data": {...}}'
```

---

## High-Level Workflow

```
1. Parse PRD  →  2. Inspect Semantius  →  3. Plan & Present  →  4. Execute  →  5. Verify  →  6. Sample Data?
```

Work through each stage in order. Narrate what you're doing at each step.

---

## Stage 1: Parse the semantic model

Locate the `*-semantic-model.md` file (accept the legacy `*-data-model-prd.md` suffix as well). Extract:

- **`system_slug`** from YAML frontmatter — this is the module name
- **Human-readable system name** — from the top-level heading (`# ... — Semantic Model` or legacy `# ... Data Model PRD`)
- **Entity list** — from the §2 entity summary table, in order
- **Per-entity details** from each §3 entity subsection:
  - `table_name`, `singular`, `plural`, `singular_label`, `plural_label`, `description`, `label_column`
  - Fields: `field_name`, `format`, required, `title` (= Label column), reference targets, delete modes
  - Enum values from §5
- **Relationship table** (§4) — confirms `reference_delete_mode` for each FK field
- **§2 Mermaid diagram** — sanity-check it agrees with §3/§4 (the model's own audit should have caught mismatches; if it disagrees here, flag for the user before proceeding rather than silently picking one side)
- **§6 Open questions** — scan both sub-sections. **§6.1 🔴 Decisions needed is a gate**: if any entry is present and unresolved, stop before Stage 4 and list the blockers to the user; ask them to either (a) answer each question so the model can be updated first via the semantic-model-analyst skill, or (b) explicitly waive and proceed at their own risk. Do not make up answers, and do not silently proceed. **§6.2 🟡 Future considerations is informational only** — note them for the user but do not block. Models that predate the two-bucket format (flat §6 list) should be treated conservatively: surface every flat entry as a potential blocker and ask the user to classify each before proceeding.
- **Implementation notes** (§7) — always follow these

### Model-to-Field Mapping

| Model column | `create_field` parameter |
|---|---|
| Field name | `field_name` |
| Format | `format` |
| Label | `title` |
| Required = yes | `is_nullable: false` |
| Required = no | `is_nullable: true` |
| → `table` | `reference_table` |
| Delete mode from §4 | `reference_delete_mode` |
| Enum values from §5 | `enum_values` |

### Fields That Are Auto-Generated — Never Create These

`create_entity` automatically creates these — skip them when iterating over model fields:

- `id`, `label`, `created_at`, `updated_at`
- The field named in `label_column` (auto-created with `ctype: label`)

> **Title correction:** The auto-created `label_column` field gets its title from `singular_label`. If the model specifies a different title for that field, use `update_field` to fix it after entity creation.

### Self-References

Fields that reference their own entity (e.g., `campaign.parent_campaign_id → campaigns`) must be created in a second pass after all entities exist. Flag them during parsing.

---

## Stage 2: Inspect the Unified Catalog

**Read before writing — always.** (semantius-cli Golden Rule #1)

This stage does four things in order: (a) resolve the module, (b) inspect built-ins, (c) load the full entity catalog, (d) classify every model entity and surface ambiguity.

### 2a. Resolve the module — update if it already exists

Look up the module by `system_slug`:

```bash
semantius-cli call crud read_module '{"filters": "module_name=eq.<system_slug>"}'
```

- **Exists** → plan an `update_module` (refresh `label` and `description` from the model's `system_name` and §1 Overview). Capture the existing `module_id` to reuse. **Never create a second module with the same slug.**
- **Missing** → plan a `create_module` followed by baseline permissions `<slug>:read` and `<slug>:manage`.

If the module exists but the user's model genuinely belongs to a different domain and the shared slug is itself the collision, stop and ask — that's a model-level naming problem the analyst skill should fix, not something to paper over.

### 2b. Inspect Semantius built-ins

The semantic model may declare entities that already exist as built-ins (`users`, `roles`, `permissions`, `permission_hierarchy`, `role_permissions`, `user_roles`, `webhook_receivers`, `webhook_receiver_logs`, `modules`, `entities`, `fields` — see `semantius-cli/references/data-modeling.md` for the authoritative list). **These tables control the platform (authentication, RBAC, integration). They must never be replaced.**

For each built-in referenced by the model:

- **Skip `create_entity`** entirely. The built-in already exists; recreating would break the platform.
- **Reuse as a `reference_table` target** for any FK in the model that points at it.
- **Additive fields only.** If the model declares extra scalar fields on a built-in (e.g. `users.department`, `users.employee_id`), offer them to the user as `create_field` calls with `is_nullable: true`. **Never modify existing built-in fields**, never mark new fields required, never change formats or enum values on a built-in.

### 2c. Load the full entity catalog

Ambiguity detection only works if you can see every entity in the instance, not just the ones in this module. Load the catalog:

```bash
semantius-cli call crud read_entity '{}'
```

Build an index of every existing entity keyed by `table_name`, carrying at least `{module_id, module_name, singular, plural, description, label_column}`. You will use it in 2d.

### 2d. Classify each model entity

For every entity declared in the model's §2, determine which bucket it falls into. **Buckets marked 🛑 are ambiguity gates — the user must make an explicit decision in Stage 3 before any writes happen.**

| Bucket | Condition | Action |
|---|---|---|
| 🔒 Built-in | `table_name` matches a Semantius built-in | Reuse. Offer additive fields only (see 2b). |
| ♻️ Same-module match | Entity exists and its `module_id` equals our module's id | Re-run case — proceed to field-level diff (see "What to compare" below). |
| 🛑 Cross-module exact name | Entity exists with the **same `table_name`** but `module_id` ≠ our module | **Gatekeeper decision required.** Never silently coexist — see 2e. |
| 🛑 Similar name | An existing entity's `table_name` is *near* a model entity's name (see heuristic below) | **Gatekeeper decision required.** Similarity is a hint, not a verdict; the user decides. |
| ✨ New | No match of any kind | Create normally in Stage 4. |

For field-level checks on a same-module match, run the usual reads:

```bash
semantius-cli call crud read_permission '{"filters": "permission_name=eq.<slug>:read"}'
semantius-cli call crud read_field '{"filters": "table_name=eq.<table_name>&field_name=eq.<field_name>"}'
```

### 2e. Similarity heuristic — when to flag

You, the agent, are responsible for detecting near-names. Flag any pair where:

- One name is a prefix or suffix of the other — `contracts` ↔ `saas_contracts`, `orders` ↔ `sales_orders`
- They share a singular root or a lemma — `contract` ↔ `contracts`, `customer` ↔ `customers`, `vendor` ↔ `vendors`
- They differ only by a domain qualifier — `vendor_contracts` ↔ `saas_contracts`, `support_ticket` ↔ `it_ticket`
- They are obvious synonyms for the same business concept — `customers` ↔ `clients`, `employees` ↔ `staff`, `products` ↔ `items`
- Edit distance is small and the tokens look related (not just typos of unrelated words)

If you're uncertain whether two names refer to the same concept, **flag it**. A false positive costs the user one confirmation click; a missed collision pollutes the catalog permanently and cannot be cleaned up without data migration.

### 2f. For each 🛑, compare the concepts before asking the user

You cannot ask a useful question without first understanding both entities. For every flagged pair, pull the existing entity's fields and build a side-by-side comparison:

```bash
semantius-cli call crud read_field '{"filters": "table_name=eq.<existing_table_name>"}'
```

Note for each:

- Module it lives in, `singular`, `plural`, `description`, `label_column`
- Field names, formats, required-ness
- Overlap: which fields mean the same thing (often same name, sometimes just same concept under a different name)
- Format conflicts on conceptually-same fields (immutable → blocks merge)

This comparison goes into the Stage 3 plan so the user can decide on informed grounds.

### What to compare when a same-module entity already exists

| Property | Risk | Notes |
|---|---|---|
| Field `format` | 🛑 High — **immutable** | Cannot be changed after creation |
| Field `is_nullable` (model is stricter) | ⚠️ Medium | May fail if nulls already exist |
| Field `enum_values` | ⚠️ Medium | Changing values may affect existing records |
| Entity labels, descriptions | ✅ Low | Safely updatable |
| Field `title`, `description` | ✅ Low | Safely updatable |

---

## Stage 3: Plan and Present (and resolve ambiguity)

Before running any writes, show the user a clear plan. The plan must have two parts: (1) the normal module/permission/entity summary, and (2) **an ambiguity-decisions section if any 🛑 buckets were raised in Stage 2**. No writes happen until every 🛑 has an explicit decision.

### Normal plan (example)

```
📦 Module: saas_expense_tracker
  ✨ Will create (new module)
  🔑 Permissions: ✨ saas_expense_tracker:read, ✨ saas_expense_tracker:manage

🗂 Entities (7 total):
  🔒 users — Semantius built-in, reusing (model declares 3 extra fields: `department_id`, `job_title`, `employee_id` — will add additively with user confirmation)
  ✨ vendors — will create + 6 fields
  ✨ subscriptions — will create + 26 fields
  ✨ departments — will create + 5 fields
  ✨ budget_periods — will create + 6 fields
  ✨ budget_lines — will create + 8 fields
  ✨ license_assignments — will create + 7 fields

Total to create: 1 module, 2 permissions, 6 entities, ~58 fields
Plus: 3 additive fields on built-in `users` (pending confirmation)
```

If the module already exists, swap `✨ Will create` for `♻️ Exists (ID: 12) — will update module metadata from the new model; will diff entities and apply only changes`.

### Ambiguity decisions (required when any 🛑 was raised)

For every cross-module exact-name match and every similar-name match, present a side-by-side comparison and ask explicitly. Never propose a default silently.

```
⚠️ Ambiguity: `contracts`

  Incoming (this model → module `saas_expense_tracker`):
    Purpose: A signed commercial agreement for a SaaS subscription
    Label column: contract_number
    Fields: contract_number, signed_date, total_contract_value,
            renewal_notice_days, vendor_id (→ vendors), signatory_user_id (→ users)

  Existing (module `facility_management`, created 2026-01-14):
    Purpose: Lease and service agreements for physical properties
    Label column: contract_number
    Fields: contract_number, effective_date, termination_date,
            landlord_id (→ landlords), property_id (→ properties),
            monthly_rent

  Overlap: both share `contract_number` (string). Other fields are disjoint;
  the entities model different concepts that happen to share an English word.

  How should I resolve this?
    (a) Merge — treat these as the same entity. I'll unify fields under
        `contracts`; non-overlapping fields from the incoming model will be
        added additively. Only safe when the two truly represent the same
        business concept (not the case here at first read).
    (b) Rename incoming → `saas_contracts` (keeps your new model isolated;
        recommended when the two concepts are genuinely different)
    (c) Rename existing → e.g. `facility_contracts` (touches live records
        and any FK pointing at `contracts`; high-risk, may require data
        migration — warn before proceeding)
    (d) Rename both → e.g. `saas_contracts` + `facility_contracts`
        (most conservative; removes ambiguity entirely, marks the catalog
        explicitly domain-scoped)
    (e) Abort — I'll go back to the analyst skill and redesign

```

For **similar-name** flags, use the same format but note the heuristic that matched (prefix/suffix/synonym/etc.) so the user can evaluate whether it's a real collision or a coincidence.

### Merge / rename rules

**Merge (a):**

- Do a field-by-field mapping. For each incoming field, either point it at an existing field with the same meaning, or add it as a new nullable field on the existing entity.
- **Format mismatch on a conceptually-same field is a hard block.** Formats are immutable; a merge that requires changing a format is impossible. Fall back to rename.
- The merged entity stays in its current module (keeps existing records and FKs intact). The incoming model's module just references it.

**Rename incoming (b):**

- Pick a qualifier from the model's domain (`saas_`, `hr_`, `billing_`) and propose it. The user may override.
- **Rewrite every internal reference in the model before Stage 4** — FK fields that point at the renamed entity, `reference_table` values, relationship prose, the §2 Mermaid diagram references. The rename applies only to the in-memory plan, not the saved model file (unless the user asks to also update the source file via the analyst skill).

**Rename existing (c):**

- **High-risk.** Confirm twice. `table_name` rename touches every FK pointing at that table plus all existing records. If the platform rejects `update_entity` on `table_name` (it often does — the underlying PG table name is usually immutable in practice), tell the user immediately and offer (d) or (a) as a fallback.
- If the rename succeeds, fix every `reference_table` that pointed at the old name in a second pass.

**Rename both (d):**

- Apply (b) to the incoming entity and (c) to the existing one. Same caveats as (c) apply.

Do not proceed to Stage 4 until every 🛑 has a recorded decision. Restate the resolved plan once before executing.

**Exception:** If there are zero built-in overlaps, zero cross-module collisions, zero similar-name flags, and the module doesn't exist yet, proceed immediately: "No existing model found and no catalog collisions — creating everything from scratch now."

---

## Stage 4: Execute

Follow the semantius-cli mandatory creation order exactly:

```
Module → Permissions → Entities → Fields (per entity, in model order)
```

Refer to `semantius-cli/references/data-modeling.md` for the exact CLI syntax for each operation. **Before executing, apply every ambiguity decision from Stage 3** to the in-memory plan — renames propagate to every `reference_table` and relationship reference in the model. The sequence:

**4a. Module** — If missing, `create_module`. If it already exists, `update_module` with the current `label`/`description` from the model. Never create a duplicate module with the same `module_name`.

**4b. Permissions** — Ensure `<slug>:read` and `<slug>:manage` exist. `read_permission` first; `create_permission` only for the missing ones.

**4c. Entities** — Walk model §2 in order and apply each entity's bucket decision:

- 🔒 Built-in → skip entirely. Do not `create_entity` for `users`, `roles`, etc.
- ♻️ Same-module match → skip `create_entity`; fall through to 4d (field diff).
- ✨ New → `create_entity`. After creation, correct the `label_column` field title if needed with `update_field`.
- 🛑 Resolved as **merge** → skip `create_entity`. The target is the existing entity in the other module. Record the mapping; the merge is realised in 4d by adding the non-overlapping fields additively to the existing entity.
- 🛑 Resolved as **rename incoming** → `create_entity` using the new name. (Plan-level rewrite of `reference_table` values has already happened before this stage.)
- 🛑 Resolved as **rename existing** → attempt `update_entity` on the existing entity's `table_name` first, before any new creates. If the platform rejects the rename, stop and return to Stage 3 — never continue silently. Once the rename is live, any `reference_table` that pointed at the old name must be fixed.
- 🛑 Resolved as **rename both** → do the existing-rename first, then `create_entity` for the incoming under its new name.
- 🛑 Resolved as **abort** → stop Stage 4 entirely; tell the user to iterate on the model with the analyst skill.

**4d. Fields** — For each entity, create missing fields in model order with `create_field`. Skip auto-generated ones (`id`, `label`, `created_at`, `updated_at`, and the `label_column` field). Always include `width: "default"` and `input_type: "default"`. For FK fields whose `reference_table` is a built-in (`users`, `roles`, …) or a merged existing entity, point directly at that `table_name` — the platform doesn't care whose module owns it.

For ♻️ same-module matches and 🛑 merges, only create fields that don't already exist; `update_field` for safe diffs (title, description, enum extensions, searchable). Never attempt a format change — formats are immutable and that requires an analyst-level rethink.

**4e. Built-in extensions** — If the user confirmed additive field extensions on a built-in (e.g. the model declares `users.department_id` and the built-in doesn't have it), create those fields after all custom entities are done. Only `create_field` with `is_nullable: true`. Do not modify existing built-in fields, do not mark new ones required, do not change formats or enum values.

**Second pass** — After all entities exist, create any self-reference fields (e.g. `departments.parent_department_id` → `departments`) and any cross-reference pairs that had to wait (e.g. the mutual `departments.manager_user_id` ↔ `users.department_id`).

After each entity's fields are done, share the UI link:
`https://tests.semantius.app/<module_name>/<table_name>`

---

## Stage 5: Verify

After all creates are done:

1. `read_entity` on each custom entity — confirm `label_column` is set
2. `read_field` per entity — confirm field count matches the model (minus auto-generated)
3. Spot-check that `reference_table` targets exist for FK fields (including any that point at built-ins like `users`)
4. If any additive fields were added to built-ins, confirm they were created with `is_nullable: true`

Print a final summary: "✅ Done. Created 1 module, 2 permissions, 5 entities, 47 fields. Reused built-ins: users. Additive fields on built-ins: 2."

---

## Stage 6: Sample Data

After verification, ask:

> "The `<SystemName>` model is live in Semantius ✅  
> Would you like me to generate 10 realistic sample records for each entity?"

If the user says yes, create records in dependency order (entities with no parent FKs first, junction tables last — the model §4 order is usually correct). Skip built-ins (`users`, etc.) unless the user explicitly asks for sample users — built-ins usually already have real records.

**Generate a single shell script** for all sample data rather than making individual CLI calls. This avoids context bloat from dozens of sequential tool invocations. Write the script to a temp file, run it once, and check the output.

The script should consist of sequential `semantius-cli call crud postgrestRequest` calls, one per record, capturing inserted IDs directly from the POST response for use in FK fields.

### postgrestRequest response envelope

`postgrestRequest` always wraps its result in `{"request":{...},"response":{"status":201,"data":[{...}]}}`. The inserted record is at `response.data[0]`, **not** at the top level. Always use this extractor:

```bash
# Correct — navigate the envelope
ID=$(semantius-cli call crud postgrestRequest '{"method":"POST","path":"/campaigns","body":{...}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['response']['data'][0]['id'])")

# WRONG — treats response as a bare array, always fails with KeyError
ID=$(... | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
```

The same envelope applies to GET — use `d['response']['data']` to access the array:

```bash
COUNT=$(semantius-cli call crud postgrestRequest '{"method":"GET","path":"/campaigns?select=id"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['response']['data']))")
```

### Script pattern

```bash
#!/usr/bin/env bash
set -e

PG='semantius-cli call crud postgrestRequest'

echo "=== Seeding campaigns ==="
C_SPRING=$($PG '{"method":"POST","path":"/campaigns","body":{"campaign_name":"Spring Launch","status":"active"}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['response']['data'][0]['id'])")
C_FALL=$($PG '{"method":"POST","path":"/campaigns","body":{"campaign_name":"Fall Promo","status":"draft"}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['response']['data'][0]['id'])")
echo "  spring=$C_SPRING fall=$C_FALL"

echo "=== Seeding leads ==="
# Use captured IDs for FK fields — never assume sequential IDs
$PG "{\"method\":\"POST\",\"path\":\"/leads\",\"body\":{\"lead_name\":\"Jane Smith\",\"campaign_id\":$C_SPRING}}" > /dev/null
# ... etc ...
```

**Important for FK fields:** Capture IDs directly from each POST response — do not make a separate GET query to look them up by name. Filters with spaces (e.g. `?campaign_name=eq.Spring Launch`) require URL encoding; capturing from the POST response avoids this entirely.

**Enum safety — read the model, not your intuition:** Before writing any enum value into a seed record, look it up in the model's §5 enum tables for *that specific field*. Different fields on different entities may look similar but have different allowed values (e.g., `campaigns.type` includes `"Direct Mail"` but `leads.lead_source` does not — using the wrong one will fail with a check constraint error). Never guess or copy enum values across fields.

**String safety — ASCII only in seed data:** Do not use Unicode punctuation (em dash `—`, smart quotes `""`/`''`, ellipsis `…`) in seed strings. These characters break bash argument parsing when the script is executed. Use plain ASCII alternatives: `-` instead of `—`, `"` instead of `""`, etc.

Generate realistic data:
- Real-sounding names and emails (not "Test User 1")
- Enums: cycle through all valid model §5 values for that specific field so every value appears at least once
- Dates: realistic mix of past and future
- Numbers: plausible domain ranges
- Booleans: realistic mix

Run the complete script in one bash call and report the final output summary.

---

## Conflict Resolution Reference

| Conflict | Risk | Action |
|---|---|---|
| Module with same `system_slug` already exists | ✅ Low | `update_module` — never create a duplicate |
| Field `format` mismatch | 🛑 High | Skip (keep as-is), or require rename/analyst rethink |
| Entity label/description mismatch | ✅ Low | Offer `update_entity` (skip for built-ins) |
| Field title/description mismatch | ✅ Low | Offer `update_field` |
| `is_nullable` stricter in model | ⚠️ Medium | Warn, confirm before proceeding |
| `enum_values` differ | ⚠️ Medium | Offer update, warn about impact on existing records |
| Extra fields/entities not in model | None | Leave them alone |
| Model declares a built-in (`users`, `roles`, …) | None | Dedup: skip create, reuse built-in as `reference_table` target; never replace |
| Model declares extra fields on a built-in | ⚠️ Medium | Offer additive `create_field` with `is_nullable: true`; never modify existing built-in fields |
| **Cross-module exact-name collision** (entity with same `table_name` exists in another module) | 🛑 High — ambiguity gate | Stage 3 decision dialogue: merge / rename incoming / rename existing / rename both / abort. Never silently coexist. |
| **Similar-name collision** (root, synonym, qualifier, prefix/suffix) | 🛑 High — ambiguity gate | Same dialogue as above. User may decline, in which case record the decision and proceed. |
| Merge requires changing an immutable field format | 🛑 High | Merge is impossible — fall back to a rename option. |
| Existing-entity rename rejected by platform | 🛑 High | Stop. Offer "rename incoming" or "rename both" as fallback. Never continue silently. |
