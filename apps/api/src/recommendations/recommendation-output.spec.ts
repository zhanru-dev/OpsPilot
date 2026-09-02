import { RecommendationEvaluationService } from './recommendation-evaluation.service';
import { validateRecommendationOutput } from './recommendation-output';

describe('recommendation output guardrail', () => {
  it('accepts a grounded structured recommendation', () => {
    const result = validateRecommendationOutput(
      {
        executiveSummary: 'One launch blocker needs attention.',
        recommendations: [
          {
            key: 'assign-owner',
            severity: 'HIGH',
            title: 'Assign an event owner',
            summary: 'The owner criterion is blocking readiness.',
            evidenceKeys: ['owner'],
            suggestedAction: 'Assign an Operations Manager.',
          },
        ],
      },
      ['owner'],
    );

    expect(result.valid).toBe(true);
  });

  it('rejects unsupported evidence and fields', () => {
    const result = validateRecommendationOutput(
      {
        executiveSummary: 'A recommendation was generated.',
        confidence: 0.99,
        recommendations: [
          {
            key: 'configure-payments',
            severity: 'HIGH',
            title: 'Configure payments',
            summary: 'Payments are missing.',
            evidenceKeys: ['payments'],
            suggestedAction: 'Add a payment provider.',
          },
        ],
      },
      ['owner'],
    );

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected validation to fail.');
    expect(result.errors).toContain('Output contains unsupported fields.');
    expect(result.errors).toContain(
      'Recommendation 1 is not grounded in supplied evidence keys.',
    );
  });

  it('keeps the evaluation fixture set green', () => {
    expect(new RecommendationEvaluationService().report()).toMatchObject({
      passed: 5,
      total: 5,
    });
  });
});
