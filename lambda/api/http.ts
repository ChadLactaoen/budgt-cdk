import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { badRequest } from './errors';

/**
 * No CORS headers: the SPA and the API share an origin via CloudFront's /api/*
 * behavior, so there is no preflight to answer.
 *
 * `no-store` keeps the in-app cache the only cache in the system.
 */
export function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export function readJsonBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body) throw badRequest('MALFORMED_BODY', 'request body is required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    throw badRequest('MALFORMED_BODY', 'request body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('MALFORMED_BODY', 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function pathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw badRequest('VALIDATION', `missing path parameter: ${name}`);
  return decodeURIComponent(value);
}
