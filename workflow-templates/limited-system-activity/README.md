# Limited System Activity Workflow Template

This workflow template allows Nano Admin to expose a controlled slice of Looker's built-in `system__activity` model with enforced user access boundaries and resource performance presets.

## Features

- **AllowList of Explores**: Restricts user access strictly to configured explores under `system__activity`.
- **Explore-specific CSV Export**: Optional CSV export button per explore.
- **Performance Presets**:
  - `required_filter_fields`: Array of specific field(s) required to be filtered before query execution (e.g. `["history.created_time"]`).
  - `max_row_limit`: Automatically caps query row limits.
- **Enforced User ID Filtering**:
  - Automatically injects the appropriate user ID filter field into all executed queries based on:
    - `"own"`: Filters to the current user's Looker User ID.
    - `"tenant_groups"`: Filters to all user IDs belonging to group(s) the current user is in that have the specified user attribute (default: `tenant`) set to `"yes"`.

---

## Canonical User ID Field Mapping Table

When `user_id_limitation` is enabled, queries against each `system__activity` explore are automatically filtered using the corresponding canonical dimension field listed below:

| Explore Name | Canonical User ID Filter Field | Description |
| :--- | :--- | :--- |
| `history` | `history.user_id` | Query execution logs & runtime history |
| `dashboard` | `dashboard.user_id` | Dashboard metadata & view activity |
| `dashboard_performance` | `dashboard_performance.user_id` | Dashboard tile render performance & load times |
| `look` | `look.user_id` | Saved Look metadata & ownership |
| `event` | `event.user_id` | User activity events & session logs |
| `event_attribute` | `event.user_id` | Event attribute metadata & activity logs |
| `query` | `user.id` | Query definitions & model metadata |
| `query_metrics` | `query_metrics.user_id` | Query execution metric breakdowns |
| `sql_query` | `sql_query.user_id` | Raw SQL query execution records |
| `scheduled_plan` | `scheduled_plan.user_id` | Scheduled delivery plans & destinations |
| `conversation` | `conversation.user_id` | Conversational & chat interaction logs |
| `user` | `user.id` | User accounts & status metadata |
| `user_attribute` | `user.id` | User attribute values & group assignments |
| `group` | `user.id` | Group memberships & user inclusions |
| `merge_query` | `merge_query.user_id` | Merged query execution definitions |

*Note: For any custom or unlisted explores, the handler uses heuristic dimension discovery (`*.user_id` or `user.id`).*

---

## Parameters Schema

```yaml
parameters:
  explores:
    - name: "history"
      allow_csv_export: true
      required_filter_fields:
        - "history.created_time"
      max_row_limit: 500
    - name: "dashboard"
      allow_csv_export: false
      max_row_limit: 200
  user_id_limitation:
    enabled: true
    mode: "tenant_groups" # "own" or "tenant_groups"
    attribute_name: "tenant"
```
