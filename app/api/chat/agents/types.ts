import { z } from 'zod'

export type AgentResponse = {
  query: string
  feedback: string
  isValid: boolean
  constructedQuery: string
}

export type QueryConstructorResponse = AgentResponse & {
  originalQuery: string
}

export type NullHandlerResponse = AgentResponse & {
  nullHandlingSuggestions: string[]
}

export type PrimaryTablesResponse = AgentResponse & {
  tableUsageFeedback: string
  roleFilteringFeedback: string
}

export type ScoreCalculationResponse = AgentResponse & {
  scoreCalculationFeedback: string
}

export type QueryRulesResponse = AgentResponse & {
  ruleViolations: string[]
}

export type SchemaVerificationResponse = AgentResponse & {
  schemaIssues: string[]
  alternativeSuggestions: string[]
}

export type QueryGenerationResponse = AgentResponse & {
  finalQuery: string
  optimizationNotes: string
  sourceQueries: {
    nullHandler: string
    primaryTables: string
    scoreCalculation: string
    queryRules: string
    schemaVerification: string
  }
}

export const agentResponseSchema = z.object({
  query: z.string(),
  feedback: z.string(),
  isValid: z.boolean()
})

export const queryConstructorResponseSchema = agentResponseSchema.extend({
  originalQuery: z.string()
})

export const nullHandlerResponseSchema = agentResponseSchema.extend({
  nullHandlingSuggestions: z.array(z.string())
})

export const primaryTablesResponseSchema = agentResponseSchema.extend({
  tableUsageFeedback: z.string(),
  roleFilteringFeedback: z.string()
})

export const scoreCalculationResponseSchema = agentResponseSchema.extend({
  scoreCalculationFeedback: z.string()
})

export const queryRulesResponseSchema = agentResponseSchema.extend({
  ruleViolations: z.array(z.string())
})

export const schemaVerificationResponseSchema = agentResponseSchema.extend({
  schemaIssues: z.array(z.string()),
  alternativeSuggestions: z.array(z.string())
})

export const queryGenerationResponseSchema = agentResponseSchema.extend({
  finalQuery: z.string(),
  optimizationNotes: z.string()
}) 