import { fetchAuthSession } from 'aws-amplify/auth';
import type { CategoryId } from '@shared/categories';
import type { FundId } from '@shared/funds';

/** Same origin: CloudFront routes /api/* to API Gateway, so there is no CORS. */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Transaction {
  id: string;
  td: string;
  nm: string;
  cat: CategoryId;
  amt: number;
  src?: FundId;
  memo: string;
}

export interface Allocation {
  cat: CategoryId;
  amt: number;
}

export interface Fund {
  id: FundId;
  bal: number;
  dep: number;
  wd: number;
}

export interface MonthResponse {
  period: { yearMonth: string; amt: number; memo: string };
  allocations: Allocation[];
  transactions: Transaction[];
  funds: Fund[];
}

export interface YearResponse {
  year: string;
  periods: Array<{ yearMonth: string; amt: number; memo: string }>;
  transactions: Transaction[];
  funds: Fund[];
  truncated: boolean;
}

export interface Template {
  id: string;
  nm: string;
  amt: number;
  cat: CategoryId;
  active: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new ApiError(403, 'NOT_AUTHENTICATED', 'Not signed in');

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // The API Gateway Cognito authorizer expects the bare ID token.
      Authorization: token,
      ...(init?.headers ?? {}),
    },
  });

  // A parse failure is only tolerable on the error path, where an empty body is
  // legitimate. On a 2xx it means the response was never our API — the dev server
  // answering /api with index.html, say — and returning `{}` here would hand the
  // caller an object typed as the success shape with every field undefined.
  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    if (res.ok) {
      throw new ApiError(res.status, 'MALFORMED_RESPONSE', 'The server returned an unreadable response.');
    }
    body = {};
  }

  if (!res.ok) {
    const { error, code, ...detail } = body as Record<string, unknown>;
    throw new ApiError(
      res.status,
      typeof code === 'string' ? code : 'UNKNOWN',
      typeof error === 'string' ? error : `Request failed (${res.status})`,
      detail,
    );
  }
  return body as T;
}

export const api = {
  getMonth: (yearMonth: string) => request<MonthResponse>(`/months/${yearMonth}`),
  getYear: (year: string) => request<YearResponse>(`/years/${year}`),
  getTemplates: () => request<{ templates: Template[] }>('/templates'),
  getTransaction: (id: string) => request<Transaction>(`/transactions/${encodeURIComponent(id)}`),

  savePeriod: (body: {
    yearMonth: string;
    amt: number;
    memo?: string;
    allocations: Allocation[];
  }) => request<MonthResponse['period'] & { allocations: Allocation[] }>('/periods', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  /** Returns the canonical transaction. The `id` may differ from the one sent, since it encodes `td`. */
  saveTransaction: (body: Partial<Transaction> & { td: string; nm: string; cat: CategoryId; amt: number }) =>
    request<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(body) }),
};
