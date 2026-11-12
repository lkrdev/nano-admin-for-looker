# Group Owners Workflow Template (`group-owners`)

The `group-owners` workflow template enables delegated onboarding and membership management for Looker Groups without exposing user profile, credential, or attribute mutations.

## Ownership Model

- **Target-Group User Attribute**: Ownership is stored on the target Looker Group via a User Attribute (default: `nano_admin_group_owners`).
- **Canonical Specifier Format**: Group attribute values use the strict canonical comma-separated format `u:<user_id>,g:<group_id>` (e.g., `u:1,g:10`), where `u:<id>` grants ownership to a specific Looker user and `g:<id>` grants ownership to all members of that Looker group.
- **Subgroup Inheritance**: When `include_subgroups: true` (default), owners of a parent group can also view and manage its descendant child subgroups via an expandable table view.
- **User Discovery Limitation (`user_id_limitation`)**:
  - Defaults to `mode: "exclude_privileged"`, allowing group owners to search and onboard any non-privileged Looker user (automatically excluding Looker Admins and Service Accounts).
  - Also supports `"scope_groups_minus_privileged"`, `"scope_groups"`, `"self"`, and `"none"`.

## Example Configuration (`index.md`)

```yaml
workflows:
  - id: "group-owners-onboarding"
    label: "Group Owners & Onboarding"
    template: "group-owners"
    authorized_groups:
      - "3"
    parameters:
      ownership_attribute_name: "nano_admin_group_owners"
      include_subgroups: true
      user_id_limitation:
        mode: "exclude_privileged"
      memberships:
        allow_add_users: true
        allow_remove_users: true
        allow_edit_owners: true
        allow_add_existing_groups: false
        allow_remove_child_groups: false
        allow_create_subgroups: false
```
