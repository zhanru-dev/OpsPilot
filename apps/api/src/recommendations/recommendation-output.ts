export type AiRecommendationProposal = {
  key: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  summary: string;
  evidenceKeys: string[];
  suggestedAction: string;
};

export type AiRecommendationOutput = {
  executiveSummary: string;
  recommendations: AiRecommendationProposal[];
};

export type GroundedRecommendationInput = {
  event: {
    id: string;
    title: string;
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
    expectedAttendees: number;
  };
  readiness: {
    score: number;
    status: string;
    ruleVersion: string;
    blockers: string[];
    criteria: Array<{
      key: string;
      label: string;
      passed: boolean;
      hardBlocker: boolean;
      score: number;
      maxScore: number;
      evidence: string;
    }>;
  };
};

export const recommendationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executiveSummary: { type: 'string', minLength: 1, maxLength: 500 },
    recommendations: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            pattern: '^[a-z0-9-]+$',
          },
          severity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          summary: { type: 'string', minLength: 1, maxLength: 400 },
          evidenceKeys: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: { type: 'string' },
          },
          suggestedAction: { type: 'string', minLength: 1, maxLength: 400 },
        },
        required: [
          'key',
          'severity',
          'title',
          'summary',
          'evidenceKeys',
          'suggestedAction',
        ],
      },
    },
  },
  required: ['executiveSummary', 'recommendations'],
} as const;

type ValidationResult =
  | { valid: true; value: AiRecommendationOutput }
  | { valid: false; errors: string[] };

const proposalKeys = [
  'key',
  'severity',
  'title',
  'summary',
  'evidenceKeys',
  'suggestedAction',
];

export function validateRecommendationOutput(
  input: unknown,
  allowedEvidenceKeys: string[],
): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input))
    return { valid: false, errors: ['Output is not an object.'] };
  if (!hasOnlyKeys(input, ['executiveSummary', 'recommendations'])) {
    errors.push('Output contains unsupported fields.');
  }
  if (!validString(input.executiveSummary, 1, 500)) {
    errors.push('Executive summary must contain 1 to 500 characters.');
  }
  if (
    !Array.isArray(input.recommendations) ||
    input.recommendations.length > 5
  ) {
    errors.push(
      'Recommendations must be an array containing at most five items.',
    );
  }

  const recommendations = Array.isArray(input.recommendations)
    ? input.recommendations
    : [];
  const seenKeys = new Set<string>();
  const allowed = new Set(allowedEvidenceKeys);

  recommendations.forEach((item, index) => {
    const prefix = `Recommendation ${index + 1}`;
    if (!isRecord(item)) {
      errors.push(`${prefix} is not an object.`);
      return;
    }
    if (!hasOnlyKeys(item, proposalKeys)) {
      errors.push(`${prefix} contains unsupported fields.`);
    }
    if (typeof item.key !== 'string' || !/^[a-z0-9-]{1,64}$/.test(item.key)) {
      errors.push(`${prefix} has an invalid key.`);
    } else if (seenKeys.has(item.key)) {
      errors.push(`${prefix} repeats key ${item.key}.`);
    } else {
      seenKeys.add(item.key);
    }
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(String(item.severity))) {
      errors.push(`${prefix} has an invalid severity.`);
    }
    if (!validString(item.title, 1, 120))
      errors.push(`${prefix} has an invalid title.`);
    if (!validString(item.summary, 1, 400))
      errors.push(`${prefix} has an invalid summary.`);
    if (!validString(item.suggestedAction, 1, 400)) {
      errors.push(`${prefix} has an invalid suggested action.`);
    }
    if (
      !Array.isArray(item.evidenceKeys) ||
      item.evidenceKeys.length < 1 ||
      item.evidenceKeys.length > 6 ||
      item.evidenceKeys.some(
        (key) => typeof key !== 'string' || !allowed.has(key),
      )
    ) {
      errors.push(`${prefix} is not grounded in supplied evidence keys.`);
    }
  });

  if (errors.length) return { valid: false, errors };
  return { valid: true, value: input as AiRecommendationOutput };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length && keys.every((key) => allowed.includes(key))
  );
}

function validString(value: unknown, min: number, max: number) {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max
  );
}
