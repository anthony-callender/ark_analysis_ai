import { createOpenAI } from '@ai-sdk/openai'
import { streamText, convertToCoreMessages } from 'ai'
import { QueryConstructorResponse, NullHandlerResponse, PrimaryTablesResponse, ScoreCalculationResponse, QueryRulesResponse, SchemaVerificationResponse, QueryGenerationResponse } from './types'
import { DIOCESE_CONFIG } from '@/config/diocese'
import { 
  getPublicTablesWithColumns,
  getIndexes,
  getIndexStatsUsage,
  getTableStats,
  getForeignKeyConstraints,
  getExplainForQuery
} from '../utils'

export async function executeQueryWorkflow(
  userQuery: string,
  connectionString: string,
  openaiApiKey: string
) {
  console.log('Starting workflow with query:', userQuery)
  
  // Layer 1: Query Constructor
  console.log('Executing Query Constructor')
  const constructorResponse = await executeQueryConstructor(userQuery, openaiApiKey, connectionString)
  console.log('Query Constructor response:', constructorResponse)
  
  if (!constructorResponse.isValid) {
    console.log('Query Constructor failed')
    return {
      error: constructorResponse.feedback,
      query: null
    }
  }

  // Layer 2: Parallel Agent Execution
  console.log('Starting parallel agent execution')
  try {
    console.log('Executing all agents in parallel...')
    const [nullHandler, primaryTables, scoreCalc, queryRules, schemaVerification] = await Promise.all([
      executeNullHandler(constructorResponse.query, openaiApiKey, connectionString).catch(err => {
        console.error('Null Handler error:', err)
        return {
          query: constructorResponse.query,
          feedback: 'Error in null handling analysis: ' + err.message,
          isValid: false,
          constructedQuery: constructorResponse.query,
          nullHandlingSuggestions: []
        } as NullHandlerResponse
      }),
      executePrimaryTables(constructorResponse.query, openaiApiKey, connectionString).catch(err => {
        console.error('Primary Tables error:', err)
        return {
          query: constructorResponse.query,
          feedback: 'Error in primary tables analysis: ' + err.message,
          isValid: false,
          constructedQuery: constructorResponse.query,
          tableUsageFeedback: '',
          roleFilteringFeedback: ''
        } as PrimaryTablesResponse
      }),
      executeScoreCalculation(constructorResponse.query, openaiApiKey, connectionString).catch(err => {
        console.error('Score Calculation error:', err)
        return {
          query: constructorResponse.query,
          feedback: 'Error in score calculation analysis: ' + err.message,
          isValid: false,
          constructedQuery: constructorResponse.query,
          scoreCalculationFeedback: ''
        } as ScoreCalculationResponse
      }),
      executeQueryRules(constructorResponse.query, connectionString, openaiApiKey).catch(err => {
        console.error('Query Rules error:', err)
        return {
          query: constructorResponse.query,
          feedback: 'Error in query rules analysis: ' + err.message,
          isValid: false,
          constructedQuery: constructorResponse.query,
          ruleViolations: []
        } as QueryRulesResponse
      }),
      executeSchemaVerification(constructorResponse.query, connectionString, openaiApiKey).catch(err => {
        console.error('Schema Verification error:', err)
        return {
          query: constructorResponse.query,
          feedback: 'Error in schema verification analysis: ' + err.message,
          isValid: false,
          constructedQuery: constructorResponse.query,
          schemaIssues: [],
          alternativeSuggestions: []
        } as SchemaVerificationResponse
      })
    ])

    console.log('Parallel agent execution completed')
    console.log('Agent Results:')
    console.log('1. Null Handler:', JSON.stringify(nullHandler, null, 2))
    console.log('2. Primary Tables:', JSON.stringify(primaryTables, null, 2))
    console.log('3. Score Calculation:', JSON.stringify(scoreCalc, null, 2))
    console.log('4. Query Rules:', JSON.stringify(queryRules, null, 2))
    console.log('5. Schema Verification:', JSON.stringify(schemaVerification, null, 2))

    // Layer 3: Query Generation
    console.log('Starting Query Generation')
    const finalResponse = await executeQueryGeneration(
      constructorResponse.query,
      [nullHandler, primaryTables, scoreCalc, queryRules, schemaVerification],
      connectionString,
      openaiApiKey
    )
    console.log('Query Generation completed:', JSON.stringify(finalResponse, null, 2))

    return {
      query: finalResponse.finalQuery,
      optimizationNotes: finalResponse.optimizationNotes,
      feedback: {
        nullHandler: nullHandler.feedback,
        primaryTables: primaryTables.feedback,
        scoreCalc: scoreCalc.feedback,
        queryRules: queryRules.feedback,
        schemaVerification: schemaVerification.feedback
      }
    }
  } catch (error) {
    console.error('Error in workflow execution:', error)
    return {
      error: 'Error in workflow execution: ' + (error as Error).message,
      query: null
    }
  }
}

