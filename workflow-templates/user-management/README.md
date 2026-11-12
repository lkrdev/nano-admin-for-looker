# User Management Workflow Template (`user-management`)

The `user-management` workflow template provides a comprehensive, scope-aware delegated user administration experience. Unlike the generic `crud` template, `user-management` is purpose-built for managing both the core Looker user record and its related entities—**Group memberships, Role assignments, User Attribute values, Folder/Content access, Credentials/Sessions, and User-scoped Telemetry & Scheduled Plans**—while enforcing strict anti-escalation boundaries.

---

## Key Security & Anti-Escalation Principles

1. **Least-Privilege Defaults**: Every mutation toggle (`allow_create`, `allow_update_name`, `allow_update_email`, `allow_disable`, `allow_delete`, `groups.allow_edit`, `roles.allow_edit`, `user_attributes.allow_edit`, `folder_access.allow_edit`, `telemetry.allow_manage_schedules`, and all `credentials.*` flags) defaults to `false` when omitted.
2. **Scope Group Isolation (`user_id_limitation`)**:
   - Defaults to `mode: "scope_groups_minus_privileged"` (using `nano_admin_is_workflow_scope_group` unless overridden), which restricts visibility and mutations to users in the invoking admin's active Scope Groups while automatically excluding Looker Admin accounts and Service Accounts.
   - Other supported modes: `"scope_groups"`, `"exclude_privileged"`, `"self"`, and `"none"`.
   - When creating a new user (`profile.allow_create: true`), the user must be assigned to at least one of the invoking admin's active Scope Groups. The backend adds the user to the selected Scope Group(s) immediately after `create_user` so partial failures never leave a user orphaned outside the admin's scope.
   - Removing a user from their final shared Scope Group displays a UI warning before execution.
3. **Subgroup Hierarchy Scoping (`groups`)**:
   - Uses `search_groups_with_hierarchy` to resolve all direct and indirect child groups (unlimited hops) of the invoking admin's active Scope Groups.
   - Delegated admins can only modify user memberships in their active Scope Groups and those descendant child groups.
4. **Role Subsetting & Safe Replacement (`roles`)**:
   - Assignable roles must have permissions and models that are a subset of the invoking admin's own effective permissions and models, and can never include `all_access` / `administer` (Looker Admin) roles.
   - If `allowed_role_ids` is configured, assignable roles are further restricted to that allowlist.
   - When saving direct roles (`set_user_roles`), any existing out-of-scope direct roles on the target user are preserved untouched.
5. **User Attribute Precedence & Value Rules (`user_attributes`)**:
   - Nano-Admin internal challenge attributes (`nano_admin_challenge`, `nano_admin_admin_extension_nano_admin_challenge`), Scope Group attributes, and Looker `is_system` attributes are always hard-blocked.
   - `blocked_attributes` always takes precedence over `allowed_attributes`.
   - Each allowed attribute can enforce `rule: "any"`, `rule: "allowed_values"` (with `values: [...]`), `rule: "must_match_admin"` (also enforced on user creation), or `rule: "must_match_scope_group"` (must match one of the group values assigned to the admin's active Scope Groups).
   - Hidden user attributes (`value_is_hidden: true`) are supported as write-only inputs when allowed.
6. **Folder Access Capping (`folder_access`)**:
   - Manageable folders are scoped to folders where the admin's active Scope Groups already have access, plus their descendant subfolders.
   - Direct user grants (`view` or `edit`) are only permitted on folders with custom access (`inherits: false`), and the grantable permission level is capped at the highest permission held by the admin's Scope Groups on that folder.
7. **Credential & Session Safety (`credentials`)**:
   - API3 credentials are completely excluded to prevent credential impersonation.
   - Password resets exclusively use `send_user_credentials_email_password_reset` (never returning reset URLs to the browser).
   - Changing an existing user's email address (`profile.allow_update_email`) is disabled by default (`false`).

---

## Example Configuration (`index.md`)

```yaml
workflows:
  - id: "department-user-admin"
    label: "Department User Management"
    description: "Manage department users, group memberships, roles, attributes, folder access, and schedules."
    template: "user-management"
    authorized_groups:
      - "10"
    parameters:
      user_id_limitation:
        mode: "scope_groups_minus_privileged"
        attribute_name: "nano_admin_is_workflow_scope_group"
      profile:
        allow_create: false
        allow_update_name: true
        allow_update_email: false
        allow_disable: true
        allow_delete: false
      credentials:
        allow_email_credentials: false
        allow_password_reset: true
        allow_totp_reset: true
        allow_session_revoke: true
      groups:
        allow_view: true
        allow_edit: true
      roles:
        allow_view: true
        allow_edit: true
        allowed_role_ids: []
      user_attributes:
        allow_view: true
        allow_edit: true
        blocked_attributes:
          - "internal_cost_center"
        allowed_attributes:
          - name: "department"
            rule: "must_match_scope_group"
          - name: "region"
            rule: "must_match_admin"
          - name: "data_tier"
            rule: "allowed_values"
            values: ["standard", "restricted"]
      folder_access:
        allow_view: true
        allow_edit: true
      telemetry:
        allow_view_metrics: true
        allow_manage_schedules: true
```
