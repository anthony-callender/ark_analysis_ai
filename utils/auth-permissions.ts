/**
 * Auth permissions utility for role-based LLM query construction
 */
'use client'

import { getSession } from 'next-auth/react'

// Role definitions
export const ROLES = {
  ARK_ADMIN: "Ark Admin",    // Role 0
  DIOCESE_ADMIN: "Diocese Admin", // Role 2
  CENTER_ADMIN: "Center Admin"    // Role 3
}

// Interface for the session user with our custom fields
interface SessionUser {
  id: string
  role: string
  diocese_id?: number | null
  testing_center_id?: number | null
}

/**
 * Get SQL query constraints based on user role
 * @returns Object with role-specific query constraints
 */
export async function getLLMQueryConstraints() {
  const session = await getSession()
  
  if (!session?.user) {
    console.warn('No user session found for query constraints')
    // Return default constraints that won't modify queries
    return { 
      hasConstraints: false,
      roleDescription: "No authenticated user found."
    }
  }
  
  const user = session.user as SessionUser
  console.log('User role for constraints:', user.role)
  console.log('User diocese_id:', user.diocese_id)
  
  // Different constraints based on role
  switch (user.role) {
    case ROLES.ARK_ADMIN:
      // Ark Admin has no constraints - can query all data
      return { 
        hasConstraints: false,
        roleDescription: "You have full access to all data as an Ark Admin."
      }
      
    case ROLES.DIOCESE_ADMIN:
      console.log(`Setting diocese constraints for ID: ${user.diocese_id}`)
      // Diocese Admin - constrain queries to their diocese
      return {
        hasConstraints: true,
        diocese_id: user.diocese_id,
        mustIncludeDioceseFilter: true,
        mustIncludeTestingCenterFilter: false,
        roleDescription: `You can only access data for your diocese (diocese_id=${user.diocese_id}).`
      }
      
    case ROLES.CENTER_ADMIN:
      console.log(`Setting center constraints for diocese_id: ${user.diocese_id}, center_id: ${user.testing_center_id}`)
      // Center Admin - constrain queries to their testing center
      return {
        hasConstraints: true,
        diocese_id: user.diocese_id,
        testing_center_id: user.testing_center_id,
        mustIncludeDioceseFilter: true,
        mustIncludeTestingCenterFilter: true,
        roleDescription: `You can only access data for your testing center (testing_center_id=${user.testing_center_id}) in your diocese (diocese_id=${user.diocese_id}).`
      }
      
    default:
      console.warn(`Unknown role type: ${user.role}`)
      // Default case - shouldn't happen due to middleware, but just in case
      return { 
        hasConstraints: false,
        roleDescription: `Unknown role: ${user.role}`
      }
  }
}

/**
 * Add constraints to an LLM-generated SQL query
 * @param sqlQuery The original SQL query from the LLM
 * @returns Modified SQL query with appropriate constraints
 */
