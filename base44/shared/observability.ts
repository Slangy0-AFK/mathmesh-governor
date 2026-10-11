import * as Sentry from 'npm:@sentry/deno@9';
import { secrets } from 'base44:runtime';

let sentryInitialized = false;

export async function reportFunctionError(functionName: string, error: unknown): Promise<void> {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'function_error',
    function: functionName,
    error_type: errorType,
  }));

  const dsn = secrets.get('SENTRY_DSN');
  if (!dsn) return;

  try {
    if (!sentryInitialized) {
      Sentry.init({
        dsn,
        environment: secrets.get('APP_ENV') || 'production',
        sendDefaultPii: false,
        tracesSampleRate: 0,
      });
      sentryInitialized = true;
    }
    Sentry.withScope((scope) => {
      scope.setTag('function', functionName);
      Sentry.captureException(error);
    });
    await Sentry.flush(1500);
  } catch {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'sentry_delivery_failed',
      function: functionName,
    }));
  }
}