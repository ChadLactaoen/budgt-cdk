import type { CategoryId } from '../../shared/categories';
import type { FundId } from '../../shared/funds';

export interface PeriodItem {
  PK: string; SK: string; GSI1PK: string; GSI1SK: string;
  amt: number;
  memo: string;
  type: 'PERIOD';
}

export interface AllocationItem {
  PK: string; SK: string;
  cat: CategoryId;
  amt: number;
  type: 'ALLOCATION';
}

export interface TransactionItem {
  PK: string; SK: string; GSI1PK: string; GSI1SK: string;
  td: string;
  nm: string;
  cat: CategoryId;
  amt: number;
  src?: FundId;
  memo?: string;
  type: 'TRANSACTION';
}

export interface FundItem {
  PK: string; SK: string;
  bal: number;
  dep: number;
  wd: number;
  type: 'FUND';
}

export interface TemplateItem {
  PK: string; SK: string;
  /** The template's own label, e.g. "Mortgage". `nm` is the payee it fills in. */
  tn: string;
  nm: string;
  amt: number;
  cat: CategoryId;
  active: boolean;
  type: 'TEMPLATE';
}
