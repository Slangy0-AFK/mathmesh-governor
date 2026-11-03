export async function reportFunctionError(functionName: string, error: unknown): Promise<void> {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'function_error',
    function: functionName,
    error_type: errorType,
  }));

}