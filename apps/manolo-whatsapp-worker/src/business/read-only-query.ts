const MAX_QUERY_LENGTH = 12_000;
const FORBIDDEN_SQL_KEYWORDS =
  /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|UPSERT|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE|COPY|CALL|DO|GRANT|REVOKE)\b/i;

export type QueryValidationResult =
  | { valid: true; query: string }
  | { valid: false; reason: string };

export function validateReadOnlySelect(query: string): QueryValidationResult {
  const normalized = query.trim();

  if (!normalized) return { valid: false, reason: "empty_query" };
  if (normalized.length > MAX_QUERY_LENGTH) {
    return { valid: false, reason: "query_too_large" };
  }
  if (/--|\/\*|\*\//.test(normalized)) {
    return { valid: false, reason: "sql_comments_not_allowed" };
  }

  const withoutTrailingSemicolon = normalized.endsWith(";")
    ? normalized.slice(0, -1).trim()
    : normalized;
  if (withoutTrailingSemicolon.includes(";")) {
    return { valid: false, reason: "multiple_statements_not_allowed" };
  }
  if (!/^SELECT\b/i.test(withoutTrailingSemicolon)) {
    return { valid: false, reason: "select_only" };
  }
  if (FORBIDDEN_SQL_KEYWORDS.test(withoutTrailingSemicolon)) {
    return { valid: false, reason: "write_or_admin_keyword_not_allowed" };
  }

  return { valid: true, query: withoutTrailingSemicolon };
}
