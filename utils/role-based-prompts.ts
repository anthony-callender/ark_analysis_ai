'use server'

import { getSession } from 'next-auth/react'
import { ROLES } from './auth-permissions'

// This is a server action that gets role-specific prompt instructions
export async function getRoleBasedPromptInstructions(): Promise<string> {
  try {
    const session = await getSession()
    
    if (!session?.user) {
      return "You must be logged in to use this feature."
    }
    
    // Instructions based on user role
    switch (session.user.role) {
      case ROLES.ARK_ADMIN:
        return `
          You have full access to all data in the system as an Ark Admin.
          You can query any data across all dioceses and testing centers.
        `
      
      case ROLES.DIOCESE_ADMIN:
        return `
          IMPORTANT: You are a Diocese Admin with access restricted to Diocese ID: ${session.user.diocese_id}.
          
          Any SQL queries you generate MUST include a WHERE clause restricting data to diocese_id = ${session.user.diocese_id}.
          
          If the user asks for data without specifying a diocese, always limit to their diocese.
          
          Example proper query:
          SELECT * FROM testing_centers WHERE diocese_id = ${session.user.diocese_id};
          
          Example improper query (DO NOT DO THIS):
          SELECT * FROM testing_centers;
        `
      
      case ROLES.CENTER_ADMIN:
        return `
          IMPORTANT: You are a Center Admin with access restricted to Testing Center ID: ${session.user.testing_center_id} in Diocese ID: ${session.user.diocese_id}.
          
          Any SQL queries you generate MUST include WHERE clauses restricting data to:
          1. diocese_id = ${session.user.diocese_id} AND
          2. testing_center_id = ${session.user.testing_center_id}
          
          If the user asks for data without specifying a testing center, always limit to their testing center.
          
          Example proper query:
          SELECT * FROM students WHERE testing_center_id = ${session.user.testing_center_id} AND diocese_id = ${session.user.diocese_id};
          
          Example improper query (DO NOT DO THIS):
          SELECT * FROM students;
        `
        
      default:
        return "Your role does not have sufficient permissions to access this data."
    }
  } catch (error) {
    console.error("Error getting role-based prompt:", error)
    return "Unable to determine your access level. Please try again later."
  }
}

// Modify an LLM system prompt to include role-based restrictions
export async function addRoleRestrictionsToPrompt(basePrompt: string): Promise<string> {
  const roleInstructions = await getRoleBasedPromptInstructions()
  
  return `
${basePrompt}

===== ROLE-BASED ACCESS RESTRICTIONS =====
${roleInstructions}
===========================================

Always follow these access restrictions when generating SQL queries or analyzing data.
`
} 