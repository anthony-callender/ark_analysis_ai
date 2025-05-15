'use server'

import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

/**
 * Gets the current user session from the server context
 * This is the server-side equivalent of getSession() in client components
 */
export async function getServerUser() {
  try {
    const session = await getServerSession(authOptions)
    return session?.user || null
  } catch (error) {
    console.error('Error getting server session:', error)
    return null
  }
} 