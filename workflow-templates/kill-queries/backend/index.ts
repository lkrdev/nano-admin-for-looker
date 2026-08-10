export interface WorkflowContext {
  sdk: any;
  userId: string;
  workflowId: string;
  parameters: {
    min_runtime_seconds?: number;
  };
}

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any
): Promise<any> => {
  const sdk = context.sdk;
  const minRuntime = Number(context.parameters?.min_runtime_seconds || 600);

  if (action === 'kill_long_running') {
    console.log(`[Kill-Queries Backend] Fetching active queries running longer than ${minRuntime}s...`);
    const runningQueries = await sdk.ok(sdk.all_running_queries());
    
    const longRunning = (runningQueries || []).filter((q: any) => (q.runtime || 0) >= minRuntime);
    const killed: string[] = [];
    const errors: string[] = [];

    for (const q of longRunning) {
      const taskId = q.query_task_id || q.id;
      if (taskId) {
        try {
          await sdk.ok(sdk.kill_query(taskId));
          killed.push(taskId);
        } catch (err: any) {
          console.error(`Failed to kill query task ${taskId}:`, err);
          errors.push(taskId);
        }
      }
    }

    return {
      message: killed.length > 0 
        ? `Successfully terminated ${killed.length} query(s) running longer than ${minRuntime}s.` 
        : `No active queries found exceeding ${minRuntime}s runtime threshold.`,
      min_runtime_seconds: minRuntime,
      total_running: runningQueries?.length || 0,
      killed_count: killed.length,
      killed_tasks: killed,
      errors_count: errors.length
    };
  }

  throw new Error(`Unknown or unsupported action "${action}" for kill-queries workflow.`);
};
