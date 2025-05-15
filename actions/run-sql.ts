'use server'

import { Client } from 'pg'
import { DIOCESE_CONFIG } from '@/config/diocese'
import { getServerUser } from '@/utils/server-auth'
import { SERVER_ROLES } from '@/utils/roles'

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

// Cache for diocese name lookups
const dioceseNameCache: Record<number, string> = {}

// Helper function to get diocese name from ID
async function getDioceseName(dioceseId: number, connectionString: string): Promise<string | null> {
  // Check cache first
  if (dioceseNameCache[dioceseId]) {
    return dioceseNameCache[dioceseId]
  }
  
  // If not in cache, query the database
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query(
      'SELECT name FROM dioceses WHERE id = $1 LIMIT 1',
      [dioceseId]
    )
    await client.end()
    
    if (result.rows.length > 0) {
      const dioceseName = result.rows[0].name
      // Store in cache
      dioceseNameCache[dioceseId] = dioceseName
      return dioceseName
    }
    return null
  } catch (error) {
    console.error(`Error getting diocese name for ID ${dioceseId}:`, error)
    await client.end()
    return null
  }
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

  // 2. Get user session for role-based restrictions
  const session = await getServerUser()
  
  // 3. Check if query involves any protected tables
  const protectedTables = [
    'testing_centers',
    'testing_sections',
    'testing_section_students',
    'users',
    'students',
    'test_results',
    'scores'
  ]
  
  const hasProtectedTable = protectedTables.some(table => 
    sqlLower.includes(table)
  )

  // 4. Apply role-based restrictions
  if (session) {
    // Extract user information from the authenticated session
    // This comes from the JWT token created during login
    const userRole = session.role
    const diocese_id = session.diocese_id
    const testing_center_id = session.testing_center_id
    
    console.log(`Auth check: Role=${userRole}, Diocese=${diocese_id}, Center=${testing_center_id}`)
    
    // ROLE-BASED ACCESS CONTROL:
    // - Ark Admin: No restrictions (can query all data)
    // - Diocese Admin: Must include diocese_id filter matching their diocese
    // - Center Admin: Must include both diocese_id and testing_center_id filters
    
    // Ark Admin (super admin) bypasses all restrictions except dangerous operations
    if (userRole === SERVER_ROLES.ARK_ADMIN) {
      console.log('User is Ark Admin - no restrictions applied')
      // Dangerous operations already checked above
    } 
    // Other roles have restrictions
    else if (hasProtectedTable) {
      // Get diocese name for this user's diocese_id
      const dioceseName = diocese_id ? await getDioceseName(diocese_id, connectionString) : null
      
      // Check for proper diocese filter (by ID or name)
      const hasDioceseFilter = diocese_id && (
        // ID-based filters
        sqlLower.includes(`diocese_id = ${diocese_id}`) || 
        sqlLower.includes(`diocese_id=${diocese_id}`) ||
        sqlLower.includes(`tc.diocese_id = ${diocese_id}`) ||
        sqlLower.includes(`tc.diocese_id=${diocese_id}`) ||
        // Name-based filters (if we have a name mapping)
        (dioceseName && (
          sqlLower.includes(`name = '${dioceseName.toLowerCase()}'`) ||
          sqlLower.includes(`name='${dioceseName.toLowerCase()}'`) ||
          sqlLower.includes(`d.name = '${dioceseName.toLowerCase()}'`) ||
          sqlLower.includes(`d.name='${dioceseName.toLowerCase()}'`) ||
          sqlLower.includes(`diocese.name = '${dioceseName.toLowerCase()}'`) ||
          sqlLower.includes(`diocese.name='${dioceseName.toLowerCase()}'`)
        ))
      )
      
      // Check for proper testing center filter
      const hasTestingCenterFilter = testing_center_id && (
        sqlLower.includes(`testing_center_id = ${testing_center_id}`) ||
        sqlLower.includes(`testing_center_id=${testing_center_id}`) ||
        sqlLower.includes(`tc.id = ${testing_center_id}`) ||
        sqlLower.includes(`tc.id=${testing_center_id}`)
      )
      
      // Diocese Admin only needs diocese filter
      if (userRole === SERVER_ROLES.DIOCESE_ADMIN) {
        if (!hasDioceseFilter) {
          return `Query must include diocese_id = ${diocese_id}${dioceseName ? " or name = '" + dioceseName + "'" : ""} filter for security reasons`
        }
      }
      // Center Admin needs both filters 
      else if (userRole === SERVER_ROLES.CENTER_ADMIN) {
        if (!hasDioceseFilter) {
          return `Query must include diocese_id = ${diocese_id}${dioceseName ? " or name = '" + dioceseName + "'" : ""} filter for security reasons`
        }
        if (!hasTestingCenterFilter) {
          return `Query must include testing_center_id = ${testing_center_id} filter for security reasons`
        }
      }
    }
  } else {
    console.warn('No authenticated user found when running SQL query')
    // Fall back to original DIOCESE_CONFIG for backward compatibility
    if (hasProtectedTable) {
      // Super admin bypasses all restrictions except dangerous operations
      if (DIOCESE_CONFIG.role === 'super_admin') {
        // Dangerous operations already checked above
      } else {
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
    }
  }

  // 5. Execute the query
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