async function executeQueryConstructor(
  userQuery: string,
  openaiApiKey: string,
  connectionString: string
): Promise<QueryConstructorResponse> {
  console.log('Starting Query Constructor with query:', userQuery)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  try {
    // Get actual schema information
    console.log('Fetching schema information for query construction...')
    const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
    
    // Type guard for tablesWithColumns
    if (typeof tablesWithColumns === 'string') {
      throw new Error('Failed to fetch tables with columns: ' + tablesWithColumns)
    }

    console.log('Schema information retrieved for query construction:')
    console.log('- Tables with columns:', JSON.stringify(tablesWithColumns, null, 2))
    
    const result = await streamText({
      model: openai('gpt-4o'),
      messages: convertToCoreMessages([{ role: 'user', content: userQuery }]),
      system: `You are a PostgreSQL database optimization expert specializing in both query performance tuning and SQL query construction. Your primary objective is to always provide a direct, complete, and executable SQL query as your response whenever possible, rather than vague or generic explanations.

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



      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\`

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Query Construction Rules:
1. Only use tables and columns that exist in the provided schema
2. If a required table or column doesn't exist, suggest alternatives from the available schema
3. Always include proper JOIN conditions using existing foreign keys
4. Use proper NULL handling with COALESCE and NULLIF
5. Include appropriate WHERE clauses for filtering
6. Use proper GROUP BY and ORDER BY clauses
7. Include LIMIT when appropriate
8. Use proper aliases for tables and columns
9. Format the query for readability
10. Include comments explaining complex parts of the query`
    })

    let text = ''
    const stream = result.textStream
    for await (const chunk of stream) {
      text += chunk
    }

    console.log('Query Constructor generated text:', text)
    
    // Extract the SQL query from the response
    const sqlQuery = text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || text
    
    return {
      query: sqlQuery,
      feedback: 'Initial query constructed',
      isValid: true,
      originalQuery: sqlQuery,
      constructedQuery: sqlQuery
    }
  } catch (error) {
    console.error('Error in query construction:', error)
    return {
      query: '',
      feedback: 'Error in query construction: ' + (error as Error).message,
      isValid: false,
      originalQuery: '',
      constructedQuery: ''
    }
  }
}

async function executeNullHandler(
  query: string,
  openaiApiKey: string,
  connectionString: string
): Promise<NullHandlerResponse> {
  console.log('Starting Null Handler with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  // Get schema information for better NULL handling
  const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
  const indexes = await getIndexes(connectionString)
  const foreignKeys = await getForeignKeyConstraints(connectionString)
  
  const result = await streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages([{ role: 'user', content: query }]),
    system: `**NULL Handling Requirements:**
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


      **Academic Year Filtering:**
      - When filtering for "last year" or "previous year":
        - DO NOT use current_year = FALSE (this includes ALL previous years)
        - DO NOT hardcode year IDs like '2022-2023'
        - Instead, use academic_year_id = current_year_id - 1
        - Example: If current_year_id = 5, then last year is id = 4
        - ALWAYS use relative IDs (current_year_id - 1) for "last year" queries
        - NEVER assume specific year IDs without checking current_year_id first


      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\`

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Key Responsibilities/Focus:
- Construct a query with proper use of Null rules and role handling teachers = 5, students = 7`
  })

  let text = ''
  const stream = result.textStream
  for await (const chunk of stream) {
    text += chunk
  }

  console.log('Null Handler generated text:', text)
  
  return {
    query,
    feedback: text,
    isValid: true,
    constructedQuery: text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query,
    nullHandlingSuggestions: text.split('\n').filter(line => line.trim())
  }
}

