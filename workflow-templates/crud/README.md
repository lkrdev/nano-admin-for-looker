# CRUD Workflow Template

The `crud` workflow template is a highly generic, reusable administrative tool designed to execute basic CRUD (Create, Read, Update, Delete) operations against key Looker resources. 

By defining different configurations in your Looker project's `index.md` file, you can instantiate multiple instances of this workflow (e.g., one for managing folders, and another restricted only to auditing database connections).

---

## Supported Looker Objects & Constraints

Looker's API enforces specific limitations depending on the type of object. The `crud` template supports 12 Looker resource types and enforces Looker's mutation/mutability rules:

| Target Object (`target_object`) | Description | Allowed Operations | ID Type / Key | Notes / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `users` | Looker Users | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `groups` | Looker Groups | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `roles` | Roles & Permission Sets | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `connections` | Database Connections | `list`, `read`, `create`, `update`, `delete` | string (Name) | Fully mutable. Unique name acts as ID. |
| `folders` | Content Folders | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `looks` | Saved Look Reports | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `dashboards` | Looker Dashboards | `list`, `read`, `create`, `update`, `delete` | string (ID / Name) | Fully mutable. |
| `scheduled_plans` | Scheduled Exports | `list`, `read`, `create`, `update`, `delete` | numeric string (ID) | Fully mutable. |
| `queries` | Looker SQL Queries | `read`, `create` | numeric string (ID) | **Immutable**. Queries cannot be updated or deleted after creation. |
| `permissions` | System Permissions | `list` | None | **Read-Only**. List of all available system privileges. |
| `content_metadata` | Content Permissions | `read`, `update` | numeric string (ID) | Restricted. Governs folder and content access. Cannot be created or deleted directly. |

---

## Configuration Schema

Specify these top-level workflow parameters under your workflow in the `index.md` file:

- **`id`**: *(Required, string)* Unique identifier for the workflow instance.
- **`label`**: *(Required, string)* Human-readable title displayed on the workflow card and navigation header.
- **`description`**: *(Optional, string)* Custom description text that overrides the default card description. If omitted, a default description is auto-generated based on the target object (e.g., `"Manage <target_object> records and settings."`).
- **`template`**: *(Required, string)* Must be `"crud"`.
- **`authorized_groups`**: *(Optional, array of strings)* Looker group IDs authorized to view/run this workflow.
- **`parameters`**: *(Required, object)* Container for template-specific parameters:
  - **`target_object`**: *(Required, string)* The Looker resource type. Must be one of the 12 types listed in the table above.
  - **`supported_operations`**: *(Required, array)* A list of allowed actions. Must be a subset of the allowed operations for that resource type. Supported names: `list`, `read`, `create`, `update`, `delete`. Each item in the array supports:
    - `name`: *(Required, string)* The action name.
    - `fields`: *(Optional, array of strings)* A whitelist of fields to request from the Looker API. Use `["*"]` or omit to request default fields.
    - `values`: *(Optional, key-value object)* Forced default properties merged into the payload during `create` or `update` operations (useful for enforcing compliance).

---

## Example Configurations for `index.md`

### Example 1: User Provisioning and Auto-Disabler Tool (With Custom Description)
This workflow allows listing and creating users with an explicit custom `description` provided in the `index.md` declaration to override the default card description. For security compliance, any user created through this interface is forced to be initially disabled (`is_disabled: true`), and administrators are only allowed to update the `is_disabled` status.

```yaml
workflows:
  - id: "user_manager"
    label: "Compliance User Manager"
    description: "Manage employee account statuses and compliance disabling."
    template: "crud"
    authorized_groups:
      - "1" # Admins group
    parameters:
      target_object: "users"
      supported_operations:
        - name: "list"
          fields: ["id", "display_name", "email", "is_disabled"]
        - name: "read"
          fields: ["id", "first_name", "last_name", "email", "is_disabled"]
        - name: "create"
          values:
            is_disabled: true
        - name: "update"
          fields: ["is_disabled"]
```

### Example 2: Database Connection Auditor (Read-Only, Omitted Description)
This workflow allows auditing available database connections but blocks any mutations. Notice that the `description` field is omitted here, so the frontend automatically generates the fallback description (`"Manage connections records and settings."`).

```yaml
workflows:
  - id: "connection_auditor"
    label: "Database Connection Auditor"
    template: "crud"
    authorized_groups:
      - "1"
    parameters:
      target_object: "connections"
      supported_operations:
        - name: "list"
          fields: ["name", "dialect_name", "host", "port", "database"]
        - name: "read"
```


