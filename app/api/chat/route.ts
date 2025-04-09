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
import { SchemaVectorStore } from '@/utils/vectorStore'

// Define schema rules
const SCHEMA_RULES = [
  "Always filter by user role when querying testing_section_students or user_answers tables",
  "Never assume a table contains data for only one user type without explicit filtering",
  "Tables may contain data for all users, not just the user type indicated in the table name",
  "When filtering for 'last year', use academic_year_id = current_year_id - 1, not current_year = FALSE",
  "Teachers have role = 5, Students have role = 7",
  "Score calculation formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100",
  "Always cast to float for score calculations: knowledge_score::float / knowledge_total::float",
  "Filter out NULL values before calculations: WHERE knowledge_score IS NOT NULL AND knowledge_total IS NOT NULL",
  "For dioceses, use 'Diocese of [diocese name]' OR 'Archdiocese of [archdiocese name]'",
  "Use IDs (not names) for GROUP BY clauses, JOIN conditions, and filtering"
];

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
  if (!projectOpenaiApiKey) {
    console.error('Missing OpenAI API key in environment')
    return new Response('Server configuration error', { status: 500 })
  }

  const openai = createOpenAI({
    apiKey: projectOpenaiApiKey,
  })

  const shouldUpdateChats = !chat
  
  // Initialize vector store - would typically be done during app setup
  // but for demonstration we'll do it here
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration')
    return new Response('Server configuration error', { status: 500 })
  }
  
  const vectorStore = new SchemaVectorStore(
    supabaseUrl,
    supabaseServiceKey,
    projectOpenaiApiKey
  )

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages(messages),
    system: `
      You are a PostgreSQL Query Generator Agent. Your primary responsibility is to generate accurate and efficient SQL queries based on user requests.
      
      The assistant will retrieve relevant schema information based on your query, so you don't need all database details upfront.
    `,
    maxSteps: 22,
    tools: {
      getPublicTablesWithColumns: tool({
        description:
          'Retrieves a list of tables and their columns from the connected PostgreSQL database.',
        execute: async () => {
          const tables = await getPublicTablesWithColumns(connectionString)
          
          // Store tables in vector store if tables retrieved
          if (tables && tables.length > 0) {
            try {
              await vectorStore.initialize()
              const constraints = await getForeignKeyConstraints(connectionString)
              // Fix type issue - cast tables to the correct type for storeSchemaInfo
              const typedTables = tables as unknown as Array<{
                description?: {
                  requiresDioceseFilter: boolean;
                  joinPath: string;
                  hasDirectDioceseColumn: boolean;
                  example: string;
                };
                tableName: string;
                schemaName: string;
                columns: Array<{
                  name: string;
                  type: string;
                  isNullable: boolean;
                }>;
              }>;
              // Fix type issue with constraints
              const typedConstraints = constraints as unknown as Array<{
                constraintName: string;
                tableName: string;
                columnName: string;
                foreignTableName: string;
                foreignColumnName: string;
              }>;
              const storedCount = await vectorStore.storeSchemaInfo(typedTables, typedConstraints, SCHEMA_RULES)
              console.log(`Stored ${storedCount} schema vector entries`)
            } catch (error) {
              console.error('Error storing schema in vector store:', error)
            }
          }
          
          return tables
        },
        parameters: z.object({}),
      }),

      getRelevantSchemaInfo: tool({
        description: 'Retrieves relevant schema information based on a natural language query.',
        execute: async ({ query }) => {
          try {
            await vectorStore.initialize()
            const relevantInfo = await vectorStore.searchSchemaInfo(query, 15)
            
            // Format the results in a more readable way
            const formattedResults = relevantInfo.map(info => ({
              content: info.content,
              type: info.type,
              // Type fix - cast similarity from metadata if it exists
              similarity: (info as any).similarity,
              table_name: info.table_name,
              column_name: info.column_name
            }));
            
            return formattedResults
          } catch (error) {
            console.error('Error retrieving schema info:', error)
            throw new Error(`Failed to retrieve schema info: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        },
        parameters: z.object({
          query: z.string().describe('Natural language description of the schema information needed'),
        }),
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

            // First, verify table and column existence
            console.log('Verifying table and column existence...')
            const tables = await getPublicTablesWithColumns(connectionString) as Array<{
              description?: {
                requiresDioceseFilter: boolean;
                joinPath: string;
                hasDirectDioceseColumn: boolean;
                example: string;
              };
              tableName: string;
              schemaName: string;
              columns: Array<{
                name: string;
                type: string;
                isNullable: boolean;
              }>;
            }>;
            
            // Extract table names from the query
            const tableMatches = query.match(/FROM\s+([a-zA-Z_]+)|JOIN\s+([a-zA-Z_]+)/gi) || []
            const tablesInQuery = tableMatches.map(match => {
              const parts = match.split(/\s+/)
              return parts[parts.length - 1].toLowerCase()
            })

            // Extract column names from the query
            const columnMatches = query.match(/\b([a-zA-Z_]+)\.([a-zA-Z_]+)\b/g) || []
            const columnsInQuery = columnMatches.map(match => {
              const [table, column] = match.split('.')
              return { table: table.toLowerCase(), column: column.toLowerCase() }
            })

            // Verify tables exist
            const missingTables = tablesInQuery.filter(table => 
              !tables.some(t => t.tableName.toLowerCase() === table)
            )

            // Verify columns exist in their respective tables
            const missingColumns = columnsInQuery.filter(({ table, column }) => {
              const tableInfo = tables.find(t => t.tableName.toLowerCase() === table)
              return !tableInfo?.columns.some(c => c.name.toLowerCase() === column)
            })

            if (missingTables.length > 0 || missingColumns.length > 0) {
              let errorMessage = 'REJECTED: Schema validation failed.\n'
              if (missingTables.length > 0) {
                errorMessage += `Missing tables: ${missingTables.join(', ')}\n`
              }
              if (missingColumns.length > 0) {
                errorMessage += `Missing columns: ${missingColumns.map(({ table, column }) => 
                  `${table}.${column}`
                ).join(', ')}`
              }
              return errorMessage
            }

            // Get relevant schema information from vector store for evaluating the query
            const schemaInfo = await vectorStore.searchSchemaInfo(query, 10)
            console.log('Retrieved relevant schema info for evaluation')
            
            // Extract rules from schema info
            const relevantRules = schemaInfo
              .filter(info => info.type === 'rule')
              .map(info => info.content.replace('Rule: ', ''))
            
            // Check for common issues
            const issues = [];

            // Check role IDs 
            if (query.includes("role = 'student'") || query.includes("role = 'teacher'")) {
              issues.push("Role IDs must be numeric: use role = 7 for students and role = 5 for teachers");
            }

            // Check academic year
            if (query.match(/year\s*=\s*['"]\d{4}-\d{4}['"]/i)) {
              issues.push("Academic year must use relative IDs: use academic_year_id = current_year_id - 1 for last year");
            }

            // Check NULL handling
            if (!query.includes("WHERE knowledge_score IS NOT NULL") || 
                !query.includes("WHERE knowledge_total IS NOT NULL")) {
              issues.push("Must explicitly filter out NULL values: WHERE knowledge_score IS NOT NULL AND knowledge_total IS NOT NULL");
            }

            // Check score calculation
            if (!query.includes("NULLIF(knowledge_total, 0)")) {
              issues.push("Score calculation must use NULLIF: (knowledge_score / NULLIF(knowledge_total, 0)) * 100");
            }

            if (issues.length > 0) {
              return `REJECTED: Query validation failed.\n${issues.join('\n')}`;
            }
            
            // Use more dynamic evaluation with retrieved schema info
            const evaluatorPrompt = `
              You are a PostgreSQL Query Evaluator Agent. Your role is to evaluate SQL queries against the following criteria:

              ${relevantRules.length > 0 ? `
              **RELEVANT RULES FROM SCHEMA:**
              ${relevantRules.join('\n')}
              ` : ''}

              **Direct Query Response Requirement:**
              - The response must include a SQL query enclosed in a code block
              - The query must be complete and executable
              - The query must directly answer the user's request

              **SCHEMA VERIFICATION RULES:**
              1. Table and Column Verification:
                 - Verify all tables and columns exist
                 - Check for proper handling of missing tables/columns
                 - Verify no guessing of table or column names

              2. Role ID Verification:
                 - Verify correct use of role IDs:
                   * Teachers: role = 5
                   * Students: role = 7

              3. Missing Column Handling:
                 - Check for alternative columns or tables
                 - Verify proper explanation if no alternatives exist

              4. Schema Navigation:
                 - Verify all tables in query exist
                 - Check all columns being selected, joined, or filtered

              If the query meets all criteria, respond with "ACCEPTED: [brief explanation]".
              If improvements are needed, respond with "REJECTED: [detailed feedback]" and specify which criteria were not met.

              Query to evaluate:
              ${query}
            `

            console.log('Sending evaluation request to OpenAI...')
            const evaluation = await generateText({
              model: openai('gpt-4o'),
              system: evaluatorPrompt,
              prompt: 'Please evaluate this SQL query against all the specified criteria.',
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
            
            // Get relevant schema information from vector store
            const schemaInfo = await vectorStore.searchSchemaInfo(request, 15)
            console.log('Retrieved relevant schema info for query generation')
            
            // Format the schema info for the prompt
            const formattedSchemaInfo = schemaInfo.map(info => info.content).join('\n\n')
            
            const generatorPrompt = `
              You are a PostgreSQL Query Generator Agent. 
              
              ${feedback ? `Your previous query was rejected with the following feedback:
              ${feedback}
              
              Please generate a new query that addresses these concerns.` : 'Please generate a query for the following request:'}
              
              Here is relevant schema information retrieved based on your request:
              
              ${formattedSchemaInfo}
              
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
