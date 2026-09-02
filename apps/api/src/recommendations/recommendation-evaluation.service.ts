import { Injectable } from '@nestjs/common';
import { recommendationEvaluationFixtures } from './recommendation-evaluation.fixtures';
import { validateRecommendationOutput } from './recommendation-output';

@Injectable()
export class RecommendationEvaluationService {
  report() {
    const cases = recommendationEvaluationFixtures.map((fixture) => {
      const result = validateRecommendationOutput(fixture.output, [
        ...fixture.allowedEvidenceKeys,
      ]);
      const passed = result.valid === fixture.expectedValid;
      return {
        id: fixture.id,
        description: fixture.description,
        expectedValid: fixture.expectedValid,
        actualValid: result.valid,
        passed,
        errors: result.valid ? [] : result.errors,
      };
    });
    return {
      promptVersion: '1.2',
      schemaVersion: '1.0',
      passed: cases.filter((item) => item.passed).length,
      total: cases.length,
      cases,
      limitations: [
        'Contract fixtures test schema and grounding boundaries, not model factual quality.',
        'Provider output remains advisory and requires explicit human confirmation.',
        'Deterministic readiness rules remain authoritative for launch transitions.',
      ],
    };
  }
}
