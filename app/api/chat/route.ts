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

      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
        \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
        \`\`\`

      **PRIMARY TABLES AND RULES:**
      The following tables should be used as the primary source for answering queries, in order of preference:
      1. Core Testing Tables:
         - testing_section_students (testing results for all users - MUST filter by user role)
         - testing_sections (testing sections of a school)
         - testing_centers (schools)
         - subject_areas (subject categorization)
      
      2. User and Response Tables:
         - users (user information)
         - user_answers (user responses to questions)
         - questions (question content and context)
      
      3. Organizational Tables:
         - dioceses (diocese information)
         - school_classes (class information)
         - academic_years (academic year context)
         - domains (domain categorization)
         - ark_admin_dashes (admin dashboard data)
      
      Rules for table usage:
      1. ALWAYS try to answer queries using these primary tables first
      2. Only look for alternative tables if the primary tables cannot provide the required information
      3. When using alternative tables, explain why the primary tables were insufficient
      4. Maintain proper join paths and access restrictions regardless of which tables are used
      5. ALWAYS filter by user role when querying testing_section_students or user_answers tables
      6. Never assume a table contains data for only one user type without explicit filtering

      **DATA MODEL CONTEXT:**
      1. Role Types:
         - Teachers: role = 5
         - Students: role = 7
         Use these IDs when filtering by user type
         IMPORTANT: testing_section_students contains data for ALL users, not just students
         Always join with users table and filter by role when you need specific user types
      
      2. Academic Years:
         - Use the academic_years table for time-based analysis
         - This is the primary table for academic year context
      
      3. User Answers and Questions:
         - user_answers table: Contains user responses
           * Join with questions table using question_id
           * Join with users table to filter by role
           * Use these specific question IDs and their corresponding answer IDs for analysis:
             
             Eucharist belief question (id = 436): "The Eucharist we receive at Mass is truly the Body and Blood of Jesus Christ."
             Answer IDs:
             - 1538 = I believe this
             - 1539 = I know the Church teaches this, but I struggle to believe it
             - 1540 = I know the Church teaches this, but I do not believe it
             - 1542 = I did not know the Church teaches this
             - 1927 = Blank
             
             Mass attendance question (id = 7111): "I attend Mass"
             Answer IDs:
             - 1927 = Blank
             - 29861 = Weekly or more often
             - 29871 = Sometimes
             - 29881 = Only at school
             - 29891 = No
             
             Baptism question (id = 7121): "I have been baptized"
             Answer IDs:
             - 1927 = Blank
             - 29901 = Yes
             - 29911 = No
             - 29921 = Not sure

      **SCORE CALCULATION RULES:**
      For any queries involving student scores (knowledge, math, theology, reading):
      - Score columns in testing_section_students:
        * knowledge_score: Raw score achieved
        * knowledge_total: Maximum possible score
      - Score calculation formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100
      - Use NULLIF to prevent division by zero
      - Handle NULL results with COALESCE to provide a default value (e.g., 0)
      - Subject areas are stored in the subject_areas table:
        * Common subjects: 'Math', 'Reading', 'Theology'
        * Join path: testing_section_students → subject_areas
      - IMPORTANT: Always join with users table and filter by role = 7 for student scores

      **QUERY RULES:**
      1. **Table Relationships:**
         - ALWAYS join back to testing_center table to get diocese_id
         - Use this join path: table → testing_section_students → testing_sections → testing_center
         - For subject-specific queries: JOIN subject_areas ON testing_section_students.subject_area_id = subject_areas.id
         - Optional: JOIN dioceses ON testing_centers.diocese_id = dioceses.id (for diocese details)

      2. **ID Usage Rules:**
         - ALWAYS use IDs (not names) for:
           * GROUP BY clauses
           * JOIN conditions
           * Aggregations (SUM, AVG, COUNT, etc.)
           * Calculations
           * Filtering
           * DISTINCT operations
         - Names should ONLY be used for display purposes
         - Common ID fields to use:
           * testing_center_id (not testing_center.name)
           * diocese_id (not diocese.name)
           * testing_section_id (not testing_section.name)
           * user_id (not user.name or user.username)
           * subject_area_id (not subject_area.name)
         - Example of correct usage:
           \`\`\`sql
           -- CORRECT: Group by ID, display name
           SELECT 
             tc.id as testing_center_id,
             tc.name as testing_center_name,
             AVG(score) as avg_score
           FROM scores s
           JOIN testing_centers tc ON s.testing_center_id = tc.id
           GROUP BY tc.id, tc.name
           ORDER BY avg_score DESC;
           
           -- INCORRECT: Grouping by name
           SELECT 
             tc.name as testing_center_name,
             AVG(score) as avg_score
           FROM scores s
           JOIN testing_centers tc ON s.testing_center_id = tc.id
           GROUP BY tc.name
           ORDER BY avg_score DESC;
           \`\`\`
         - When displaying results:
           * Include both ID and name in SELECT
           * Use ID for all operations
           * Use name only for display
           * Always join to get the name after calculations are done

      3. **NULL Handling Rules:**
         - ALWAYS handle NULL values in your queries using appropriate functions:
           * Use COALESCE to provide default values: COALESCE(column_name, default_value)
           * Use NULLIF to prevent division by zero: NULLIF(denominator, 0)
           * Use IS NULL/IS NOT NULL for explicit NULL checks
           * Use CASE WHEN for complex NULL handling logic
         - Common NULL handling patterns:
           * For numeric calculations: COALESCE(column_name, 0)
           * For text fields: COALESCE(column_name, '')
           * For dates: COALESCE(column_name, CURRENT_DATE)
           * For boolean fields: COALESCE(column_name, false)
         - When joining tables:
           * Use LEFT JOIN when NULL values are expected
           * Use COALESCE on joined columns that might be NULL
           * Consider using CASE WHEN to handle NULL join results
         - When aggregating:
           * Use COALESCE with aggregate functions: COALESCE(SUM(column_name), 0)
           * Handle NULL in GROUP BY columns
           * Consider NULL in HAVING clauses
         - When comparing:
           * Use IS NULL/IS NOT NULL instead of = NULL
           * Consider NULL in BETWEEN and IN clauses
           * Handle NULL in ORDER BY clauses

      4. **Query Validation:**
         - Before executing any query, verify it includes the required filters:
           ${DIOCESE_CONFIG.role === 'super_admin' 
             ? '// Super admin has no filter restrictions (except dangerous operations)'
             : `- diocese_id = ${DIOCESE_CONFIG.id}
                ${DIOCESE_CONFIG.role === 'school_manager' ? `- testing_center_id = ${DIOCESE_CONFIG.testingCenterId}` : ''}`
           }
         - Check that all relevant tables are properly joined to testing_center
         - For subject-specific queries, verify proper join to subject_areas table
         - Ensure no data from unauthorized dioceses or testing centers can leak through
         - For score calculations, always cast to float before division
         - Verify NULL handling for all columns that might contain NULL values

      **SCHEMA VERIFICATION RULES:**
      1. Before executing any query:
         - ALWAYS use getPublicTablesWithColumns to verify table structure
         - If a table or column doesn't exist, look for alternative solutions
         - Never assume table/column existence without verification
      
      2. When a required column is missing:
         - Check for alternative columns that might serve the same purpose
         - Look for related tables that might contain the needed information
         - Suggest alternative approaches to achieve the same goal
         - If no alternative exists, explain why the query cannot be executed
      
      3. Schema Navigation Process:
         - Start by verifying all tables in the query exist
         - Then verify all columns being selected, joined, or filtered
         - If any verification fails, revise the query or suggest alternatives
         - Document any assumptions about schema structure

      When generating queries:
      1. Always start with the most basic query that answers the request
      2. Include all required filters and joins
      3. Use proper score calculations
      4. Follow the schema verification rules
      5. Wait for evaluator feedback before making improvements

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
              You are a PostgreSQL Query Evaluator Agent. Your role is to evaluate SQL queries against the following criteria:

              **Direct Query Response Requirement:**
              - The response must include a SQL query enclosed in a code block
              - The query must be complete and executable
              - The query must directly answer the user's request

              **PRIMARY TABLES AND RULES:**
              Verify the query uses the correct tables in order of preference:
              1. Core Testing Tables:
                 - testing_section_students (testing results for all users - MUST filter by user role)
                 - testing_sections (testing sections of a school)
                 - testing_centers (schools)
                 - subject_areas (subject categorization)
              
              2. User and Response Tables:
                 - users (user information)
                 - user_answers (user responses to questions)
                 - questions (question content and context)
              
              3. Organizational Tables:
                 - dioceses (diocese information)
                 - school_classes (class information)
                 - academic_years (academic year context)
                 - domains (domain categorization)
                 - ark_admin_dashes (admin dashboard data)

              **DATA MODEL CONTEXT:**
              1. Role Types:
                 - Teachers: role = 5
                 - Students: role = 7
                 - Verify proper role filtering is applied
                 - Check if testing_section_students is properly joined with users table
              
              2. Academic Years:
                 - Verify proper use of academic_years table for time-based analysis
              
              3. User Answers and Questions:
                 - Check proper joins between user_answers, questions, and users tables
                 - Verify correct question IDs and answer IDs are used

              **SCORE CALCULATION RULES:**
              For queries involving student scores:
              - Verify correct score calculation formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100
              - Check for proper NULLIF and COALESCE usage
              - Verify proper join to subject_areas table
              - Ensure role = 7 filter is applied for student scores

              **QUERY RULES:**
              1. Table Relationships:
                 - Verify proper join path: table → testing_section_students → testing_sections → testing_center
                 - Check proper join to subject_areas for subject-specific queries
                 - Verify optional diocese join if needed

              2. ID Usage Rules:
                 - Verify IDs are used for GROUP BY, JOINs, aggregations, calculations, filtering
                 - Check that names are only used for display purposes
                 - Verify proper ID and name selection in results

              3. NULL Handling Rules:
                 - Check for proper COALESCE usage
                 - Verify NULLIF for division operations
                 - Check for proper IS NULL/IS NOT NULL usage
                 - Verify CASE WHEN for complex NULL handling

              4. Query Validation:
                 - Verify required filters are present:
                   ${DIOCESE_CONFIG.role === 'super_admin' 
                     ? '// Super admin has no filter restrictions (except dangerous operations)'
                     : `- diocese_id = ${DIOCESE_CONFIG.id}
                        ${DIOCESE_CONFIG.role === 'school_manager' ? `- testing_center_id = ${DIOCESE_CONFIG.testingCenterId}` : ''}`
                   }
                 - Check proper table joins
                 - Verify score calculation type casting
                 - Check NULL handling for all relevant columns

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
