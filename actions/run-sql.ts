'use server'

import { Client } from 'pg'
import { DIOCESE_CONFIG } from '@/config/diocese'

// Cache to store recent query results and prevent redundant executions
// Format: { queryKey: { result: string, timestamp: number } }
const queryCache: Record<string, { result: string, timestamp: number }> = {}

// Cache TTL in milliseconds (1 second)
const CACHE_TTL = 1000

// Generate a cache key for a query
function generateCacheKey(sql: string, connectionString: string): string {
  // Use only the first 50 chars of connection string to avoid leaking sensitive info in memory
  const connStringSafe = connectionString.substring(0, 50)
  return `${sql.trim()}_${connStringSafe}`
}

export async function runSql(sql: string, connectionString: string) {
  // Convert SQL to lowercase for case-insensitive checks
  const sqlLower = sql.trim().toLowerCase()
  
  // Generate cache key for this query
  const cacheKey = generateCacheKey(sql, connectionString)
  
  // Check cache for recent identical query
  const cachedResult = queryCache[cacheKey]
  const now = Date.now()
  
  if (cachedResult && now - cachedResult.timestamp < CACHE_TTL) {
    console.log('Using cached SQL result')
    return cachedResult.result
  }

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

  // Super admin bypasses all restrictions except dangerous operations
  if (DIOCESE_CONFIG.role === 'super_admin') {
    // Only check for dangerous operations
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
  } else {
    // Check for proper diocese filter
    const hasDioceseFilter = 
      sqlLower.includes(`diocese_id = ${DIOCESE_CONFIG.id}`) || 
      sqlLower.includes(`diocese_id=${DIOCESE_CONFIG.id}`) ||
      sqlLower.includes(`tc.diocese_id = ${DIOCESE_CONFIG.id}`) ||
      sqlLower.includes(`tc.diocese_id=${DIOCESE_CONFIG.id}`) ||
      // Add support for filtering by diocese name
      sqlLower.includes(`name = '${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`name='${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`d.name = '${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`d.name='${DIOCESE_CONFIG.fullName.toLowerCase()}'`)

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
          return `Query must include either diocese_id = ${DIOCESE_CONFIG.id} OR name = '${DIOCESE_CONFIG.fullName}' filter for security reasons`
        }
      } 
      // School managers need both filters
      else {
        if (!hasDioceseFilter) {
          return `Query must include either diocese_id = ${DIOCESE_CONFIG.id} OR name = '${DIOCESE_CONFIG.fullName}' filter for security reasons`
        }
        if (!hasTestingCenterFilter) {
          return `Query must include testing_center_id = ${DIOCESE_CONFIG.testingCenterId} filter for security reasons`
        }
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
    
    const resultString = JSON.stringify(result)
    
    // Cache the result
    queryCache[cacheKey] = {
      result: resultString,
      timestamp: Date.now()
    }
    
    // Clean up old cache entries every 100 queries
    if (Object.keys(queryCache).length > 100) {
      const keysToRemove = Object.entries(queryCache)
        .filter(([_, value]) => now - value.timestamp > CACHE_TTL)
        .map(([key]) => key)
      
      keysToRemove.forEach(key => delete queryCache[key])
    }
    
    return resultString
  } catch (error) {
    await client.end()
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Cache errors too to prevent hammering the database with invalid queries
    queryCache[cacheKey] = {
      result: errorMessage,
      timestamp: Date.now()
    }
    
    return errorMessage
  }
}