import { Client as PGClient } from 'pg'
import { DIOCESE_CONFIG } from '@/config/diocese'
import {
  QUESTION_REFERENCES,
  NULL_HANDLING_PATTERNS,
  TABLE_RELATIONSHIPS,
  SCORE_CALCULATION,
  ROLE_TYPES
} from '@/config/prompt-references'

export async function getPublicTablesWithColumns(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    // Get tables
    const tablesRes = await client.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `)

    // Get columns for each table
    const tablesWithColumns = await Promise.all(
      tablesRes.rows.map(async (table) => {
        const columnsRes = await client.query(
          `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
          [table.table_schema, table.table_name]
        )

        return {
          tableName: table.table_name,
          schemaName: table.table_schema,
          columns: columnsRes.rows.map((col) => ({
            name: col.column_name,
            type: col.data_type,
            isNullable: col.is_nullable === 'YES',
          })),
        }
      })
    )

    await client.end()

    // Add diocese-specific information to relevant tables
    return tablesWithColumns.map(table => {
      // Check if this table needs diocese filtering
      const needsDioceseFilter = DIOCESE_CONFIG.protectedTables.includes(table.tableName)

      // Check if this table has a direct diocese_id column
      const hasDioceseColumn = table.columns.some(col => col.name === 'diocese_id')

      // Determine the join path needed
      let joinPath = ''
      if (needsDioceseFilter) {
        if (table.tableName === 'testing_center') {
          joinPath = 'Direct access - contains diocese_id'
        } else if (table.tableName === 'testing_sections') {
          joinPath = 'Join with testing_center'
        } else if (table.tableName === 'testing_section_students') {
          joinPath = 'Join with testing_sections → testing_center'
        } else {
          joinPath = 'Join with testing_section_students → testing_sections → testing_center'
        }
      }

      return {
        ...table,
        description: needsDioceseFilter ? {
          requiresDioceseFilter: true,
          joinPath,
          hasDirectDioceseColumn: hasDioceseColumn,
          example: `-- Example query for ${table.tableName}:
SELECT *
FROM ${table.tableName} t
${joinPath === 'Direct access - contains diocese_id' 
  ? `WHERE t.diocese_id = ${DIOCESE_CONFIG.id}`
  : `JOIN testing_section_students tss ON tss.${table.tableName}_id = t.id
JOIN testing_sections ts ON ts.id = tss.testing_section_id
JOIN testing_centers tc ON tc.id = ts.testing_center_id
WHERE tc.diocese_id = ${DIOCESE_CONFIG.id}`}`
        } : undefined
      }
    })
  } catch (error) {
    console.error('Error fetching tables with columns:', error)
    await client.end()
    return `Error fetching tables with columns: ${error}`
  }
}

export async function getExplainForQuery(
  query: string,
  connectionString: string
) {
  const explainAnalyzeRegex = /explain\s+analyze\s+(.*)/i
  const explainRegex = /explain\s+(.*)/i

  let queryToRun = query

  const match =
    queryToRun.match(explainAnalyzeRegex) || queryToRun.match(explainRegex)

  if (match) {
    // Remove EXPLAIN or EXPLAIN ANALYZE
    queryToRun = match[1].trim()
  }

  const client = new PGClient(connectionString)

  try {
    await client.connect()

    const explain = await client.query(`EXPLAIN (FORMAT JSON) ${queryToRun}`)
    await client.end()

    return explain.rows[0]['QUERY PLAN']
  } catch (error) {
    console.error('Error running EXPLAIN:', error)
    await client.end()
    return `Error running EXPLAIN: ${error}`
  }
}

export async function getIndexStatsUsage(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        schemaname,
        relname,
        indexrelname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM
        pg_stat_user_indexes
      ORDER BY
        schemaname,
        relname,
        indexrelname;
    `)

    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching index stats usage:', error)
    await client.end()
    return `Error fetching index stats usage: ${error}`
  }
}

export async function getIndexes(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        indexname,
        tablename,
        schemaname,
        indexdef
      FROM
        pg_indexes
      WHERE
        schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY
        schemaname,
        tablename,
        indexname;
    `)

    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching indexes:', error)
    await client.end()
    return `Error fetching indexes: ${error}`
  }
}

