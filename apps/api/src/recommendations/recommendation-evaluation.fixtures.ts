export const recommendationEvaluationFixtures = [
  {
    id: 'valid-grounded-blocker',
    description: 'Accepts a concise proposal grounded in supplied criteria.',
    allowedEvidenceKeys: ['owner', 'runbook'],
    expectedValid: true,
    output: {
      executiveSummary:
        'Ownership and one critical runbook item need attention.',
      recommendations: [
        {
          key: 'confirm-operational-owner',
          severity: 'HIGH',
          title: 'Confirm operational ownership',
          summary: 'The owner criterion is currently blocking readiness.',
          evidenceKeys: ['owner'],
          suggestedAction: 'Assign an Operations Manager before launch review.',
        },
      ],
    },
  },
  {
    id: 'reject-ungrounded-evidence',
    description: 'Rejects evidence keys that were not supplied to the model.',
    allowedEvidenceKeys: ['media'],
    expectedValid: false,
    output: {
      executiveSummary: 'A media risk needs attention.',
      recommendations: [
        {
          key: 'fix-payment-risk',
          severity: 'HIGH',
          title: 'Fix payment configuration',
          summary: 'Payment configuration is missing.',
          evidenceKeys: ['payments'],
          suggestedAction: 'Configure payments.',
        },
      ],
    },
  },
  {
    id: 'reject-extra-field',
    description: 'Rejects schema fields that the application does not support.',
    allowedEvidenceKeys: ['content'],
    expectedValid: false,
    output: {
      executiveSummary: 'Content needs attention.',
      confidence: 0.98,
      recommendations: [],
    },
  },
  {
    id: 'reject-duplicate-keys',
    description: 'Rejects duplicate proposal keys before persistence.',
    allowedEvidenceKeys: ['schedule'],
    expectedValid: false,
    output: {
      executiveSummary: 'The schedule is invalid.',
      recommendations: [
        {
          key: 'correct-schedule',
          severity: 'HIGH',
          title: 'Correct the schedule',
          summary: 'The event end must follow its start.',
          evidenceKeys: ['schedule'],
          suggestedAction: 'Set a valid event end time.',
        },
        {
          key: 'correct-schedule',
          severity: 'MEDIUM',
          title: 'Review the schedule',
          summary: 'The current schedule cannot be used.',
          evidenceKeys: ['schedule'],
          suggestedAction: 'Review the event schedule.',
        },
      ],
    },
  },
  {
    id: 'valid-no-action',
    description: 'Accepts an empty advisory when all supplied evidence passes.',
    allowedEvidenceKeys: ['owner', 'schedule'],
    expectedValid: true,
    output: {
      executiveSummary: 'No additional advisory action is required.',
      recommendations: [],
    },
  },
] as const;
