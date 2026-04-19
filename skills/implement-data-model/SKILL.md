---
name: implement-data-model
description: Implement a *-data-model-prd.md file (produced by the data-model-analyst skill) into a live Semantius instance using the semantius-cli. Use this skill whenever a data-model PRD exists and the user wants to deploy, apply, or sync it to Semantius — even if they say "implement the model", "deploy the PRD", "apply the schema", "set up the entities", "create the entities in Semantius", "push this to Semantius", or "now make it real". Also use when the user uploads or references a *-data-model-prd.md and asks to do anything with a Semantius data model. Trigger proactively when a PRD file is present and the user's intent is clearly to materialize it.
---

# implement-data-model Skill

This skill bridges the gap between a semantic data model PRD (produced by the `data-model-analyst` skill) and a live Semantius instance.

**Division of responsibility:**
- This skill owns the *workflow* — parsing the PRD, inspecting what's already deployed, diffing, planning, and orchestrating the sequence of steps.
- The **semantius-cli skill** owns the *execution* — all Semantius operations are done via the `semantius-cli` CLI tool, following that skill's patterns and reference docs.

**This skill is designed to be re-run whenever the PRD changes.** Because it always inspects Semantius before acting, re-running it on an updated PRD is safe — it diffs the new PRD against what's already deployed and applies only the delta (new entities, new fields, updated labels/enums). Things that haven't changed are skipped. Things in Semantius that are no longer in the PRD are left alone.

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

## Stage 1: Parse the PRD

Locate the `*-data-model-prd.md` file. Extract:

- **`system_slug`** from YAML frontmatter — this is the module name
- **Human-readable system name** — from the `# ... Data Model PRD` heading
- **Entity list** — from the entity summary table (§4), in order
- **Per-entity details** from each entity subsection (§5):
  - `table_name`, `singular`, `plural`, `singular_label`, `plural_label`, `description`, `label_column`
  - Fields: `field_name`, `format`, required, `title` (= Label column), reference targets, delete modes
  - Enum values from §7
- **Relationship table** (§6) — confirms `reference_delete_mode` for each FK field
- **Implementation notes** (§9 if present) — always follow these

### PRD-to-Field Mapping

| PRD column | `create_field` parameter |
|---|---|
| Field name | `field_name` |
| Format | `format` |
| Label | `title` |
| Required = yes | `is_nullable: false` |
| Required = no | `is_nullable: true` |
| → `table` | `reference_table` |
| Delete mode from §6 | `reference_delete_mode` |
| Enum values from §7 | `enum_values` |

### Fields That Are Auto-Generated — Never Create These

`create_entity` automatically creates these — skip them when iterating over PRD fields:

- `id`, `label`, `created_at`, `updated_at`
- The field named in `label_column` (auto-created with `ctype: label`)

> **Title correction:** The auto-created `label_column` field gets its title from `singular_label`. If the PRD specifies a different title for that field, use `update_field` to fix it after entity creation.

### Self-References

Fields that reference their own entity (e.g., `campaign.parent_campaign_id → campaigns`) must be created in a second pass after all entities exist. Flag them during parsing.

---

## Stage 2: Inspect What Exists in Semantius