export async function getTableStats(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        schemaname,
        relname as table_name,
        n_live_tup as row_count,
        pg_total_relation_size(relid) as total_size,
        pg_relation_size(relid) as table_size,
        pg_indexes_size(relid) as indexes_size,
        last_vacuum,
        last_analyze
      FROM
        pg_stat_user_tables
      ORDER BY
        total_size DESC;
    `)
    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching table stats:', error)
    await client.end()
    return `Error fetching table stats: ${error}`
  }
}

export async function getColumnStats(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        schemaname,
        tablename,
        attname as column_name,
        n_distinct::float,
        null_frac,
        avg_width,
        most_common_vals,
        most_common_freqs
      FROM
        pg_stats
      WHERE
        schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY
        schemaname,
        tablename,
        attname;
    `)
    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching column stats:', error)
    await client.end()
    return `Error fetching column stats: ${error}`
  }
}

export async function getDetailedIndexStats(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        s.schemaname,
        s.relname as table_name,
        s.indexrelname as index_name,
        s.idx_scan as index_scans,
        s.idx_tup_read as tuples_read,
        s.idx_tup_fetch as tuples_fetched,
        pg_relation_size(s.indexrelid) as index_size
      FROM
        pg_stat_user_indexes s
        JOIN pg_index i ON s.indexrelid = i.indexrelid
      ORDER BY
        s.idx_scan DESC;
    `)
    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching detailed index stats:', error)
    await client.end()
    return `Error fetching detailed index stats: ${error}`
  }
}

export async function getForeignKeyConstraints(connectionString: string) {
  const client = new PGClient(connectionString)
  await client.connect()

  try {
    const result = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY';
    `)
    await client.end()
    return result.rows
  } catch (error) {
    console.error('Error fetching foreign key constraints:', error)
    await client.end()
    return `Error fetching foreign key constraints: ${error}`
  }
}

export const determineQueryType = (query: string): string[] => {
  const types: string[] = [];
  
  // Check for question-related queries
  if (query.toLowerCase().includes('eucharist') || 
      query.toLowerCase().includes('mass') || 
      query.toLowerCase().includes('baptism')) {
    types.push('question_analysis');
  }
  
  // Check for score-related queries
  if (query.toLowerCase().includes('score') || 
      query.toLowerCase().includes('average') || 
      query.toLowerCase().includes('calculation')) {
    types.push('score_calculation');
  }
  
  // Check for NULL handling
  if (query.toLowerCase().includes('null') || 
      query.toLowerCase().includes('coalesce') || 
      query.toLowerCase().includes('nullif')) {
    types.push('null_handling');
  }
  
  // Always include table relationships
  types.push('table_relationships');
  
  return types;
};

export const getReferenceSection = (types: string[]) => {
  const references = [];
  
  if (types.includes('question_analysis')) {
    references.push(`
    **Question References:**
    ${Object.entries(QUESTION_REFERENCES)
      .map(([key, value]) => 
        `${value.text} (id = ${value.id}):
        ${Object.entries(value.answers)
          .map(([id, text]) => `- ${id} = ${text}`)
          .join('\n        ')}`
      )
      .join('\n\n    ')}
    `);
  }
  
  if (types.includes('score_calculation')) {
    references.push(`
    **Score Calculation:**
    Formula: ${SCORE_CALCULATION.formula}
    Common Subjects: ${SCORE_CALCULATION.common_subjects.join(', ')}
    `);
  }
  
  if (types.includes('null_handling')) {
    references.push(`
    **NULL Handling Patterns:**
    ${Object.entries(NULL_HANDLING_PATTERNS)
      .map(([type, pattern]) => `- ${type}: ${pattern}`)
      .join('\n    ')}
    `);
  }
  
  if (types.includes('table_relationships')) {
    references.push(`
    **Table Relationships:**
    Core Tables:
    ${Object.entries(TABLE_RELATIONSHIPS.core)
      .map(([table, desc]) => `- ${table}: ${desc}`)
      .join('\n    ')}
    
    User Tables:
    ${Object.entries(TABLE_RELATIONSHIPS.user)
      .map(([table, desc]) => `- ${table}: ${desc}`)
      .join('\n    ')}
    
    Organizational Tables:
    ${Object.entries(TABLE_RELATIONSHIPS.organizational)
      .map(([table, desc]) => `- ${table}: ${desc}`)
      .join('\n    ')}
    `);
  }
  
  return references.join('\n\n');
};