async function executePrimaryTables(
  query: string,
  openaiApiKey: string,
  connectionString: string
): Promise<PrimaryTablesResponse> {
  console.log('Starting Primary Tables with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  // Get schema information for table analysis
  const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
  const indexes = await getIndexes(connectionString)
  const foreignKeys = await getForeignKeyConstraints(connectionString)
  const tableStats = await getTableStats(connectionString)
  
  const result = await streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages([{ role: 'user', content: query }]),
    system: `PRIMARY TABLES AND RULES:
The following tables should be used as the primary source for answering queries, in order of preference:
1. Core Testing Tables:
   - testing_section_students (testing results for all users - MUST filter by user role)
   - testing_sections (testing sections of a school)
   - testing_centers (schools)
   - subject_areas (subject categorization)

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Table Statistics:
${JSON.stringify(tableStats, null, 2)}

Key Responsibilities/Focus:
- Confirm that the initial query uses the primary tables first
- Enforce the rule of filtering by role teachers = 5, students = 7
- Ensure proper join paths and access restrictions`
  })

  let text = ''
  const stream = result.textStream
  for await (const chunk of stream) {
    text += chunk
  }

  console.log('Primary Tables generated text:', text)
  
  return {
    query,
    feedback: text,
    isValid: true,
    constructedQuery: text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query,
    tableUsageFeedback: text,
    roleFilteringFeedback: text
  }
}

async function executeScoreCalculation(
  query: string,
  openaiApiKey: string,
  connectionString: string
): Promise<ScoreCalculationResponse> {
  console.log('Starting Score Calculation with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  // Get schema information for score analysis
  const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
  const indexes = await getIndexes(connectionString)
  const foreignKeys = await getForeignKeyConstraints(connectionString)
  const tableStats = await getTableStats(connectionString)
  
  const result = await streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages([{ role: 'user', content: query }]),
    system: `SCORE CALCULATION RULES:
For any queries involving student scores (knowledge, math, theology, reading):
- Score columns in testing_section_students:
  * knowledge_score: Raw score achieved
  * knowledge_total: Total possible score
- Score calculation formula: (knowledge_score / NULLIF(knowledge_total, 0)) * 100
- Use NULLIF to prevent division by zero
- Handle NULL results with COALESCE to provide a default value (e.g., 0)

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Table Statistics:
${JSON.stringify(tableStats, null, 2)}

Key Responsibilities/Focus:
- Verify that the score calculation formula is correctly applied
- Ensure proper NULL handling for score-related columns
- Check proper table joins and role filtering
- Constuct a query that uses the correct join paths and follows score calculation rules.

      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\`
`
  })

  let text = ''
  const stream = result.textStream
  for await (const chunk of stream) {
    text += chunk
  }

  console.log('Score Calculation generated text:', text)
  
  return {
    query,
    feedback: text,
    isValid: true,
    constructedQuery: text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query,
    scoreCalculationFeedback: text
  }
}

