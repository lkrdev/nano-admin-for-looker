# CRUD Workflow Template

This is a generic CRUD (Create, Read, Update, Delete) workflow template that allows interacting with Looker administrative entities.

## Configuration Parameters

- `target_object`: (Required) The type of Looker objects (e.g. `users`, `connections`).
- `supported_operations`: (Required) List of allowed operations. Each operation configuration specifies:
  - `name`: Operation name (`list`, `read`, `create`, `update`, `delete`).
  - `fields`: Array of strings specifying allowed fields or `["*"]` for all.
  - `values`: (Optional) Constant values to apply on write operations (e.g. `{ "is_disabled": true }` to force disabled state).
