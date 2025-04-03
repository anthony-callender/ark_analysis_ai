import { createOpenAI } from '@ai-sdk/openai'
import {
  streamText,
  convertToCoreMessages,
  tool,
  smoothStream,
  appendResponseMessages,
  generateText,
} from 'ai'
import { headers } from 'next/headers'
import { z } from 'zod'
import { DIOCESE_CONFIG } from '@/config/diocese'
import {
  getExplainForQuery,
  getForeignKeyConstraints,
  getIndexes,
  getIndexStatsUsage,
  getPublicTablesWithColumns,
  getTableStats,
  determineQueryType,
  getReferenceSection,
  validateQuery,
} from './utils'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  const client = await createClient()
  const { data } = await client.auth.getUser()
  const user = data.user
  if (!user) {
    console.log('Unauthorized: No user found')
    return new Response('Unauthorized', { status: 401 })
  }

  const { messages, id } = await req.json()
  console.log('Request payload:', { id, messageCount: messages?.length })

  const headers_ = await headers()
  const connectionString = headers_.get('x-connection-string')
  const openaiApiKey = headers_.get('x-openai-api-key')
  const model = headers_.get('x-model')

  if (!id) {
    console.log('Bad request: No id provided')
    return new Response('No id provided', { status: 400 })
  }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) {
    console.log('Bad request: Invalid UUID format', id)
    return new Response('Invalid id', { status: 400 })
  }

  // check if the chat exists
  const { data: chat, error } = await client
    .from('chats')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Database error when fetching chat:', error)
    return new Response('Error fetching chat', { status: 500 })
  }

  // is chat from user
  if (chat && chat.user_id !== user.id) {
    console.log('Unauthorized: Chat belongs to different user', {
      chatUserId: chat.user_id,
      requestUserId: user.id,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  if (!connectionString) {
    console.log('Bad request: Missing connection string')
    return new Response('No connection string provided', { status: 400 })
  }

  const projectOpenaiApiKey = process.env.OPENAI_API_KEY

  const openai = createOpenAI({
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    apiKey: projectOpenaiApiKey!,
  })

  const shouldUpdateChats = !chat

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages(messages),
    system: `
        You are a PostgreSQL database optimization expert specializing in both query performance tuning and SQL query construction. Your primary objective is to always provide a direct, complete, and executable SQL query as your response whenever possible, rather than vague or generic explanations.

      **MANDATORY Query Workflow:**
      1. First, construct your SQL query
      2. BEFORE executing ANY query, you MUST:
         - Use validateQuery tool to check the query
         - If validation fails:
           - Read the error messages CAREFULLY
           - Fix ONLY the specific issues mentioned in the errors
           - Do NOT make other changes
           - Validate again
         - If validation succeeds:
           - Proceed with query execution
      3. NEVER:
         - Skip validation
         - Make changes not related to validation errors
         - Apologize for validation failures
         - Start over with a completely new query
         - Explain the validation process to the user

      **Academic Year Filtering:**
      - When filtering for "last year" or "previous year":
        - DO NOT use current_year = FALSE (this includes ALL previous years)
        - DO NOT hardcode year IDs like '2022-2023'
        - Instead, use academic_year_id = current_year_id - 1
        - Example: If current_year_id = 5, then last year is id = 4
        - ALWAYS use relative IDs (current_year_id - 1) for "last year" queries
        - NEVER assume specific year IDs without checking current_year_id first

      **NULL Handling Requirements:**
      - ALWAYS filter out NULL values and invalid scores:
        - WHERE knowledge_score IS NOT NULL
        - WHERE knowledge_total IS NOT NULL
        - WHERE knowledge_total > 0
        - WHERE knowledge_score > 0
      - ALWAYS cast to float for score calculations:
        - knowledge_score::float
        - knowledge_total::float
      - NEVER return NULL scores in results
      - Filter out invalid data BEFORE calculations

      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\`
    
      **Query Validation:**
      Your query will be automatically validated against these rules:
      1. NULL handling must be present where needed
      2. IDs must be used instead of names for operations
      3. Role-based filtering must be present
      4. Diocese and testing center filters must be present
      5. All columns must exist in the schema
      6. Proper join paths must be maintained

      If any validation fails, you will receive specific error messages and must correct the query.

      **Core Rules:**
      1. ALWAYS try to answer queries using primary tables first
      2. Only look for alternative tables if primary tables cannot provide the required information
      3. When using alternative tables, explain why primary tables were insufficient
      4. Maintain proper join paths and access restrictions
      5. ALWAYS filter by user role when querying testing_section_students or user_answers tables
      6. Never assume a table contains data for only one user type without explicit filtering
      7. ALWAYS use IDs (not names) for GROUP BY, JOIN conditions, aggregations, calculations, filtering, and DISTINCT operations
      8. Names should ONLY be used for display purposes
      9. ALWAYS handle NULL values appropriately using COALESCE, NULLIF, or IS NULL/IS NOT NULL
      10. For score calculations, always use the formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100

      **Role-Based Access:**
      ${DIOCESE_CONFIG.role === 'super_admin' 
        ? '// Super admin has no filter restrictions (except dangerous operations)'
        : `- diocese_id = ${DIOCESE_CONFIG.id}
           ${DIOCESE_CONFIG.role === 'school_manager' ? `- testing_center_id = ${DIOCESE_CONFIG.testingCenterId}` : ''}`
      }

      **Schema Verification:**
      Before constructing any query:
      1. Use getPublicTablesWithColumns to verify all tables and columns exist
      2. Never guess table or column names - always verify first
      3. If schema information is insufficient, ask for clarification
      4. Role IDs must be used correctly:
         - Teachers: role = 5
         - Students: role = 7

      **Query Validation Process:**
      1. Schema Verification: Check all tables and columns exist
      2. NULL Handling: Ensure proper NULL handling for calculations
      3. ID Usage: Verify IDs are used instead of names
      4. Role Filtering: Check for proper role filters (5 for teachers, 7 for students)
      5. Access Control: Verify diocese and testing center filters
      6. Join Paths: Ensure proper table relationships

      ${getReferenceSection(determineQueryType(messages[messages.length - 1].content))}
    `,
    maxSteps: 22,
    tools: {
      getPublicTablesWithColumns: tool({
        description:
          'Retrieves a list of tables and their columns from the connected PostgreSQL database.',
        execute: async () => {
          const tables = await getPublicTablesWithColumns(connectionString)
          return tables
        },
        parameters: z.object({}),
      }),

      getExplainForQuery: tool({
        description:
          "Analyzes and optimizes a given SQL query, providing a detailed execution plan in JSON format. If the query is not valid, it should return an error message. The function itself will add the EXPLAIN keyword to the query, so you don't need to include it.",
        execute: async ({ query }) => {
          const explain = await getExplainForQuery(query, connectionString)
          return explain
        },
        parameters: z.object({
          query: z.string().describe('The SQL query to analyze'),
        }),
      }),

      getIndexStatsUsage: tool({
        description: 'Retrieves usage statistics for indexes in the database.',
        execute: async () => {
          const indexStats = await getIndexStatsUsage(connectionString)
          return indexStats
        },
        parameters: z.object({}),
      }),

      getIndexes: tool({
        description: 'Retrieves the indexes present in the connected database.',
        execute: async () => {
          const indexes = await getIndexes(connectionString)
          return indexes
        },
        parameters: z.object({}),
      }),

      getTableStats: tool({
        description:
          'Retrieves statistics about tables, including row counts and sizes.',
        execute: async () => {
          const stats = await getTableStats(connectionString)
          return stats
        },
        parameters: z.object({}),
      }),

      getForeignKeyConstraints: tool({
        description:
          'Retrieves information about foreign key relationships between tables.',
        execute: async () => {
          const constraints = await getForeignKeyConstraints(connectionString)
          return constraints
        },
        parameters: z.object({}),
      }),

      validateQuery: tool({
        description: 'MANDATORY - DO NOT SKIP: This tool MUST be used to validate EVERY SQL query before execution. The validation checks for proper NULL handling, ID usage, role filtering, and other requirements. If validation fails, you MUST fix the issues and validate again. NEVER proceed with query execution without successful validation.',
        execute: async ({ query }) => {
          const validation = await validateQuery(query, connectionString);
          return validation;
        },
        parameters: z.object({
          query: z.string().describe('The SQL query to validate'),
        }),
      }),
    },
    onFinish: async ({ response }) => {
      console.log('Stream completed, updating database')
      try {
        if (chat) {
          console.log('Updating existing chat:', id)
          await client
            .from('chats')
            .update({
              messages: JSON.stringify(
                appendResponseMessages({
                  messages,
                  responseMessages: response.messages,
                })
              ),
            })
            .eq('id', id)
        } else {
          console.log('Creating new chat:', id)
          const generatedName = await generateText({
            model: openai('gpt-4o-mini'),
            system: `
You are an assistant that generates short, concise, descriptive chat names for a PostgreSQL chatbot. 
The name must:
• Capture the essence of the conversation in one sentence.
• Be relevant to PostgreSQL topics.
• Contain no extra words, labels, or prefixes such as "Title:" or "Chat:".
• Not include quotation marks or the word "Chat" anywhere.

Example of a good name: Counting users
Example of a good name: Counting users in the last 30 days

Example of a bad name: Chat about PostgreSQL: Counting users
Example of a bad name: "Counting users"

Your response should be the title text only, nothing else.
          
            `,
            prompt: `The messages are <MESSAGES>${JSON.stringify(
              messages
            )}</MESSAGES>`,
          })

          await client.from('chats').insert({
            id,
            user_id: user.id,
            messages: JSON.stringify(
              appendResponseMessages({
                messages,
                responseMessages: response.messages,
              })
            ),
            name: generatedName.text,
            created_at: new Date().toISOString(),
          })
        }
        console.log('Database update completed successfully')
        revalidatePath('/app')
      } catch (error) {
        console.error('Error updating database:', error)
      }
    },
  })

  console.log('Returning stream response')
  return result.toDataStreamResponse({
    headers: {
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  })
}