async function executeQueryRules(
  query: string,
  connectionString: string,
  openaiApiKey: string
): Promise<QueryRulesResponse> {
  console.log('Starting Query Rules with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  // Get all schema and statistics information
  const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
  const indexes = await getIndexes(connectionString)
  const foreignKeys = await getForeignKeyConstraints(connectionString)
  const tableStats = await getTableStats(connectionString)
  const indexStats = await getIndexStatsUsage(connectionString)
  
  const result = await streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages([{ role: 'user', content: query }]),
    system: `QUERY RULES:
1. Table Relationships:
   - ALWAYS join back to testing_center table to get diocese_id
   - Use this join path: table → testing_section_students → testing_sections → testing_center
   - For subject-specific queries: JOIN subject_areas ON testing_section_students.subject_area_id = subject_areas.id

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Table Statistics:
${JSON.stringify(tableStats, null, 2)}

Index Usage Statistics:
${JSON.stringify(indexStats, null, 2)}

Key Responsibilities/Focus:
- Validate overall query structure
- Confirm correct join relationships
- Check inclusion of mandatory filters
- Ensure proper index usage
- Constuct a query that uses the correct join paths.

      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\``
  })

  let text = ''
  const stream = result.textStream
  for await (const chunk of stream) {
    text += chunk
  }

  console.log('Query Rules generated text:', text)
  
  return {
    query,
    feedback: text,
    isValid: true,
    constructedQuery: text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query,
    ruleViolations: text.split('\n').filter(line => line.trim())
  }
}

