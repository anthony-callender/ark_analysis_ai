'use server'

import { Client } from 'pg'

export async function runSql(sql: string, connectionString: string) {
  // Convert SQL to lowercase for case-insensitive checks
  const sqlLower = sql.trim().toLowerCase()

  // 1. Security checks for dangerous operations
  if (
    sqlLower.includes('drop') ||
    sqlLower.includes('delete') ||
    sqlLower.includes('alter') ||
    sqlLower.includes('truncate') ||
    sqlLower.includes('grant') ||
    sqlLower.includes('revoke')
  ) {
    const action = sqlLower.includes('drop')
      ? 'DROP'
      : sqlLower.includes('delete')
        ? 'DELETE'
        : sqlLower.includes('alter')
          ? 'ALTER'
          : sqlLower.includes('truncate')
            ? 'TRUNCATE'
            : sqlLower.includes('grant')
              ? 'GRANT'
              : 'REVOKE'

    return `This action is not allowed ${action}`
  }

  // 2. Diocese safety check
  // List of tables that require diocese filtering
  const dioceseProtectedTables = [
    'testing_center',
    'testing_sections',
    'testing_section_students',
    'users',
    'students',
    'test_results',
    'scores'
  ]

  // Check if query involves any protected tables
  const hasProtectedTable = dioceseProtectedTables.some(table => 
    sqlLower.includes(table)
  )

  // Check for proper diocese filter
  const hasDioceseFilter = 
    sqlLower.includes('diocese_id = 43') || 
    sqlLower.includes('diocese_id=43') ||
    sqlLower.includes('tc.diocese_id = 43') ||
    sqlLower.includes('tc.diocese_id=43')



  // If query involves protected tables but doesn't have proper restrictions
  if (hasProtectedTable) {
    if (!hasDioceseFilter) {
      return 'Query must include diocese_id = 43 filter for security reasons'
    }
  }

  // 3. Execute the query
  const client = new Client({
    connectionString,
  })

  try {
    await client.connect()
    const result = await client.query(sql)
    await client.end()

    return JSON.stringify(result)
  } catch (error) {
    await client.end()
    if (error instanceof Error) {
      return error.message
    }
    return 'Unknown error'
  }
}