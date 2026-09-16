/**
 * bun:test bindings for the conformance kit.
 *
 * Kept out of `testing/index.ts` on purpose: importing `bun:test` outside a
 * test run throws, and the checks themselves are runner-agnostic. An adapter
 * that uses a different runner can call `run*Conformance()` directly and assert
 * on the report.
 */
import { beforeAll, describe, expect, it } from 'bun:test';

import {
  ASR_CHECK_NAMES,
  LLM_CHECK_NAMES,
  POS_CHECK_NAMES,
  TTS_CHECK_NAMES,
  VAD_CHECK_NAMES,
  runAsrConformance,
  runLlmConformance,
  runPosConformance,
  runTtsConformance,
  runVadConformance,
  type AsrConformanceOptions,
  type LlmConformanceOptions,
  type PosConformanceOptions,
  type TtsConformanceOptions,
  type VadConformanceOptions,
} from './conformance/index.ts';
import type { CheckResult, ConformanceReport } from './types.ts';

function suite(
  label: string,
  checkNames: readonly string[],
  run: () => Promise<ConformanceReport>,
): void {
  describe(label, () => {
    let report: ConformanceReport;
    // One run, many assertions: the checks do real I/O against the adapter and
    // must not be repeated per `it`.
    beforeAll(async () => {
      report = await run();
    });

    for (const name of checkNames) {
      it(name, () => {
        const result: CheckResult | undefined = report.results.find((r) => r.name === name);
        expect(result, `check "${name}" did not run`).toBeDefined();
        if (result!.skipped) return;
        if (!result!.ok) {
          throw new Error(
            `${name} failed\n  obligation: ${result!.obligation}\n  detail: ${result!.detail ?? '(none)'}`,
          );
        }
      });
    }
  });
}

export function describeAsrConformance(label: string, options: AsrConformanceOptions): void {
  suite(label, ASR_CHECK_NAMES, () => runAsrConformance(options));
}

export function describeLlmConformance(label: string, options: LlmConformanceOptions): void {
  suite(label, LLM_CHECK_NAMES, () => runLlmConformance(options));
}

export function describeTtsConformance(label: string, options: TtsConformanceOptions): void {
  suite(label, TTS_CHECK_NAMES, () => runTtsConformance(options));
}

export function describeVadConformance(label: string, options: VadConformanceOptions): void {
  suite(label, VAD_CHECK_NAMES, () => runVadConformance(options));
}

export function describePosConformance(label: string, options: PosConformanceOptions): void {
  suite(label, POS_CHECK_NAMES, () => runPosConformance(options));
}
