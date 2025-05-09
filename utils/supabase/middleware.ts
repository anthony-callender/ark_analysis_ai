import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { getDbUserIdFromToken } from '@/utils/auth/db-session'
import { createAdminClient } from '@/utils/supabase/admin'

// Define cookie interfaces to fix the implicit any types
interface CookieOptions {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'strict' | 'lax' | 'none'
  secure?: boolean
}

interface Cookie {
  name: string
  value: string
  options?: CookieOptions
}

export const updateSession = async (request: NextRequest) => {
  // Check for our custom database-auth token and preserve it
  const dbAuthToken = request.cookies.get('db-auth-token')?.value;
  const hasDbAuth = !!dbAuthToken;
  
  // Create an unmodified response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })
  
  // Preserve our custom auth token in the new response if it exists
  if (hasDbAuth) {
    console.log('Preserving database auth token in middleware response');
    response.cookies.set('db-auth-token', dbAuthToken, {
      path: '/',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 1 week
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
  }

  // Using updated approach with correct types
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value
        },
        set(name, value, options) {
          // Set cookie in the request (for Edge Runtime support)
          request.cookies.set({
            name,
            value,
            ...options,
          })
          
          // Set cookie in the response
          response = NextResponse.next({
            request,
          })
          response.cookies.set(name, value, options)
          
          // Preserve our custom auth token in the new response if it exists
          if (hasDbAuth) {
            response.cookies.set('db-auth-token', dbAuthToken, {
              path: '/',
              httpOnly: true,
              maxAge: 60 * 60 * 24 * 7, // 1 week
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax'
            });
          }
        },
        remove(name, options) {
          // Don't remove our custom auth token
          if (name === 'db-auth-token') {
            console.log('Preventing removal of database auth token');
            return;
          }
          
          // Remove cookie from the request
          request.cookies.delete(name)
          
          // Remove cookie from the response
          response = NextResponse.next({
            request,
          })
          response.cookies.delete(name)
          
          // Preserve our custom auth token in the new response if it exists
          if (hasDbAuth) {
            response.cookies.set('db-auth-token', dbAuthToken, {
              path: '/',
              httpOnly: true,
              maxAge: 60 * 60 * 24 * 7, // 1 week
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax'
            });
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Get user role from metadata if user exists
  if (user) {
    // Fetch user details from our database to get the role
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('uuid', user.id)
      .single()
    
    if (userData?.role) {
      // Map numeric role to string role name
      let roleName = 'school_manager'; // Default
      
      switch (userData.role) {
        case 0:
          roleName = 'super_admin'; // "Ark Admin"
          break;
        case 2:
          roleName = 'diocese_manager'; // "Diocese Admin"
          break;
        case 3:
          roleName = 'school_manager'; // "Center Admin"
          break;
      }
      
      // Add role to request headers for middleware access check
      response.headers.set('x-user-role', roleName)
    }
  }

  // If we have db auth, ensure the role header is set
  if (hasDbAuth && !response.headers.has('x-user-role')) {
    console.log('Setting role for database authenticated user');
    
    try {
      // Extract user ID from token
      const dbToken = request.cookies.get('db-auth-token')?.value;
      const userId = getDbUserIdFromToken(dbToken);
      
      if (userId) {
        // Use admin client to bypass RLS
        const admin = createAdminClient();
        const { data } = await admin
          .from('users')
          .select('role')
          .eq('id', userId)
          .single();
        
        if (data?.role !== undefined) {
          // Map numeric role to string
          let roleName = 'school_manager'; // Default
          
          switch (data.role) {
            case 0:
              roleName = 'super_admin'; // "Ark Admin"
              break;
            case 2:
              roleName = 'diocese_manager'; // "Diocese Admin"
              break;
            case 3:
              roleName = 'school_manager'; // "Center Admin"
              break;
          }
          
          console.log(`Setting user role from database: ${roleName} (role ID: ${data.role})`);
          response.headers.set('x-user-role', roleName);
        } else {
          // Fallback - shouldn't happen if database is consistent
          console.log('No role found, using default school_manager');
          response.headers.set('x-user-role', 'school_manager');
        }
      } else {
        // Fallback if token is malformed
        console.log('Invalid token format, using default school_manager');
        response.headers.set('x-user-role', 'school_manager');
      }
    } catch (error) {
      console.error('Error getting role, using default:', error);
      response.headers.set('x-user-role', 'school_manager');
    }
  }

  // Define public routes that are always accessible
  const publicRoutes = ['/about', '/contact', '/features', '/pricing']
  
  // If user is accessing a public route, let them through regardless of auth status
  if (publicRoutes.includes(request.nextUrl.pathname)) {
    return response
  }

  // Comment out /app check as this is now handled by page/layout components
  // We don't want middleware redirecting when we already have auth checks in components
  // protected routes
  /*
  if (request.nextUrl.pathname.startsWith('/app') && !user && !hasDbAuth) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  */

  // Only redirect from root to /app if there's no 'public' query param
  // This gives a way to access the homepage even when logged in
  if (request.nextUrl.pathname === '/' && (user || hasDbAuth) && !request.nextUrl.searchParams.has('public')) {
    return NextResponse.redirect(new URL('/app', request.url))
  }

  return response
}
