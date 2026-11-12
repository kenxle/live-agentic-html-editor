/*
 * read-when: Changing the HTTP status a failure code answers with, or the shape of an error answer.
 */

import { failure } from "./failures.ts";
import type { FailureCode, FailureDetail } from "./failures.ts";
import type { CheckName } from "./request-checks.ts";

type StatusCode = Extract<FailureCode, `PROTO_${string}`> | "AUTH_REFUSED" | "SUMMARY_VERSION";

const STATUS: { readonly [Code in StatusCode]: number } = {
  PROTO_BAD_REQUEST: 400,
  PROTO_BAD_HOST: 400,
  PROTO_MISSING_CUSTOM_HEADER: 400,
  PROTO_UNSUPPORTED_MEDIA_TYPE: 415,
  PROTO_UNAUTHORIZED: 401,
  PROTO_FORBIDDEN_ORIGIN: 403,
  PROTO_UNKNOWN_REVIEW: 404,
  PROTO_UNKNOWN_ITEM: 404,
  PROTO_STALE_REV: 409,
  PROTO_REVIEW_RETIRED: 410,
  PROTO_NOT_OWNER: 403,
  PROTO_SECOND_WINDOW: 409,
  PROTO_SECOND_INSTANCE: 409,
  PROTO_CROSS_SITE: 403,
  PROTO_NOT_OPENABLE: 409,
  PROTO_REQUEST_PENDING: 409,
  PROTO_QUEUE_FULL: 429,
  PROTO_NO_AGENT: 409,
  PROTO_CONFIRM_NEEDED: 409,
  PROTO_NO_LAUNCH: 409,
  PROTO_CATALOG_UNREADABLE: 500,
  AUTH_REFUSED: 401,
  SUMMARY_VERSION: 409
};

function hasStatus(code: string): code is StatusCode {
  return Object.hasOwn(STATUS, code);
}

export function statusFor(code: string): number {
  return hasStatus(code) ? STATUS[code] : 500;
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly remedy: string | null;
    readonly detail: FailureDetail | null;
    readonly check: CheckName | null;
    readonly request_id: string | null;
  };
}

export function errorBody(
  code: FailureCode,
  detail?: FailureDetail | null,
  requestId?: string | null,
  check?: CheckName | null
): ErrorBody {
  const failed = failure(code, detail);
  return {
    error: {
      code: failed.code,
      message: failed.message,
      remedy: failed.remedy,
      detail: failed.detail,
      check: check ?? null,
      request_id: requestId === undefined || requestId === "" ? null : requestId
    }
  };
}
