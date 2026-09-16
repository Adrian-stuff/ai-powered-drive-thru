/**
 * The conformance kit's core. Checks are plain async functions that throw on
 * violation — not `it()` blocks — so the kit runs under any test runner, and
 * so the kit itself can be tested (see `test/conformance-kit.test.ts`, which
 * asserts that deliberately broken fakes fail the checks they should fail).
 */

export interface CheckResult {
  readonly name: string;
  /** What contract obligation this check enforces, for the failure report. */
  readonly obligation: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly detail?: string;
  readonly durationMs: number;
}

export interface ConformanceReport {
  readonly port: string;
  readonly providerId: string;
  readonly results: readonly CheckResult[];
  readonly ok: boolean;
}

export interface Check<T> {
  readonly name: string;
  readonly obligation: string;
  run(subject: T): Promise<void>;
}

/**
 * Thrown by a check that does not apply to this provider — e.g. the partials
 * check against a provider that declares `supportsPartials: false`. A skip is
 * not a pass; the report distinguishes them, because "we never tested it" and
 * "it works" are different facts.
 */
export class CheckSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CheckSkipped';
  }
}

export function skipCheck(reason: string): never {
  throw new CheckSkipped(reason);
}

/** Assertion helper. Deliberately tiny — the kit must not depend on a matcher library. */
export function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runChecks<T>(
  port: string,
  providerId: string,
  subject: T,
  checks: readonly Check<T>[],
): Promise<ConformanceReport> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    const startedAt = performance.now();
    try {
      await check.run(subject);
      results.push({
        name: check.name,
        obligation: check.obligation,
        ok: true,
        skipped: false,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      const skipped = error instanceof CheckSkipped;
      results.push({
        name: check.name,
        obligation: check.obligation,
        ok: skipped,
        skipped,
        detail: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startedAt,
      });
    }
  }

  return { port, providerId, results, ok: results.every((r) => r.ok) };
}

export function formatReport(report: ConformanceReport): string {
  const lines = [`${report.port} conformance — ${report.providerId}`];
  for (const r of report.results) {
    const mark = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    lines.push(`  [${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  return lines.join('\n');
}