**Read before writing — always.** (semantius-cli Golden Rule #1)

For each item **named in the PRD**, check whether it exists — nothing more. Do not scan Semantius for anything outside the PRD's scope.

```bash
# Does the module exist?
semantius-cli call crud read_module '{"filters": "module_name=eq.<system_slug>"}'

# Does this specific entity exist?
semantius-cli call crud read_entity '{"filters": "table_name=eq.<table_name>"}'

# Does this specific permission exist?
semantius-cli call crud read_permission '{"filters": "permission_name=eq.<slug>:read"}'

# Does this specific field exist?
semantius-cli call crud read_field '{"filters": "table_name=eq.<table_name>&field_name=eq.<field_name>"}'
```

Classify each PRD item into one of three buckets:

| Bucket | Meaning | Action |
|---|---|---|
| ✅ Already correct | Exists and matches PRD | Skip |
| ✨ Will create | Doesn't exist yet | Create |
| ⚠️ Conflict | Exists but differs from PRD | Flag for user |

**What to compare when something already exists:**

| Property | Risk | Notes |
|---|---|---|
| Field `format` | 🛑 High — **immutable** | Cannot be changed after creation |
| Field `is_nullable` (PRD is stricter) | ⚠️ Medium | May fail if nulls already exist |
| Field `enum_values` | ⚠️ Medium | Changing values may affect existing records |
| Entity labels, descriptions | ✅ Low | Safely updatable |
| Field `title`, `description` | ✅ Low | Safely updatable |

---

## Stage 3: Plan and Present

Before running any `create_*` commands, show the user a clear plan:

```
📦 Module: lead_manager
  ✅ Already exists (ID: 12) — will reuse

🔑 Permissions:
  ✅ lead_manager:read — exists
  ✨ lead_manager:manage — will create

🗂 Entities (5 total):
  ✨ user — will create + 7 fields
  ✅ campaign — exists, 0 conflicts (all 12 fields match)
  ⚠️  lead — exists with 1 conflict:
       Field `status`: format is `string` in Semantius, PRD requires `enum`
       format is immutable — options:
         (a) Skip this field (keep existing string field as-is)
         (b) Abort implementation
  ✨ campaign_member — will create + 5 fields
  ✨ task — will create + 7 fields

Total to create: 1 permission, 3 entities, ~32 fields
```

Wait for the user to acknowledge the plan and resolve any conflicts before proceeding.

**Exception:** If there are zero conflicts and nothing already exists, proceed immediately: "No existing model found — creating everything from scratch now."

---

## Stage 4: Execute

Follow the semantius-cli mandatory creation order exactly:

```
Module → Permissions → Entities → Fields (per entity, in PRD order)
```

Refer to `semantius-cli/references/data-modeling.md` for the exact CLI syntax for each operation. The key sequence:

**4a. Module** — `read_module` to check, `create_module` if missing.

**4b. Permissions** — Create `<slug>:read` and `<slug>:manage` before any entity.

**4c. Entities** — `create_entity` for each ✨ entity, in PRD §4 order. After creating, correct the `label_column` field title if needed with `update_field`.

**4d. Fields** — `create_field` for each ✨ field (skipping auto-generated ones), in PRD field order. Always include `width: "default"` and `input_type: "default"`.

**Second pass** — After all entities exist, create any self-reference fields.

After each entity's fields are done, share the UI link:
`https://tests.semantius.app/<module_name>/<table_name>`

---

## Stage 5: Verify

After all creates are done:

1. `read_entity` on each entity — confirm `label_column` is set
2. `read_field` per entity — confirm field count matches PRD (minus auto-generated)
3. Spot-check that `reference_table` targets exist for FK fields

Print a final summary: "✅ Done. Created 1 module, 2 permissions, 5 entities, 47 fields."

---

## Stage 6: Sample Data

After verification, ask:

> "The `<SystemName>` model is live in Semantius ✅  
> Would you like me to generate 10 realistic sample records for each entity?"

If the user says yes, create records in dependency order (entities with no parent FKs first, junction tables last — the PRD §4 order is usually correct).

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

**Enum safety — read the PRD, not your intuition:** Before writing any enum value into a seed record, look it up in the PRD's §7 enum tables for *that specific field*. Different fields on different entities may look similar but have different allowed values (e.g., `campaigns.type` includes `"Direct Mail"` but `leads.lead_source` does not — using the wrong one will fail with a check constraint error). Never guess or copy enum values across fields.

**String safety — ASCII only in seed data:** Do not use Unicode punctuation (em dash `—`, smart quotes `""`/`''`, ellipsis `…`) in seed strings. These characters break bash argument parsing when the script is executed. Use plain ASCII alternatives: `-` instead of `—`, `"` instead of `""`, etc.

Generate realistic data:
- Real-sounding names and emails (not "Test User 1")
- Enums: cycle through all valid PRD §7 values for that specific field so every value appears at least once
- Dates: realistic mix of past and future
- Numbers: plausible domain ranges
- Booleans: realistic mix

Run the complete script in one bash call and report the final output summary.

---

## Conflict Resolution Reference

| Conflict | Risk | Action |
|---|---|---|
| Field `format` mismatch | 🛑 High | Skip (keep as-is) or abort |
| Entity label/description mismatch | ✅ Low | Offer `update_entity` |
| Field title/description mismatch | ✅ Low | Offer `update_field` |
| `is_nullable` stricter in PRD | ⚠️ Medium | Warn, confirm before proceeding |
| `enum_values` differ | ⚠️ Medium | Offer update, warn about impact on existing records |
| Extra fields/entities not in PRD | None | Leave them alone |