async function executeSchemaVerification(
  query: string,
  connectionString: string,
  openaiApiKey: string
): Promise<SchemaVerificationResponse> {
  console.log('Starting Schema Verification with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  try {
    // Get actual schema information
    console.log('Fetching schema information...')
    const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
    const indexes = await getIndexes(connectionString)
    const foreignKeys = await getForeignKeyConstraints(connectionString)
    
    console.log('Schema information retrieved:')
    console.log('- Tables with columns:', JSON.stringify(tablesWithColumns, null, 2))
    console.log('- Indexes:', JSON.stringify(indexes, null, 2))
    console.log('- Foreign keys:', JSON.stringify(foreignKeys, null, 2))

    // Type guard for tablesWithColumns
    if (typeof tablesWithColumns === 'string') {
      throw new Error('Failed to fetch tables with columns: ' + tablesWithColumns)
    }

    // Extract table and column names from the query
    const tableMatches = query.match(/FROM\s+([a-zA-Z_]+)|JOIN\s+([a-zA-Z_]+)/gi) || []
    const tables = tableMatches.map(match => {
      const table = match.split(/\s+/).pop()
      return table?.toLowerCase()
    }).filter((table): table is string => table !== undefined)

    const columnMatches = query.match(/(?:SELECT|WHERE|GROUP BY|ORDER BY|HAVING)\s+([^,;]+)/gi) || []
    const columns = columnMatches.flatMap(match => {
      const parts = match.split(/\s+/)
      return parts.slice(1).map(part => part.split('.')[1]?.toLowerCase()).filter((col): col is string => col !== undefined)
    })

    console.log('Extracted from query:')
    console.log('- Tables:', tables)
    console.log('- Columns:', columns)

    // Validate tables and columns
    const schemaIssues: string[] = []
    const alternativeSuggestions: string[] = []

    // Check table existence
    for (const table of tables) {
      const tableExists = tablesWithColumns.some((t: { tableName: string }) => t.tableName.toLowerCase() === table)
      if (!tableExists) {
        schemaIssues.push(`Table "${table}" does not exist in the database`)
        // Suggest similar tables
        const similarTables = tablesWithColumns
          .filter((t: { tableName: string }) => 
            t.tableName.toLowerCase().includes(table) || 
            table.includes(t.tableName.toLowerCase())
          )
          .map((t: { tableName: string }) => t.tableName)
        if (similarTables.length > 0) {
          alternativeSuggestions.push(`Consider using one of these existing tables instead: ${similarTables.join(', ')}`)
        }
      }
    }

    // Check column existence for each table
    for (const table of tables) {
      const tableInfo = tablesWithColumns.find((t: { tableName: string }) => t.tableName.toLowerCase() === table)
      if (tableInfo) {
        const tableColumns = tableInfo.columns.map((c: { name: string }) => c.name.toLowerCase())
        const queryColumns = columns.filter(col => col.startsWith(table + '.'))
        for (const column of queryColumns) {
          const columnName = column.split('.')[1]
          if (!tableColumns.includes(columnName)) {
            schemaIssues.push(`Column "${columnName}" does not exist in table "${table}"`)
            // Suggest similar columns
            const similarColumns = tableColumns
              .filter(c => c.includes(columnName) || columnName.includes(c))
            if (similarColumns.length > 0) {
              alternativeSuggestions.push(`Consider using one of these existing columns in table "${table}": ${similarColumns.join(', ')}`)
            }
          }
        }
      }
    }

    // Check join conditions
    const joinMatches = query.match(/JOIN\s+[a-zA-Z_]+\s+ON\s+([^;]+)/gi) || []
    for (const join of joinMatches) {
      const conditions = join.split('ON')[1].split('AND').map(c => c.trim())
      for (const condition of conditions) {
        const [left, right] = condition.split('=').map(s => s.trim())
        const [leftTable, leftCol] = left.split('.')
        const [rightTable, rightCol] = right.split('.')
        
        // Check if join columns exist
        if (leftTable && leftCol) {
          const leftTableInfo = tablesWithColumns.find((t: { tableName: string }) => t.tableName.toLowerCase() === leftTable.toLowerCase())
          if (leftTableInfo && !leftTableInfo.columns.some((c: { name: string }) => c.name.toLowerCase() === leftCol.toLowerCase())) {
            schemaIssues.push(`Join column "${leftCol}" does not exist in table "${leftTable}"`)
          }
        }
        if (rightTable && rightCol) {
          const rightTableInfo = tablesWithColumns.find((t: { tableName: string }) => t.tableName.toLowerCase() === rightTable.toLowerCase())
          if (rightTableInfo && !rightTableInfo.columns.some((c: { name: string }) => c.name.toLowerCase() === rightCol.toLowerCase())) {
            schemaIssues.push(`Join column "${rightCol}" does not exist in table "${rightTable}"`)
          }
        }
      }
    }
    
    const result = await streamText({
      model: openai('gpt-4o'),
      messages: convertToCoreMessages([{ role: 'user', content: query }]),
      system: `
**Schema Verification:**
      Before constructing any query:
      1. Use getPublicTablesWithColumns to verify all tables and columns exist
      2. Never guess table or column names - always verify first
      3. If schema information is insufficient, ask for clarification
      4. Role IDs must be used correctly:
         - Teachers: role = 5
         - Students: role = 7

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

4. Required Checks:
   - Verify all table names exist in the schema
   - Verify all column names exist in their respective tables
   - Check for proper join conditions using existing foreign keys
   - Ensure all referenced indexes exist
   - Validate data types for comparisons and operations

Key Responsibilities/Focus:
- Check if the tables/columns referenced in the constructed query exist in the known schema.
- Construct a query that uses the correct tables AND columns (that exist in the schema) first AND filters by role correctly.

      **Direct Query Response Requirement:**
      - In at least 99% of interactions, if the user's request is related to retrieving data or constructing a query (e.g. "How many users do I have?"), your response must include a SQL query enclosed in a code block. For example, for "How many users do I have?" a correct response would be:
        
         \`\`\`sql
        SELECT COUNT(*) AS total_users
        FROM users;
         \`\`\`

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Schema Issues Found:
${JSON.stringify(schemaIssues, null, 2)}

Alternative Suggestions:
${JSON.stringify(alternativeSuggestions, null, 2)}`
    })

    let text = ''
    const stream = result.textStream
    for await (const chunk of stream) {
      text += chunk
    }

    console.log('Schema Verification generated text:', text)
    
    return {
      query,
      feedback: text,
      isValid: schemaIssues.length === 0,
      constructedQuery: text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query,
      schemaIssues,
      alternativeSuggestions
    }
  } catch (error) {
    console.error('Error in schema verification:', error)
    return {
      query,
      feedback: 'Error in schema verification: ' + (error as Error).message,
      isValid: false,
      constructedQuery: '',
      schemaIssues: ['Error occurred during schema verification'],
      alternativeSuggestions: []
    }
  }
}

