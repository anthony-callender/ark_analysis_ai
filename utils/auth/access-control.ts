import { UserRole } from '../../database.types'
import { createClient } from '../../utils/supabase/server'

/**
 * Defines what roles have access to certain resources
 */
export const RolePermissions = {
  // Resource types
  DIOCESE: {
    READ: ['super_admin', 'diocese_manager'],
    WRITE: ['super_admin', 'diocese_manager'],
    DELETE: ['super_admin'],
  },
  TESTING_CENTER: {
    READ: ['super_admin', 'diocese_manager', 'school_manager'],
    WRITE: ['super_admin', 'diocese_manager'],
    DELETE: ['super_admin', 'diocese_manager'],
  },
  USER: {
    READ: ['super_admin', 'diocese_manager', 'school_manager'],
    WRITE: {
      'super_admin': ['super_admin', 'diocese_manager', 'school_manager'],
      'diocese_manager': ['diocese_manager', 'school_manager'],
      'school_manager': ['school_manager'],
    },
    DELETE: ['super_admin'],
  },
  STUDENT: {
    READ: ['super_admin', 'diocese_manager', 'school_manager'],
    WRITE: ['super_admin', 'diocese_manager', 'school_manager'],
    DELETE: ['super_admin', 'diocese_manager', 'school_manager'],
  },
  TEST_RESULTS: {
    READ: ['super_admin', 'diocese_manager', 'school_manager'],
    WRITE: ['super_admin', 'diocese_manager', 'school_manager'],
    DELETE: ['super_admin'],
  },
}

/**
 * Access check types
 */
export enum AccessOperation {
  READ = 'READ',
  WRITE = 'WRITE',
  DELETE = 'DELETE',
}

export enum ResourceType {
  DIOCESE = 'DIOCESE',
  TESTING_CENTER = 'TESTING_CENTER',
  USER = 'USER',
  STUDENT = 'STUDENT',
  TEST_RESULTS = 'TEST_RESULTS',
}

/**
 * Gets the current authenticated user
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null
  }
  
  const { data: userData } = await supabase
    .from('users')
    .select('id, role, diocese_id, testing_center_id')
    .eq('uuid', user.id)
    .single()
  
  if (!userData) {
    return null
  }
  
  // Map numeric role to string role
  let roleString: UserRole;
  
  switch (userData.role) {
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
    ...userData,
    role: roleString
  }
}

/**
 * Check if a user has access to a particular resource
 */
export async function hasAccess(
  resourceType: ResourceType,
  operation: AccessOperation,
  targetResourceId?: number,
  targetResourceOwnerId?: string
) {
  const currentUser = await getCurrentUser()
  
  if (!currentUser) {
    return false
  }
  
  const { role, diocese_id, testing_center_id } = currentUser
  
  // Super admin has full access to everything
  if (role === 'super_admin') {
    return true
  }
  
  // Check if the role has general permission for this operation
  const permissions = RolePermissions[resourceType]
  const allowedRoles = permissions[operation]
  
  // If allowedRoles is an array, check if the user's role is in it
  if (Array.isArray(allowedRoles)) {
    const hasPermission = allowedRoles.includes(role)
    
    if (!hasPermission) {
      return false
    }
  } 
  // If it's an object, it's a more complex permission structure
  else if (typeof allowedRoles === 'object') {
    // For user management, different roles can manage different types of users
    const canManageRoles = allowedRoles[role as keyof typeof allowedRoles] || []
    
    // If we're checking permission to a specific user role (passed as targetResourceId), 
    // check if their role is manageable
    if (targetResourceOwnerId && !canManageRoles.includes(targetResourceOwnerId)) {
      return false
    }
  }
  
  // Diocese manager can only access their diocese resources
  if (role === 'diocese_manager') {
    if (resourceType === ResourceType.DIOCESE) {
      // Can only access their own diocese
      return targetResourceId !== undefined && diocese_id !== null && targetResourceId === diocese_id
    }
    
    if (resourceType === ResourceType.TESTING_CENTER && targetResourceId !== undefined) {
      // Need to check if the testing center belongs to their diocese
      const supabase = await createClient()
      const { data } = await supabase
        .from('testing_centers')
        .select('diocese_id')
        .eq('id', targetResourceId)
        .single()
      
      return data?.diocese_id === diocese_id
    }
  }
  
  // School manager can only access their own school's resources
  if (role === 'school_manager') {
    if (resourceType === ResourceType.TESTING_CENTER) {
      // Can only access their own testing center
      return targetResourceId !== undefined && testing_center_id !== null && targetResourceId === testing_center_id
    }
    
    if (resourceType === ResourceType.STUDENT || resourceType === ResourceType.TEST_RESULTS) {
      // Would need to check if the student/test belongs to their testing center
      // This would be implemented in a real application
      return true
    }
  }
  
  // If we've gotten here, default to denying access
  return false
} 