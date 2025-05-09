import { createClient } from '@/utils/supabase/server'
import { mapRailsRoleToOurRole, railsRoleShouldHaveAccess } from './role-mapping'

/**
 * Interface for rails user data
 */
interface RailsUser {
  id: number;
  email: string;
  username?: string;
  role: string;
  first_name?: string;
  last_name?: string;
  diocese_id?: number;
  testing_center_id?: number;
}

/**
 * Check if a user exists in the Rails application by email
 * @param email The email to check
 * @returns The Rails user if found, null otherwise
 */
export async function checkRailsUserByEmail(email: string): Promise<RailsUser | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('users')
    .select('id, email, username, role, diocese_id, testing_center_id')
    .eq('email', email)
    .maybeSingle()
  
  if (error || !data) {
    return null
  }
  
  return data as unknown as RailsUser
}

/**
 * Check if a user exists in the Rails application by username
 * @param username The username to check
 * @returns The Rails user if found, null otherwise
 */
export async function checkRailsUserByUsername(username: string): Promise<RailsUser | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('users')
    .select('id, email, username, role, diocese_id, testing_center_id')
    .eq('username', username)
    .maybeSingle()
  
  if (error || !data) {
    return null
  }
  
  return data as unknown as RailsUser
}

/**
 * Checks if the user should have access to our application based on their Rails role
 * and returns the equivalent role in our system
 * @param railsUser The Rails user object
 * @returns Object with shouldHaveAccess boolean and mappedRole string, or null if the role is invalid
 */
export function checkRailsUserAccess(railsUser: RailsUser): { shouldHaveAccess: boolean; mappedRole: string } | null {
  if (!railsUser || !railsUser.role) {
    return null
  }
  
  try {
    const shouldHaveAccess = railsRoleShouldHaveAccess(railsUser.role as any)
    const mappedRole = mapRailsRoleToOurRole(railsUser.role as any)
    
    return { shouldHaveAccess, mappedRole }
  } catch (error) {
    console.error('Error mapping Rails role:', error)
    return null
  }
} 