export async function addConstraintsToQuery(sqlQuery: string): Promise<string> {
  const constraints = await getLLMQueryConstraints()
  
  // If no constraints needed (Ark Admin), return original query
  if (!constraints.hasConstraints) {
    return sqlQuery
  }
  
  const sqlLower = sqlQuery.toLowerCase()
  let modifiedQuery = sqlQuery
  
  // Check for protected tables
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
  
  // Only modify queries that touch protected tables
  if (hasProtectedTable) {
    // Check if the query already has the required filters
    const hasDioceseFilter = constraints.diocese_id && (
      sqlLower.includes(`diocese_id = ${constraints.diocese_id}`) || 
      sqlLower.includes(`diocese_id=${constraints.diocese_id}`) ||
      sqlLower.includes(`tc.diocese_id = ${constraints.diocese_id}`) ||
      sqlLower.includes(`tc.diocese_id=${constraints.diocese_id}`)
    )
    
    const hasTestingCenterFilter = constraints.testing_center_id && (
      sqlLower.includes(`testing_center_id = ${constraints.testing_center_id}`) ||
      sqlLower.includes(`testing_center_id=${constraints.testing_center_id}`) ||
      sqlLower.includes(`tc.id = ${constraints.testing_center_id}`) ||
      sqlLower.includes(`tc.id=${constraints.testing_center_id}`)
    )
    
    // Add constraints if they're missing
    if (constraints.mustIncludeDioceseFilter && !hasDioceseFilter) {
      // Add diocese filter - this is simplified and would need to be more sophisticated
      // for real SQL queries with different structures
      if (sqlLower.includes('where')) {
        // Add to existing WHERE clause
        modifiedQuery = modifiedQuery.replace(
          /where/i,
          `WHERE diocese_id = ${constraints.diocese_id} AND `
        )
      } else if (sqlLower.includes('from')) {
        // Add new WHERE clause after FROM and any JOIN clauses
        const fromIndex = modifiedQuery.toLowerCase().lastIndexOf('from')
        const wherePosition = Math.max(
          modifiedQuery.toLowerCase().lastIndexOf('join', fromIndex + 50),
          fromIndex
        )
        
        // Find the right position after any table definitions/joins
        let insertPosition = modifiedQuery.indexOf(' ', wherePosition + 5)
        if (insertPosition === -1) insertPosition = modifiedQuery.length
        
        // Look for GROUP BY, ORDER BY, LIMIT clauses to insert before
        const endClauses = ['group by', 'order by', 'limit']
        for (const clause of endClauses) {
          const clausePos = modifiedQuery.toLowerCase().indexOf(clause)
          if (clausePos !== -1 && clausePos < insertPosition) {
            insertPosition = clausePos
          }
        }
        
        // Insert the WHERE clause
        modifiedQuery = 
          modifiedQuery.slice(0, insertPosition) + 
          ` WHERE diocese_id = ${constraints.diocese_id} ` + 
          modifiedQuery.slice(insertPosition)
      }
    }
    
    // Add testing center filter if required and missing
    if (constraints.mustIncludeTestingCenterFilter && !hasTestingCenterFilter) {
      if (modifiedQuery.toLowerCase().includes('where')) {
        // Check if we already added a diocese filter
        if (modifiedQuery.toLowerCase().includes(`diocese_id = ${constraints.diocese_id}`)) {
          // Add testing center filter to existing clause
          const whereClause = modifiedQuery.toLowerCase().indexOf('where')
          const afterWhere = modifiedQuery.indexOf(' ', whereClause + 6)
          
          modifiedQuery = 
            modifiedQuery.slice(0, afterWhere) + 
            ` testing_center_id = ${constraints.testing_center_id} AND` + 
            modifiedQuery.slice(afterWhere)
        } else {
          // Add to existing WHERE clause
          modifiedQuery = modifiedQuery.replace(
            /where/i,
            `WHERE testing_center_id = ${constraints.testing_center_id} AND `
          )
        }
      } else if (modifiedQuery.toLowerCase().includes('from')) {
        // Add new WHERE clause
        const fromIndex = modifiedQuery.toLowerCase().lastIndexOf('from')
        const wherePosition = Math.max(
          modifiedQuery.toLowerCase().lastIndexOf('join', fromIndex + 50),
          fromIndex
        )
        
        let insertPosition = modifiedQuery.indexOf(' ', wherePosition + 5)
        if (insertPosition === -1) insertPosition = modifiedQuery.length
        
        // Look for GROUP BY, ORDER BY, LIMIT clauses
        const endClauses = ['group by', 'order by', 'limit']
        for (const clause of endClauses) {
          const clausePos = modifiedQuery.toLowerCase().indexOf(clause)
          if (clausePos !== -1 && clausePos < insertPosition) {
            insertPosition = clausePos
          }
        }
        
        modifiedQuery = 
          modifiedQuery.slice(0, insertPosition) + 
          ` WHERE testing_center_id = ${constraints.testing_center_id} ` + 
          modifiedQuery.slice(insertPosition)
      }
    }
  }
  
  return modifiedQuery
}

/**
 * Get a message describing the user's data access restrictions
 * for display to the user or inclusion in LLM system prompts
 */
export async function getAccessRestrictionMessage(): Promise<string> {
  try {
    const constraints = await getLLMQueryConstraints()
    return constraints.roleDescription
  } catch (error) {
    return "You must be logged in to access data."
  }
} 