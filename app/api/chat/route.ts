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
      You are a PostgreSQL Query Generator Agent. Your primary responsibility is to generate accurate and efficient SQL queries based on user requests. Follow these guidelines:

      1. Always generate complete, executable SQL queries
      2. Follow the table usage rules and data model context
      3. Include proper joins and filters
      4. Handle NULL values appropriately
      5. Use proper score calculations when needed

      After generating a query, you must send it to the Evaluator Agent for review. The evaluator will provide feedback that you must incorporate into your next attempt.
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
          "Analyzes and optimizes a given SQL query, providing a detailed execution plan in JSON format.",
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

      evaluateQuery: tool({
        description: 'Evaluates a generated SQL query and provides feedback.',
        execute: async ({ query }) => {
          try {
            console.log('\n=== Query Evaluation Step ===')
            console.log('Query being evaluated:', query)
            
            const evaluatorPrompt = `
              You are a PostgreSQL Query Evaluator Agent. Your role is to evaluate SQL queries and provide feedback. Consider:

              1. Query Accuracy:
                 - Does it correctly answer the user's request?
                 - Are all necessary tables and columns included?
                 - Are joins and filters correct?

              2. Query Performance:
                 - Are indexes being used effectively?
                 - Are there any potential performance bottlenecks?
                 - Could the query be optimized further?

              3. Data Model Compliance:
                 - Does it follow the table usage rules?
                 - Are proper role filters applied?
                 - Is NULL handling appropriate?

              4. Security:
                 - Are proper access restrictions in place?
                 - Is sensitive data properly protected?

              If the query meets all criteria, respond with "ACCEPTED: [brief explanation]".
              If improvements are needed, respond with "REJECTED: [detailed feedback]".

              Query to evaluate:
              ${query}
            `

            console.log('Sending evaluation request to OpenAI...')
            const evaluation = await generateText({
              model: openai('gpt-4o'),
              system: evaluatorPrompt,
              prompt: 'Please evaluate this SQL query and provide feedback.',
            })

            console.log('Evaluation result:', evaluation.text)
            return evaluation.text
          } catch (error) {
            console.error('Error in evaluateQuery:', error)
            throw error
          }
        },
        parameters: z.object({
          query: z.string().describe('The SQL query to evaluate'),
        }),
      }),

      generateQuery: tool({
        description: 'Generates a new SQL query based on user request and feedback.',
        execute: async ({ request, feedback }) => {
          try {
            console.log('\n=== Query Generation Step ===')
            console.log('User request:', request)
            if (feedback) {
              console.log('Previous feedback:', feedback)
            }

            const generatorPrompt = `
              You are a PostgreSQL Query Generator Agent. ${feedback ? `Your previous query was rejected with the following feedback:
              ${feedback}
              
              Please generate a new query that addresses these concerns.` : 'Please generate a query for the following request:'}
              
              Request: ${request}
            `

            console.log('Sending generation request to OpenAI...')
            const newQuery = await generateText({
              model: openai('gpt-4o'),
              system: generatorPrompt,
              prompt: 'Please generate a SQL query for this request.',
            })

            console.log('Generated query:', newQuery.text)
            return newQuery.text
          } catch (error) {
            console.error('Error in generateQuery:', error)
            throw error
          }
        },
        parameters: z.object({
          request: z.string().describe('The user\'s request'),
          feedback: z.string().optional().describe('Feedback from the evaluator, if any'),
        }),
      }),
    },
    onFinish: async ({ response }) => {
      console.log('Stream completed, updating database')
      try {
        console.log('Response messages:', JSON.stringify(response.messages, null, 2))
        
        const lastMessage = response.messages[response.messages.length - 1]
        console.log('Last message:', JSON.stringify(lastMessage, null, 2))
        
        if (lastMessage && typeof lastMessage.content === 'string') {
          const queryMatch = lastMessage.content.match(/```sql\n([\s\S]*?)\n```/)
          console.log('Query match result:', queryMatch)
          
          if (queryMatch) {
            const finalQuery = queryMatch[1]
            console.log('\n=== Final Query ===')
            console.log(finalQuery)

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
                prompt: `The messages are <MESSAGES>${JSON.stringify(messages)}</MESSAGES>`,
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
          } else {
            console.log('No SQL query found in the response')
          }
        } else {
          console.log('Last message is not a string or is undefined')
        }
        console.log('\n=== Workflow Completed ===')
        console.log('Database update completed successfully')
        revalidatePath('/app')
      } catch (error) {
        console.error('Error in workflow:', error)
        if (error instanceof Error) {
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
          })
        }
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
