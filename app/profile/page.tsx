'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    // This shouldn't be necessary with middleware, but just as a fallback
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-lg">Loading user profile...</p>
      </div>
    )
  }

  if (!session) {
    return null // Should never reach here because of middleware
  }

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">User Profile</h1>
        <p className="text-muted-foreground">
          This is a protected page only visible to authenticated users
        </p>
      </div>

      <div className="rounded-lg border p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium">Name</h3>
            <p>{session.user.name || 'Not provided'}</p>
          </div>
          
          <div>
            <h3 className="text-lg font-medium">Email</h3>
            <p>{session.user.email}</p>
          </div>
          
          <div>
            <h3 className="text-lg font-medium">Username</h3>
            <p>{session.user.username}</p>
          </div>
          
          <div>
            <h3 className="text-lg font-medium">Role</h3>
            <p>{session.user.role}</p>
          </div>
        </div>
        
        <div className="mt-6">
          <Link href="/app">
            <Button>Go to App</Button>
          </Link>
        </div>
      </div>
    </div>
  )
} 