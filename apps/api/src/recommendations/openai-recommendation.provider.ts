import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AiRecommendationOutput,
  type GroundedRecommendationInput,
  recommendationOutputSchema,
  validateRecommendationOutput,
} from './recommendation-output';

type OpenAiResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type ProviderResult = {
  output: AiRecommendationOutput;
  responseId: string | null;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

@Injectable()
export class OpenAiRecommendationProvider {
  constructor(private readonly config: ConfigService) {}

  isConfigured() {
    return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }

  model() {
    return this.config.get<string>('OPENAI_MODEL', 'gpt-5-mini');
  }

  async generate(input: GroundedRecommendationInput): Promise<ProviderResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) throw new Error('OPENAI_NOT_CONFIGURED');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const startedAt = Date.now();
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model(),
          store: false,
          max_output_tokens: 1_200,
          input: [
            {
              role: 'system',
              content:
                'You are an operations adviser. Use only the supplied readiness evidence. Never claim that an event is safe to launch, never override hard blockers, and cite one or more supplied criterion keys for every recommendation.',
            },
            { role: 'user', content: JSON.stringify(input) },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'opspilot_grounded_recommendations',
              strict: true,
              schema: recommendationOutputSchema,
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);

      const data = (await response.json()) as OpenAiResponse;
      const content = data.output
        ?.find((item) => item.type === 'message')
        ?.content?.find((item) =>
          ['output_text', 'refusal'].includes(item.type ?? ''),
        );
      if (content?.type === 'refusal') throw new Error('OPENAI_REFUSAL');
      if (!content?.text) throw new Error('OPENAI_EMPTY_OUTPUT');

      const parsed = JSON.parse(content.text) as unknown;
      const validation = validateRecommendationOutput(
        parsed,
        input.readiness.criteria.map((criterion) => criterion.key),
      );
      if (!validation.valid) throw new Error('OPENAI_INVALID_OUTPUT');

      return {
        output: validation.value,
        responseId: data.id ?? null,
        model: data.model ?? this.model(),
        latencyMs: Date.now() - startedAt,
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
