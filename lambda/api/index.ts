import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApiError } from './errors';
import { json } from './http';
import { getMonth } from './handlers/getMonth';
import { getTemplates } from './handlers/getTemplates';
import { getTransaction } from './handlers/getTransaction';
import { getYear } from './handlers/getYear';
import { postPeriods } from './handlers/postPeriods';
import { postTransactions } from './handlers/postTransactions';

type Route = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Each method is declared individually in API Gateway (no {proxy+}), so
 * `event.resource` is the templated path and dispatch is a flat lookup.
 *
 * Authentication never reaches here: the Cognito authorizer runs before the
 * integration, so an unauthenticated request cannot produce a 404 or any other
 * status. That is what makes "403 takes precedence" true with no work in the handler.
 */
const ROUTES: Record<string, Route> = {
  'GET /api/months/{yearMonth}': getMonth,
  'GET /api/years/{year}': getYear,
  'GET /api/transactions/{id}': getTransaction,
  'GET /api/templates': getTemplates,
  'POST /api/periods': postPeriods,
  'POST /api/transactions': postTransactions,
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const key = `${event.httpMethod} ${event.resource}`;
  const route = ROUTES[key];

  if (!route) return json(404, { error: `no route for ${key}`, code: 'NOT_FOUND' });

  try {
    return await route(event);
  } catch (e) {
    if (e instanceof ApiError) {
      return json(e.status, { error: e.message, code: e.code, ...(e.detail ?? {}) });
    }
    // Never echo an AWS exception message to the client.
    console.error('unhandled error', e);
    return json(500, { error: 'internal server error', code: 'INTERNAL' });
  }
};