async function executeQueryGeneration(
  query: string,
  agentResponses: [NullHandlerResponse, PrimaryTablesResponse, ScoreCalculationResponse, QueryRulesResponse, SchemaVerificationResponse],
  connectionString: string,
  openaiApiKey: string
): Promise<QueryGenerationResponse> {
  console.log('Starting Query Generation with query:', query)
  const openai = createOpenAI({ apiKey: openaiApiKey })
  
  // Get actual schema information
  const tablesWithColumns = await getPublicTablesWithColumns(connectionString)
  const indexes = await getIndexes(connectionString)
  const foreignKeys = await getForeignKeyConstraints(connectionString)
  
  // Combine feedback and queries from all agents
  const feedbackSummary = `NULL Handling Feedback:
${agentResponses[0].feedback}

Primary Tables Feedback:
${agentResponses[1].feedback}

Score Calculation Feedback:
${agentResponses[2].feedback}

Query Rules Feedback:
${agentResponses[3].feedback}

Schema Verification Feedback:
${agentResponses[4].feedback}

Source Queries:
1. Null Handler Query:
\`\`\`sql
${agentResponses[0].constructedQuery}
\`\`\`

2. Primary Tables Query:
\`\`\`sql
${agentResponses[1].constructedQuery}
\`\`\`

3. Score Calculation Query:
\`\`\`sql
${agentResponses[2].constructedQuery}
\`\`\`

4. Query Rules Query:
\`\`\`sql
${agentResponses[3].constructedQuery}
\`\`\`

5. Schema Verification Query:
\`\`\`sql
${agentResponses[4].constructedQuery}
\`\`\`
`
  
  const result = await streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages([
      { role: 'user', content: query },
      { role: 'system', content: feedbackSummary }
    ]),
    system: `Query Generation Process:
1. Analyze all source queries from each agent
2. Combine the best features from each query:
   - NULL handling improvements from Null Handler
   - Table usage optimizations from Primary Tables
   - Score calculation improvements from Score Calculation
   - Query structure improvements from Query Rules
   - Schema validation improvements from Schema Verification
3. Create a final query that incorporates all optimizations
4. Ensure the final query is valid and executable
5. Document which features came from which agent
6. INCLUDE ALL FEATURES FROM ALL AGENTS IN THE FINAL QUERY  

Available Tables and Columns:
${JSON.stringify(tablesWithColumns, null, 2)}

Indexes:
${JSON.stringify(indexes, null, 2)}

Foreign Key Constraints:
${JSON.stringify(foreignKeys, null, 2)}

Key Responsibilities/Focus:
- Analyze each source query for its unique optimizations
- Combine the best features from all queries into a single optimized query
- Ensure all optimizations work together harmoniously
- Document the source of each optimization
- Verify the final query against all rules and constraints
- INCLUDE ALL FEATURES FROM ALL AGENTS IN THE FINAL QUERY`
  })

  let text = ''
  const stream = result.textStream
  for await (const chunk of stream) {
    text += chunk
  }

  console.log('Query Generation generated text:', text)

  // Extract the final SQL query from the response
  const finalQuery = text.match(/```sql\n([\s\S]*?)\n```/)?.[1] || query

  // Get query explanation
  const explainResult = await getExplainForQuery(finalQuery, connectionString)
  
  return {
    query,
    feedback: text,
    isValid: true,
    constructedQuery: finalQuery,
    finalQuery,
    optimizationNotes: `Query Explanation:\n${JSON.stringify(explainResult, null, 2)}\n\n${text}`,
    sourceQueries: {
      nullHandler: agentResponses[0].constructedQuery,
      primaryTables: agentResponses[1].constructedQuery,
      scoreCalculation: agentResponses[2].constructedQuery,
      queryRules: agentResponses[3].constructedQuery,
      schemaVerification: agentResponses[4].constructedQuery
    }
  }
} 