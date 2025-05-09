import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin
  const redirectTo = requestUrl.searchParams.get('redirect_to')?.toString()

  console.log('Auth callback received', { 
    code: code ? 'Present' : 'Missing',
    redirectTo 
  })

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (error) {
      console.error('Error exchanging code for session:', error)
      return NextResponse.redirect(`${origin}/login?errorMessage=${encodeURIComponent(error.message)}`)
    }
    
    // Verify session was created successfully
    const { data: { session } } = await supabase.auth.getSession()
    console.log('Session after code exchange:', {
      hasSession: !!session,
      userId: session?.user?.id
    })
    
    if (!session) {
      console.error('Failed to create session after code exchange')
      return NextResponse.redirect(`${origin}/login?errorMessage=Authentication failed. Please try again.`)
    }
  }

  if (redirectTo) {
    return NextResponse.redirect(`${origin}${redirectTo}`)
  }

  return NextResponse.redirect(`${origin}/app`)
}
