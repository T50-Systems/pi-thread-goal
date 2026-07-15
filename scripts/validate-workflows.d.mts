export function validateWorkflowFile(file: string): Promise<string[]>;
export function discoverWorkflowFiles(root?: string): Promise<string[]>;
export function validateWorkflows(
	root?: string,
): Promise<{ errors: string[]; files: string[] }>;