export interface QueryValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateQuery(query: string, connectionString: string): Promise<QueryValidationResult> {
  const result: QueryValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // 1. Check for NULL handling
  const nullHandlingChecks = [
    { 
      pattern: /knowledge_score\s*\/\s*knowledge_total/, 
      required: [
        'WHERE knowledge_score IS NOT NULL',
        'WHERE knowledge_total IS NOT NULL',
        'WHERE knowledge_total > 0',
        SCORE_CALCULATION.formula
      ],
      description: 'score calculation'
    }
  ];

  for (const check of nullHandlingChecks) {
    if (check.pattern.test(query)) {
      for (const required of check.required) {
        if (!query.includes(required)) {
          result.errors.push(`Missing proper NULL handling in ${check.description}. Must include: ${required}`);
          result.isValid = false;
        }
      }
    }
  }

  // 2. Check for ID usage in operations
  const idUsageChecks = [
    { operation: 'GROUP BY', pattern: /GROUP BY\s+([^;]+)/gi },
    { operation: 'JOIN', pattern: /JOIN\s+[^\s]+\s+ON\s+([^;]+)\s*=/gi },
    { operation: 'WHERE', pattern: /WHERE\s+([^;]+)/gi },
    { operation: 'DISTINCT', pattern: /DISTINCT\s+([^;]+)/gi }
  ];

  for (const check of idUsageChecks) {
    const matches = Array.from(query.matchAll(check.pattern));
    for (const match of matches) {
      const columns = match[1].split(',').map(col => col.trim());
      for (const column of columns) {
        if (column.includes('name') && !column.includes('id')) {
          result.errors.push(`Using name instead of ID in ${check.operation} operation: ${column}`);
          result.isValid = false;
        }
      }
    }
  }

  // 3. Check for role-based filtering
  if (query.includes('testing_section_students') || query.includes('user_answers')) {
    const roleCheck = query.includes(`role = ${ROLE_TYPES.teachers}`) || 
                     query.includes(`role = ${ROLE_TYPES.students}`);
    if (!roleCheck) {
      result.errors.push(`Missing valid role filter. Must use role = ${ROLE_TYPES.teachers} for teachers or role = ${ROLE_TYPES.students} for students`);
      result.isValid = false;
    }
  }

  // 4. Check for diocese and testing center filters
  if (DIOCESE_CONFIG.role !== 'super_admin') {
    if (!query.includes(`diocese_id = ${DIOCESE_CONFIG.id}`)) {
      result.errors.push(`Missing diocese_id filter: diocese_id = ${DIOCESE_CONFIG.id}`);
      result.isValid = false;
    }
    if (DIOCESE_CONFIG.role === 'school_manager' && !query.includes(`testing_center_id = ${DIOCESE_CONFIG.testingCenterId}`)) {
      result.errors.push(`Missing testing_center_id filter: testing_center_id = ${DIOCESE_CONFIG.testingCenterId}`);
      result.isValid = false;
    }
  }

  // 5. Check for column existence
  const tables = await getPublicTablesWithColumns(connectionString);
  if (typeof tables === 'string') {
    result.errors.push(tables);
    result.isValid = false;
    return result;
  }

  // Simple check for columns in SELECT and WHERE clauses
  const columnPattern = /SELECT\s+([^FROM]+)\s+FROM|WHERE\s+([^;]+)/gi;
  const matches = Array.from(query.matchAll(columnPattern));
  
  for (const match of matches) {
    const columns = (match[1] || match[2]).split(',').map(col => col.trim());
    for (const column of columns) {
      // Skip * and aggregate functions
      if (column === '*' || column.includes('(')) continue;

      // Get table and column name
      const [tableName, columnName] = column.split('.').map(part => part.trim());
      const table = tables.find(t => t.tableName === tableName);
      
      if (table && !table.columns.some(col => col.name === columnName)) {
        result.errors.push(`Column ${columnName} does not exist in table ${tableName}`);
        result.isValid = false;
      }
    }
  }

  // 6. Check for proper join paths
  const joinPathChecks = [
    { table: 'testing_sections', required: 'testing_center' },
    { table: 'testing_section_students', required: 'testing_sections' }
  ];

  for (const check of joinPathChecks) {
    if (query.includes(check.table) && !query.includes(check.required)) {
      result.warnings.push(`Missing join with ${check.required} table when using ${check.table}`);
    }
  }

  return result;
}
