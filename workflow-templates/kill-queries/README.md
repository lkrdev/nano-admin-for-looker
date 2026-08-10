# Kill Long-Running Queries Workflow Template

The `kill-queries` workflow template is a lightweight administrative tool designed to scan Looker for active running queries and automatically terminate any queries exceeding a specified runtime threshold.

It is designed to be mounted as an inline `card` directly on the main Control Center dashboard.

---

## Configuration Schema

Specify these properties under your workflow in the Looker project's `index.md` file:

- **`template`**: *(Required, string)* Must be `"kill-queries"`.
- **`mount_type`**: *(Optional, string)* Controls UI rendering mode (`"card"` or `"page"`). Defaults to `"card"`.
- **`parameters`**: *(Optional, object)*
  - **`min_runtime_seconds`**: *(Optional, number)* The runtime threshold in seconds. Active queries running longer than or equal to this threshold will be terminated. Defaults to `600` (10 minutes) if omitted.

---

## Example Configurations for `index.md`

### Example 1: Standard Query Terminator (Default 10 min / 600s threshold)

```yaml
workflows:
  - id: "kill_long_queries"
    label: "Kill Long-Running Queries"
    template: "kill-queries"
    mount_type: "card"
    authorized_groups:
      - "1" # Admin Group ID
    parameters:
      min_runtime_seconds: 600
```

### Example 2: Strict Query Terminator (5 min / 300s threshold)

```yaml
workflows:
  - id: "strict_query_terminator"
    label: "Terminate Queries Exceeding 5 Minutes"
    template: "kill-queries"
    mount_type: "card"
    authorized_groups:
      - "1"
      - "3"
    parameters:
      min_runtime_seconds: 300
```

---

## How It Works

1. **Scan**: Invokes the Looker SDK `all_running_queries()` method to fetch currently executing queries across the instance.
2. **Filter**: Filters queries where `runtime >= min_runtime_seconds`.
3. **Terminate**: Calls `kill_query(query_task_id)` for each qualifying query task.
4. **Report**: Returns a summary message indicating total running queries scanned, count of killed queries, and any error diagnostics.
