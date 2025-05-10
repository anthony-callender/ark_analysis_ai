import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// This function will run before each request to protected routes
export default withAuth({
  callbacks: {
    // Custom authorization logic if needed (e.g., role-based)
    authorized({ token }) {
      // Return true if the user should have access
      return !!token
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
