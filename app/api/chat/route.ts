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

// Define the list of target tables for vector store
const TARGET_TABLES = [
  'subject_areas',
  'testing_centers',
  'dioceses',
  'domains',
  'testing_sections',
  'ark_admin_dashes',
  'school_classes',
  'testing_section_students',
  'testing_center_dashboards',
  'tc_grade_levels_snapshot_dcqs',
  'tc_grade_levels_snapshots',
  'diocese_student_snapshot_dcqs',
  'diocese_student_snapshot_grade_levels',
];

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

// Create a singleton vector store
let vectorStoreInstance: SchemaVectorStore | null = null;
let schemaStored = false;

// Helper function to get or create vector store instance
async function getVectorStore(apiKey: string): Promise<SchemaVectorStore> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration');
    throw new Error('Server configuration error');
  }
  
  if (!vectorStoreInstance) {
    console.log('Creating new vector store instance');
    vectorStoreInstance = new SchemaVectorStore(
      supabaseUrl,
      supabaseServiceKey,
      apiKey
    );
    await vectorStoreInstance.initialize();
  }
  
  return vectorStoreInstance;
}

// Force rebuild of schema vectors with filtered tables
export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const action = searchParams.get('action');
  
  if (action === 'rebuild_vectors') {
    try {
      // Get the vector store
      const projectOpenaiApiKey = process.env.OPENAI_API_KEY;
      if (!projectOpenaiApiKey) {
        return new Response('Missing OpenAI API Key', { status: 500 });
      }
      
      const vectorStore = await getVectorStore(projectOpenaiApiKey);
      
      // Clear existing vectors
      await vectorStore.clearVectorStore();
      
      // Reset schema stored flag
      schemaStored = false;
      
      return new Response('Vector store cleared. It will be rebuilt on the next query with filtered tables.', { 
        status: 200 
      });
    } catch (error) {
      console.error('Error rebuilding vector store:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500 
      });
    }
  }
  
  return new Response('Use ?action=rebuild_vectors to rebuild the vector store', { status: 200 });
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  const startTime = Date.now();
  console.log('POST request started at:', new Date().toISOString());
  
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
  
  console.log(`Setup time: ${Date.now() - startTime}ms`);
  const vectorStoreStartTime = Date.now();
  
  // Get or create vector store instance
  let vectorStore: SchemaVectorStore;
  try {
    vectorStore = await getVectorStore(projectOpenaiApiKey);
    console.log(`Vector store initialization: ${Date.now() - vectorStoreStartTime}ms`);
  } catch (error) {
    console.error('Error initializing vector store:', error);
    return new Response('Error initializing vector store', { status: 500 });
  }

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages(messages),
    system: `
     You are a PostgreSQL Query Generator Agent. Your primary responsibility is to generate accurate and efficient SQL queries based on user requests.
     
     IMPORTANT: This application uses a focused set of tables specifically selected for key analytical questions. 
     Only work with the tables returned by the getPublicTablesWithColumns tool - do not reference any other tables.
     
     The assistant will retrieve relevant schema information based on your query, so you don't need all database details upfront.
     
     When generating queries:
     1. Always verify the table and column existence using the getPublicTablesWithColumns tool
     2. Only use tables from the returned list - never reference tables not in this list
     3. Include all required filters and joins
     4. Use proper score calculations with NULLIF and type casting
     5. Follow the schema rules provided in the relevant schema information
     6. Present the final SQL query in a code block
    `,
    maxSteps: 22,
    tools: {
      getPublicTablesWithColumns: tool({
        description:
          'Retrieves a list of tables and their columns from the connected PostgreSQL database.',
        execute: async () => {
          const tablesTimerId = `getPublicTablesWithColumns-${Date.now()}`;
          console.time(tablesTimerId);
          const tables = await getPublicTablesWithColumns(connectionString)
          
          // Only store schema in vector store if not already stored
          if (tables && tables.length > 0 && !schemaStored) {
            try {
              console.log('Storing schema in vector store (first time only)');
              const schemaTimerId = `storeSchema-${Date.now()}`;
              console.time(schemaTimerId);
              
              const constraints = await getForeignKeyConstraints(connectionString)
              
              // Filter tables to only include target tables
              const filteredTables = Array.isArray(tables) 
                ? tables.filter((table: any) => TARGET_TABLES.includes(table.tableName))
                : [];
              
              console.log(`Filtered ${Array.isArray(tables) ? tables.length : 0} tables to ${filteredTables.length} target tables`);
              
              // Fix type issue - cast tables to the correct type for storeSchemaInfo
              const typedTables = filteredTables as unknown as Array<{
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
              
              // Filter constraints to only include relationships between target tables
              const filteredConstraints = Array.isArray(constraints)
                ? constraints.filter((constraint: any) => 
                    TARGET_TABLES.includes(constraint.tableName) && 
                    TARGET_TABLES.includes(constraint.foreignTableName)
                  )
                : [];
              
              console.log(`Filtered ${Array.isArray(constraints) ? constraints.length : 0} constraints to ${filteredConstraints.length} relevant constraints`);
              
              // Fix type issue with constraints
              const typedConstraints = filteredConstraints as unknown as Array<{
                constraintName: string;
                tableName: string;
                columnName: string;
                foreignTableName: string;
                foreignColumnName: string;
              }>;
              
              const storedCount = await vectorStore.storeSchemaInfo(typedTables, typedConstraints, SCHEMA_RULES)
              console.log(`Stored ${storedCount} schema vector entries`);
              schemaStored = true;
              
              console.timeEnd(schemaTimerId);
            } catch (error) {
              console.error('Error storing schema in vector store:', error)
            }
          } else {
            console.log('Schema already stored, skipping vectorization');
          }
          
          console.timeEnd(tablesTimerId);
          
          // Return only the target tables to ensure consistency with vector store
          const filteredTablesToReturn = Array.isArray(tables) 
            ? tables.filter((table: any) => TARGET_TABLES.includes(table.tableName))
            : [];
            
          console.log(`Returning ${filteredTablesToReturn.length} target tables to the model`);
          return filteredTablesToReturn;
        },
        parameters: z.object({}),
      }),

      getRelevantSchemaInfo: tool({
        description: 'Retrieves relevant schema information based on a natural language query.',
        execute: async ({ query }) => {
          try {
            const infoTimerId = `getRelevantSchemaInfo-${Date.now()}`;
            console.time(infoTimerId);
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
            
            console.timeEnd(infoTimerId);
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
          // Extract table names from the query using a different approach to avoid iterator issues
          const tableRegex = /\b(from|join)\s+([a-zA-Z0-9_]+)\b/gi;
          const tablesInQuery: string[] = [];
          let match;
          
          while ((match = tableRegex.exec(query)) !== null) {
            tablesInQuery.push(match[2].toLowerCase());
          }
          
          // Check if any table in the query is not in our target tables
          const targetTablesLower = TARGET_TABLES.map(t => t.toLowerCase());
          const nonTargetTables = tablesInQuery.filter(
            table => !targetTablesLower.includes(table)
          );
          
          if (nonTargetTables.length > 0) {
            console.warn(`Query references non-target tables: ${nonTargetTables.join(', ')}`);
            return {
              warning: "This query references tables that are not in the target set. Please ensure you only use the tables returned by getPublicTablesWithColumns.",
              tables_referenced: tablesInQuery,
              non_target_tables: nonTargetTables,
              tables_available: TARGET_TABLES,
              explain: await getExplainForQuery(query, connectionString)
            };
          }
          
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
          
          // Filter index stats to only include those from target tables
          const filteredIndexStats = Array.isArray(indexStats)
            ? indexStats.filter((stat: any) => TARGET_TABLES.includes(stat.table_name))
            : [];
          
          console.log(`Returning usage statistics for ${filteredIndexStats.length} indexes on target tables`);
          return filteredIndexStats;
        },
        parameters: z.object({}),
      }),

      getIndexes: tool({
        description: 'Retrieves the indexes present in the connected database.',
        execute: async () => {
          const indexes = await getIndexes(connectionString)
          
          // Filter indexes to only include those from target tables
          const filteredIndexes = Array.isArray(indexes)
            ? indexes.filter((index: any) => TARGET_TABLES.includes(index.table_name))
            : [];
          
          console.log(`Returning ${filteredIndexes.length} indexes for target tables`);
          return filteredIndexes;
        },
        parameters: z.object({}),
      }),

      getTableStats: tool({
        description:
          'Retrieves statistics about tables, including row counts and sizes.',
        execute: async () => {
          const stats = await getTableStats(connectionString)
          
          // Filter stats to only include target tables
          const filteredStats = Array.isArray(stats)
            ? stats.filter((stat: any) => TARGET_TABLES.includes(stat.table_name))
            : [];
          
          console.log(`Returning statistics for ${filteredStats.length} target tables`);
          return filteredStats;
        },
        parameters: z.object({}),
      }),

      getForeignKeyConstraints: tool({
        description:
          'Retrieves information about foreign key relationships between tables.',
        execute: async () => {
          const constraints = await getForeignKeyConstraints(connectionString)
          
          // Filter constraints to only include relationships between target tables
          const filteredConstraints = Array.isArray(constraints)
            ? constraints.filter((constraint: any) => 
                TARGET_TABLES.includes(constraint.tableName) && 
                TARGET_TABLES.includes(constraint.foreignTableName)
              )
            : [];
          
          console.log(`Returning ${filteredConstraints.length} foreign key constraints for target tables`);
          return filteredConstraints;
        },
        parameters: z.object({}),
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

  console.log(`Total request processing time: ${Date.now() - startTime}ms`);
  console.log('Returning stream response')
  return result.toDataStreamResponse({
    headers: {
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  })
}
