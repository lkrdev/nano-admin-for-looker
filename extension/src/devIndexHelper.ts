export interface DevIndexFetchResult {
  content: string;
  notice: string | null;
}

/**
 * Attempts to read the user's development index.md file via Looker's Extension SDK
 * (coreSDK.project_file('nano_admin', 'index.md')) without backend workspace switching.
 */
export async function fetchDevIndexMdContent(
  coreSDK: any,
  addLog?: (msg: string) => void
): Promise<DevIndexFetchResult> {
  if (addLog) {
    addLog('Fetching index.md via coreSDK.project_file("nano_admin", "index.md")...');
  }

  let content = '';
  let notice: string | null = null;

  try {
    const rawFile = await coreSDK.ok(
      coreSDK.project_file('nano_admin', 'index.md') as any
    );
    if (typeof rawFile === 'string') {
      content = rawFile;
    } else if (rawFile && typeof rawFile === 'object') {
      content = (rawFile as any).content || (rawFile as any).value || '';
    }
  } catch (sdkErr: any) {
    const errMsg = sdkErr?.message || String(sdkErr);
    if (addLog) {
      addLog(`Notice: Extension SDK project_file fetch returned: ${errMsg}`);
    }
    notice = `Could not automatically read index.md via Extension SDK (${errMsg}). Please paste your index.md contents below.`;
  }

  if (!content || !content.trim()) {
    return {
      content: '',
      notice:
        notice ||
        'Looker project_file returned file metadata without raw content. Please paste your index.md contents below.'
    };
  }

  return { content, notice: null };
}
