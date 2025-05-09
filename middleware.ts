import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
  // Special handling for logout
  if (request.nextUrl.pathname === '/logout') {
    // Create response that will redirect to home page
    const response = NextResponse.redirect(new URL('/', request.url))
    
    // Clear the auth cookie by setting it to expire in the past
    response.cookies.set('sb-auth-token', '', { 
      expires: new Date(0),
      path: '/' 
    })
    
    // Also clear any other Supabase cookies
    response.cookies.set('sb-refresh-token', '', { 
      expires: new Date(0), 
      path: '/' 
    })
    
    // Also clear our custom database auth cookie if it exists
    response.cookies.set('db-auth-token', '', {
      expires: new Date(0),
      path: '/'
    })
    
    return response
  }
  
  // TEMPORARY: Just return the response with auth headers
  // This disables ALL middleware redirects to break the loop
  
  // Check for our custom database-auth token
  const dbAuthToken = request.cookies.get('db-auth-token')?.value
  const isDbAuthenticated = !!dbAuthToken
  
  // Update the session with Supabase cookie handling
  // This also preserves our db-auth-token
  const response = await updateSession(request)
  
  // Just return the response with auth headers set
  // No redirects while we debug the issue
  return response
  
  /* DISABLED CODE
  // Check if the request is for protected routes
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin')
  const isDioceseManagerRoute = request.nextUrl.pathname.startsWith('/diocese-manager') 
  const isSchoolManagerRoute = request.nextUrl.pathname.startsWith('/school-manager')
  const isAppRoute = request.nextUrl.pathname.startsWith('/app')
  
  // Get the user role from the response headers (set by updateSession)
  const role = response.headers.get('x-user-role')
  
  // If database authentication token exists, allow access to app route
  // This ensures db-auth-token is given priority for /app routes
  if (isDbAuthenticated && isAppRoute) {
    console.log('Database authentication token found in middleware - skipping further checks');
    return response;
  }
  
  // If user is accessing a protected route and is not authenticated by either method
  if ((isAppRoute || isAdminRoute || isDioceseManagerRoute || isSchoolManagerRoute) && 
      !isDbAuthenticated && !role) {
    console.log('No authentication found - redirecting to login');
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  // If not accessing protected routes, return the response
  if (!isAdminRoute && !isDioceseManagerRoute && !isSchoolManagerRoute) {
    return response
  }
  
  // Enforce role-based access
  if (isAdminRoute && role !== 'super_admin') {
    return NextResponse.redirect(new URL('/access-denied', request.url))
  }
  
  if (isDioceseManagerRoute && role !== 'super_admin' && role !== 'diocese_manager') {
    return NextResponse.redirect(new URL('/access-denied', request.url))
  }
  
  if (isSchoolManagerRoute && !role) {
    return NextResponse.redirect(new URL('/access-denied', request.url))
  }
  
  return response
  */
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
