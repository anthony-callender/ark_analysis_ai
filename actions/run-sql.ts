'use server'

import { Client } from 'pg'
import { DIOCESE_CONFIG } from '@/config/diocese'

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

  // 2. Diocese and Testing Center safety check
  // Check if query involves any protected tables
  const hasProtectedTable = DIOCESE_CONFIG.protectedTables.some(table => 
    sqlLower.includes(table)
  )

  // Check for proper diocese filter
  const hasDioceseFilter = 
    sqlLower.includes(`diocese_id = ${DIOCESE_CONFIG.id}`) || 
    sqlLower.includes(`diocese_id=${DIOCESE_CONFIG.id}`) ||
    sqlLower.includes(`tc.diocese_id = ${DIOCESE_CONFIG.id}`) ||
    sqlLower.includes(`tc.diocese_id=${DIOCESE_CONFIG.id}`)

  // Check for proper testing center filter
  const hasTestingCenterFilter = 
    sqlLower.includes(`testing_center_id = ${DIOCESE_CONFIG.testingCenterId}`) ||
    sqlLower.includes(`testing_center_id=${DIOCESE_CONFIG.testingCenterId}`) ||
    sqlLower.includes(`tc.id = ${DIOCESE_CONFIG.testingCenterId}`) ||
    sqlLower.includes(`tc.id=${DIOCESE_CONFIG.testingCenterId}`)

  // If query involves protected tables but doesn't have proper restrictions
  if (hasProtectedTable) {
    // Diocese managers only need diocese filter
    if (DIOCESE_CONFIG.role === 'diocese_manager') {
      if (!hasDioceseFilter) {
        return `Query must include diocese_id = ${DIOCESE_CONFIG.id} filter for security reasons`
      }
    } 
    // School managers need both filters
    else {
      if (!hasDioceseFilter) {
        return `Query must include diocese_id = ${DIOCESE_CONFIG.id} filter for security reasons`
      }
      if (!hasTestingCenterFilter) {
        return `Query must include testing_center_id = ${DIOCESE_CONFIG.testingCenterId} filter for security reasons`
      }
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