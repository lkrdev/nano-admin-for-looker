# Workflow Groups Manager Template

The `workflow-groups-manager` workflow template provides Looker administrators with a centralized dashboard to audit, provision, and manage **Scope Groups** and **Workflow Access Controls**.

---

## Key Concepts & Terminology

### 1. Scope Groups
- **Purpose**: Defines group-based data or tenant boundaries (e.g. multi-tenant isolation, department permissions) controlling what data an invoking user can see inside workflows.
- **Default Attribute Name**: `nano_admin_is_workflow_scope_group` (boolean `"yes"`/`"no"` set on Looker Groups).
- **Multi-Attribute Support**: Automatically discovers custom attribute names configured across workflows in `index.md` (e.g. `tenant`, `department_scope`).

### 2. Workflow Access
- **Purpose**: Restricts who can view and execute specific workflows.
- **Configuration**: Defined via `authorized_groups` in `index.md`.

---

## Audit & Setup Health Capabilities

### Landing Setup Health Checks
The landing page focuses on incomplete or missing setup items requiring action:
1. **Compatible Workflows**: Verifies workflows of compatible template types (e.g. `limited-system-activity`) exist in `index.md`.
2. **Active Scope Workflows**: Checks if any workflow enables `tenant_groups` mode.
3. **User Attribute Definition**: Audits if scope group user attributes exist in Looker.
4. **Group Tagging**: Checks if Looker groups are tagged with scope user attributes.
5. **Active Scope Groups**: Verifies at least one group has attribute set to `'yes'`.
6. **User Scope Assignment**: Confirms users belong to active scope groups.
7. **Authorization Group Restrictions**: Audits `authorized_groups` usage across `index.md`.
8. **Authorization Group Validation**: Flags invalid group IDs referenced in `index.md`.
9. **Empty Authorization Groups**: Flags authorization groups with 0 assigned members.

### Scope Audit Features
- **User-Level Misconfiguration Alerts**: Flags any scope attribute set directly on individual users (`user_id`) instead of Looker Groups (`group_id`) with 1-click cleanup.
- **Drillable User Scope Counts**: Categorizes active users into **0 Scope Groups** (unscoped), **1 Scope Group** (isolated), and **2+ Scope Groups** (overlapping).

---

## Configuration Example (`index.md`)

```yaml
workflows:
  - id: "workflow-groups-manager"
    label: "Workflow Groups Manager"
    description: "Audit and administer Looker Scope Groups and Workflow Access."
    template: "workflow-groups-manager"
    authorized_groups:
      - "1"
    parameters:
      default_attribute_name: "nano_admin_is_workflow_scope_group"
```
