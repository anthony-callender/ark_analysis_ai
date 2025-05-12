import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// Roles that are allowed to access the app
const ALLOWED_ROLES = [
  "Ark Admin",      // Role 0
  "Diocese Admin",  // Role 2
  "Center Admin"    // Role 3
]

// This function will run before each request to protected routes
export default withAuth({
  callbacks: {
    // Custom authorization logic for role-based access
    authorized({ token }) {
      // If no token exists, access is denied
      if (!token) return false
      
      // Check if the user's role is in the allowed roles list
      return ALLOWED_ROLES.includes(token.role as string)
    },
  },
})

// Specify which routes should be protected
export const config = {
  matcher: [
    // Protected routes
    '/app/:path*',
    // Add other protected routes as needed
  ],
}
