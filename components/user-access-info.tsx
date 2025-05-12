'use client'

import { useSession } from 'next-auth/react'
import { ROLES } from '@/utils/auth-permissions'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Shield, Users, Building } from 'lucide-react'

export function UserAccessInfo() {
  const { data: session, status } = useSession()
  
  if (status === 'loading') {
    return <div className="animate-pulse p-4 bg-muted rounded-md">Loading access information...</div>
  }
  
  if (!session?.user) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Not authenticated</AlertTitle>
        <AlertDescription>
          You must be logged in to access this application.
        </AlertDescription>
      </Alert>
    )
  }
  
  // Determine access level and icon based on role
  let icon = <Shield className="h-5 w-5" />
  let color = "bg-blue-100 text-blue-800"
  let accessDescription = ""
  
  switch(session.user.role) {
    case ROLES.ARK_ADMIN:
      icon = <Shield className="h-5 w-5" />
      color = "bg-purple-100 text-purple-800"
      accessDescription = "Full access to all data across all dioceses and testing centers."
      break
    
    case ROLES.DIOCESE_ADMIN:
      icon = <Building className="h-5 w-5" />
      color = "bg-green-100 text-green-800"
      accessDescription = `Access limited to Diocese ID: ${session.user.diocese_id}.`
      break
    
    case ROLES.CENTER_ADMIN:
      icon = <Users className="h-5 w-5" />
      color = "bg-amber-100 text-amber-800"
      accessDescription = `Access limited to Testing Center ID: ${session.user.testing_center_id} in Diocese ID: ${session.user.diocese_id}.`
      break
      
    default:
      color = "bg-red-100 text-red-800"
      accessDescription = "Your role does not have sufficient permissions."
  }
  
  return (
    <div className={`p-4 rounded-md flex items-start gap-3 ${color}`}>
      <div className="flex-shrink-0 pt-0.5">
        {icon}
      </div>
      <div>
        <h3 className="font-medium text-sm">
          {session.user.role}
        </h3>
        <p className="text-sm opacity-90">
          {accessDescription}
        </p>
      </div>
    </div>
  )
} 