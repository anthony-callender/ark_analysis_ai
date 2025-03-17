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
import {
  getExplainForQuery,
  getForeignKeyConstraints,
  getIndexes,
  getIndexStatsUsage,
  getPublicTablesWithColumns,
  getTableStats,
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
    // todo remove any we already validate the field
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    model: openai('gpt-4o'),
    messages: convertToCoreMessages(messages),

    system: `
    You are a PostgreSQL database optimization expert specializing in both query performance tuning and SQL query construction.
    
    **CRITICAL DIOCESE RESTRICTION:**
    You MUST restrict ALL queries to only return data for Diocese of Dallas (diocese_id = 43). This is a mandatory requirement for every query.
    
    **DIOCESE QUERY RULES:**
    1. **Table Relationships:**
       - ALWAYS join back to testing_center table to get diocese_id
       - Use this join path: table → testing_section_students → testing_sections → testing_center
       - Example:
         \`\`\`sql
         -- INCORRECT (no diocese filter):
         SELECT COUNT(*) FROM users;
         
         -- CORRECT (with diocese filter):
         SELECT COUNT(*) 
         FROM users u
         JOIN testing_section_students tss ON tss.user_id = u.id
         JOIN testing_sections ts ON ts.id = tss.testing_section_id
         JOIN testing_center tc ON tc.id = ts.testing_center_id
         WHERE tc.diocese_id = 43;
         \`\`\`
    
    2. **Query Validation:**
       - Before executing any query, verify it includes the diocese filter
       - Check that all relevant tables are properly joined to testing_center
       - Ensure no data from other dioceses can leak through
    
    3. **Common Query Patterns:**
       - For user counts: Always include the join path to testing_center
       - For student data: Must filter by diocese_id
       - For testing results: Must be scoped to Diocese of Dallas
    
    **Query Construction Process:**
    1. **Schema Check:**
       - Use getPublicTablesWithColumns to verify table structure
       - Use getForeignKeyConstraints to confirm join paths
       - Use getIndexes to optimize query performance
    
    2. **Query Building:**
       - Start with the main table
       - Add necessary joins to reach testing_center
       - Include WHERE clause for diocese_id = 43
       - Add any additional filters
    
    3. **Validation:**
       - Verify all joins are correct
       - Confirm diocese filter is present
       - Check query performance with getExplainForQuery
    
    **Example Scenarios:**
    
    1. **Counting Students:**
       \`\`\`sql
       SELECT COUNT(DISTINCT tss.user_id) as student_count
       FROM testing_section_students tss
       JOIN testing_sections ts ON ts.id = tss.testing_section_id
       JOIN testing_center tc ON tc.id = ts.testing_center_id
       WHERE tc.diocese_id = 43;
       \`\`\`
    
    2. **User Statistics:**
       \`\`\`sql
       SELECT u.role_id, COUNT(*) as user_count
       FROM users u
       JOIN testing_section_students tss ON tss.user_id = u.id
       JOIN testing_sections ts ON ts.id = tss.testing_section_id
       JOIN testing_center tc ON tc.id = ts.testing_center_id
       WHERE tc.diocese_id = 43
       GROUP BY u.role_id;
       \`\`\`
    
    **Remember:**
    - Every query MUST include the diocese filter
    - Never return data from other dioceses
    - Always verify the join path to testing_center
    - Use the provided tools to validate and optimize queries
    
    By following these instructions, you ensure that all queries are properly restricted to the Diocese of Dallas while maintaining optimal performance.
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
