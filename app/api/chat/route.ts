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

// Define documentation strings
const DOCUMENTATION = [
  // Original schema rules renamed as documentation
  "Always filter by user role when querying testing_section_students or user_answers tables",
  "Never assume a table contains data for only one user type without explicit filtering",
  "Tables may contain data for all users, not just the user type indicated in the table name",
  "When filtering for 'last year', use academic_year_id = current_year_id - 1, not current_year = FALSE",
  "Teachers have role = 5, Students have role = 7",
  "Score calculation formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100",
  "Always cast to float for score calculations: knowledge_score::float / knowledge_total::float",
  "Filter out NULL values before calculations: WHERE knowledge_score IS NOT NULL AND knowledge_total IS NOT NULL",
  "For dioceses, use 'Diocese of [diocese name]' OR 'Archdiocese of [archdiocese name]'",
  "Use IDs (not names) for GROUP BY clauses, JOIN conditions, and filtering",
  
  // New documentation strings
  "Each diocese name starts with either 'diocese of ___' or archdiocese of ___'",
  
  "For the academic_years table, the id column contains values that corresponds the academic years: '2020' = 1, '2021' = 2, '2022' = 3, '2023' = 4, '2024' = 5",
  
  "Use this hierarchy of relations to retrieve data for the following question: What is the average score in [subject] for [grade level]? hierarchy: diocese -> testing_center -> testing_sections -> testing_section_students",
  
  "Use this hierarchy of relations to retrieve data for the following question: What is the average score for [subject] in [dioceses] by grade? hierarchy: diocese -> testing_center -> testing_sections -> testing_section_students",
  
  "Use this hierarchy of relations to retrieve data for the following question: What is the average score in [subject] over the past [time period]? hierarchy: diocese -> testing_center -> testing_sections -> testing_section_students",
  
  "Use this hierarchy of relations to access subjects for anserwing subject related queries: subject_area -> testing_section_students",
  
  "Use the users table for any user related queries like total number of students or teachers. The role id for the students = 7 while the role id for teacher = 5",
  
  "The 'dioceses' table stores detailed information about each diocese within the organization. Each diocese is uniquely identified by 'id' and includes attributes such as name, address details, and various operational settings. Key attributes include: - **id**: Unique identifier for the diocese (Primary Key). - **name**: Name of the diocese. - **address_line_1 & address_line_2**: Address components for the diocese's location. - **city, state, zipcode, country**: Geographical information for the diocese's location. - **deactivate**: Boolean flag to deactivate the diocese.",
  
  "The 'testing_centers' table contains information about each testing center (school) affiliated with the organization. Each center is uniquely identified by 'id' and is associated with a specific diocese. Key attributes include: - **id**: Unique identifier for the testing center (Primary Key). - **name**: Name of the testing center (school). - **address_line_1 & address_line_2**: Address components for the testing center's (school) location. - **city, state, zipcode, country**: Geographical information for the testing center's (school) location. - **diocese_id**: References the diocese overseeing the center (Foreign Key to 'dioceses(id) table').",
  
  "The 'testing_sections' table details the various testing sections within each testing center. Each testing section is uniquely identified by 'id' and is linked to a testing center. Key attributes include: - **id**: Unique identifier for the testing section (Primary Key). - **testing_center_id**: References the testing center where the section is located (Foreign Key to 'public_testing_centers(id) table'). - **academic_year_id**: References the academic year id associated with the testing section (this is just the id, and not the year) (Foreign Key to 'academic_years'(id) table).",
  
  "The 'subject_areas' table enumerates the different subject areas available for testing. Each subject area is uniquely identified by 'id' and includes attributes such as name and timestamps. Key attributes include: - **id**: Unique identifier for the subject area ('Theology'=1, 'Reading'=2, 'Math'=3) ( (Primary Key). - **name**: Name of the subject area.",
  
  "The 'testing_section_students' table records information about students participating in specific testing sections and subject areas. Each record is uniquely identified by 'id' and includes various performance metrics and associations. Key attributes include: - **id**: Unique identifier for the student record (Primary Key). - **user_id**: References the user associated with the student (Foreign Key to 'users'(id) table). - **testing_section_id**: References the testing section the student is enrolled in (Foreign Key to 'testing_sections(id) table'). - **status**: Current status of the student in the testing process. - **completed_date**: Date when the student completed the testing. - **grade_level**: Grade level of the student. - **progress**: Progress metric indicating how much of the testing the student has completed. - **scored_status**: Boolean indicating if the student has been scored. - **knowledge_score** Scores reflecting how many questions the student got correct. - **affinity_score**: Scores reflecting the student's affinity. - **assessment_id**: References the specific assessment taken by the student. - **knowledge_total**: Total possible questions in assessment. - **affinity_total**: Total possible scores affinity. - **percentile_rank**: The student's percentile rank in the assessment. - **academic_year_id**: References the academic year id associated with the testing (this is just the id, and not the year) (Foreign Key to 'academic_years'(id) table). - **pre_test**: Boolean indicating if this was a pre-test. - **role**: Role of the student (e.g., participant, observer). - **diocese_specific_knowledge_score**: Scores specific to the diocese's metrics. - **diocese_specific_affinity_score**: Scores specific to the diocese's metrics. - **diocese_specific_knowledge_total**: Total possible scores for diocese-specific metrics. - **diocese_specific_affinity_total**: Total possible scores for diocese-specific metrics. - **subject_area_id**: References the subject area the student is tested in (Foreign Key to 'subject_areas(id) table'). - **assessment_window_id**: References the assessment window (Foreign Key to 'assessment_windows'(id) table).",
  
  "The 'testing_section_student_domain_scores' table records information about students participating in specific testing sections and domain areas. Domains include: \"Reading\", \"Mathematics\", \"Virtue\", \"Sacraments & Liturgy\", \"Prayer\", \"Morality\", \"Living Discipleship\", \"Creed & Salvation History\" All domain related questions will be quiered using the 'testing_section_student_domain_scores' table: - **id**: Unique identifier for the student record (Primary Key). - **testing_section_student_id**: References the testing section the student is enrolled in (Foreign Key to 'testing_sections(id) table'). - **knowledge_score** Domain scores reflecting how many questions the student got correct in a particular domain - **affinity_score**: Domain scores reflecting the student's affinity in a particular domain - **assessment_id**: References the specific assessment taken by the student. - **domain_id**: References the domain the student is tested in (Foreign Key to 'domains(id) table'). - **knowledge_total**: Total possible questions in assessment. - **affinity_total**: Total possible scores affinity."
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
  } else if (action === 'test_retrieval') {
    try {
      const projectOpenaiApiKey = process.env.OPENAI_API_KEY;
      if (!projectOpenaiApiKey) {
        return new Response('Missing OpenAI API Key', { status: 500 });
      }
      
      const vectorStore = await getVectorStore(projectOpenaiApiKey);
      const testQuery = searchParams.get('query') || 'knowledge score mass attendance';
      
      // Get all documentation from the vector store
      const supabase = vectorStore.getSupabaseClient();
      const { data: allDocs, error: docsError } = await supabase
        .from('schema_vectors')
        .select('*')
        .eq('type', 'documentation')
        .order('id');
        
      if (docsError) {
        return new Response(`Error fetching documentation: ${docsError.message}`, { status: 500 });
      }
      
      // Test retrieval with threshold = 0.29
      const relevantInfo = await vectorStore.searchSchemaInfo(testQuery, 20);
      
      // Format for display
      const results = {
        query: testQuery,
        threshold: 0.29,
        total_docs_in_store: allDocs.length,
        docs_retrieved: relevantInfo.length,
        all_documentation: allDocs.map(doc => ({ id: doc.id, content: doc.content })),
        retrieved_documentation: relevantInfo.map(doc => ({ 
          content: doc.content, 
          similarity: (doc as any).similarity
        }))
      };
      
      return new Response(JSON.stringify(results, null, 2), { 
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Error testing retrieval:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500 
      });
    }
  }
  
  return new Response(`
    Available actions:
    - ?action=rebuild_vectors - Clear and rebuild the vector store
    - ?action=test_retrieval&query=your query here - Test documentation retrieval with a specific query
  `, { 
    status: 200,
    headers: {
      'Content-Type': 'text/plain'
    }
  });
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
     
     The tools available to you serve the following purposes:
     - getPublicTablesWithColumns: Returns ALL tables and their structure available for querying
     - getRelevantDocumentation: Returns documentation relevant to the specific query, including schema guidance, table usage details, and query patterns
     
     When generating queries:
     1. First call getPublicTablesWithColumns to see all available tables
     2. Then call getRelevantDocumentation to get documentation relevant to your specific query
     3. Only use tables from the returned list - never reference tables not in this list
     4. Include all required filters and joins as specified in the documentation
     5. Use proper score calculations with NULLIF and type casting
     6. Follow the guidance provided by getRelevantDocumentation
     7. Present the final SQL query in a code block
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
              
              const storedCount = await vectorStore.storeSchemaInfo(typedTables, typedConstraints, DOCUMENTATION)
              console.log(`Stored ${storedCount} documentation vector entries`);
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

      getRelevantDocumentation: tool({
        description: 'Retrieves relevant documentation based on a natural language query. Unlike the getPublicTablesWithColumns tool which returns all tables, this tool returns documentation specific to your query, including schema guidance, table descriptions, and query patterns.',
        execute: async ({ query }) => {
          try {
            const infoTimerId = `getRelevantDocumentation-${Date.now()}`;
            console.time(infoTimerId);
            // Using higher limit (20) to ensure we get all relevant documentation
            const relevantInfo = await vectorStore.searchSchemaInfo(query, 20)
            
            // Format the results in a more readable way
            const formattedResults = relevantInfo.map(info => ({
              content: info.content,
              type: info.type,
              // Type fix - cast similarity from metadata if it exists
              similarity: (info as any).similarity
            }));
            
            console.log(`Retrieved ${formattedResults.length} documentation entries with threshold set to 0.29`);
            console.timeEnd(infoTimerId);
            return formattedResults
          } catch (error) {
            console.error('Error retrieving documentation:', error)
            throw new Error(`Failed to retrieve documentation: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        },
        parameters: z.object({
          query: z.string().describe('Natural language description of the documentation needed'),
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
