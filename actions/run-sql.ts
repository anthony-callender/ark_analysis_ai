'use server'

import { Client } from 'pg'
import { DIOCESE_CONFIG } from '../config/diocese'
import { UserRole } from '../database.types'
import { createClient } from '../utils/supabase/server'

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

interface UserInfo {
  id: string;
  role: UserRole;
  diocese_id: number | null;
  testing_center_id: number | null;
}

// Get current user info from Supabase Auth
async function getCurrentUser(): Promise<UserInfo | null> {
  const supabase = await createClient()
  
  // Get current user from Supabase Auth
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null
  }
  
  // Get user profile from our database
  const { data: profile } = await supabase
    .from('users')
    .select('id, role, diocese_id, testing_center_id')
    .eq('uuid', user.id)
    .single()
  
  if (!profile) {
    return null
  }
  
  // Map numeric role to string role
  let roleString: UserRole;
  
  switch (profile.role) {
    case 0:
      roleString = 'super_admin'; // "Ark Admin"
      break;
    case 2:
      roleString = 'diocese_manager'; // "Diocese Admin"
      break;
    case 3:
      roleString = 'school_manager'; // "Center Admin"
      break;
    default:
      roleString = 'school_manager';
  }
  
  return {
    ...profile,
    role: roleString
  } as UserInfo
}

export async function runSql(sql: string, connectionString: string) {
  // Get current user info
  const currentUser = await getCurrentUser()
  
  // Default to super_admin from config if no user is authenticated
  // In a production app, you'd likely want to block unauthenticated access completely
  const userRole = currentUser?.role || DIOCESE_CONFIG.role
  const userDioceseId = currentUser?.diocese_id || DIOCESE_CONFIG.id
  const userTestingCenterId = currentUser?.testing_center_id || DIOCESE_CONFIG.testingCenterId

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
  if (userRole === 'super_admin') {
    // Only check for dangerous operations, which are already checked above
  } else {
    // Check for proper diocese filter
    const hasDioceseFilter = 
      sqlLower.includes(`diocese_id = ${userDioceseId}`) || 
      sqlLower.includes(`diocese_id=${userDioceseId}`) ||
      sqlLower.includes(`tc.diocese_id = ${userDioceseId}`) ||
      sqlLower.includes(`tc.diocese_id=${userDioceseId}`) ||
      // Add support for filtering by diocese name
      sqlLower.includes(`name = '${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`name='${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`d.name = '${DIOCESE_CONFIG.fullName.toLowerCase()}'`) ||
      sqlLower.includes(`d.name='${DIOCESE_CONFIG.fullName.toLowerCase()}'`)

    // Check for proper testing center filter
    const hasTestingCenterFilter = 
      sqlLower.includes(`testing_center_id = ${userTestingCenterId}`) ||
      sqlLower.includes(`testing_center_id=${userTestingCenterId}`) ||
      sqlLower.includes(`tc.id = ${userTestingCenterId}`) ||
      sqlLower.includes(`tc.id=${userTestingCenterId}`)

    // If query involves protected tables but doesn't have proper restrictions
    if (hasProtectedTable) {
      // Diocese managers only need diocese filter
      if (userRole === 'diocese_manager') {
        if (!hasDioceseFilter) {
          return `Query must include diocese_id = ${userDioceseId} filter for security reasons`
        }
      } 
      // School managers need both filters
      else if (userRole === 'school_manager') {
        if (!hasDioceseFilter) {
          return `Query must include diocese_id = ${userDioceseId} filter for security reasons`
        }
        if (!hasTestingCenterFilter) {
          return `Query must include testing_center_id = ${userTestingCenterId} filter for security reasons`
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