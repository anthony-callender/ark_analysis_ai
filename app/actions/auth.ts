'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import { checkRailsUserByEmail, checkRailsUserAccess } from '@/utils/auth/rails-integration';
import { checkDevisePassword } from '@/utils/auth/devise-password';

const loginFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function handleLoginFormAction(formData: FormData) {
  const formSafeParsed = loginFormSchema.safeParse({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });

  if (!formSafeParsed.success) {
    return redirect('/login?errorMessage=Invalid email or password');
  }

  const supabase = await createClient();
  
  // Try to find user in the database first
  const { data: dbUsers, error: dbError } = await supabase
    .from('users')
    .select('id, uuid, username, email, role, diocese_id, testing_center_id, sign_in_count, current_sign_in_at')
    .eq('email', formSafeParsed.data.email)
    .limit(1);
  
  // Check for database query errors
  if (dbError) {
    console.error('Database error:', dbError.message);
    return redirect('/login?errorMessage=' + encodeURIComponent(dbError.message));
  }
  
  // If we found a user, use database authentication
  if (dbUsers && dbUsers.length > 0) {
    const dbUser = dbUsers[0] as any; // Use type assertion to bypass TypeScript checking
    
    // Fetch the user's encrypted password
    const { data: passwordData, error: passwordError } = await supabase
      .from('users')
      .select('encrypted_password')
      .eq('email', formSafeParsed.data.email)
      .single();
    
    if (passwordError) {
      console.error('Password fetch error:', passwordError.message);
      return redirect('/login?errorMessage=' + encodeURIComponent(passwordError.message));
    }
    
    // Check if password matches using bcrypt comparison
    try {
      console.log('Attempting password verification with bcrypt');
      console.log('Password hash format:', passwordData.encrypted_password.substring(0, 10) + '...');
      
      const passwordMatches = await checkDevisePassword(
        formSafeParsed.data.password, 
        passwordData.encrypted_password
      );
      
      console.log('Password verification result:', passwordMatches);
      
      if (!passwordMatches) {
        return redirect('/login?errorMessage=Invalid email or password');
      }
    } catch (error) {
      console.error('Password verification error:', error);
      return redirect('/login?errorMessage=Authentication error');
    }
    
    // Update sign_in_count and timestamps
    const { error: updateError } = await supabase
      .from('users')
      .update({
        sign_in_count: dbUser.sign_in_count ? dbUser.sign_in_count + 1 : 1,
        current_sign_in_at: new Date().toISOString(),
        last_sign_in_at: dbUser.current_sign_in_at || new Date().toISOString()
      })
      .eq('id', dbUser.id);
    
    if (updateError) {
      console.error('Error updating sign-in stats:', updateError.message);
    }
    
    // Set a custom auth cookie for database-authenticated users
    // This allows our middleware to recognize authenticated users even if Supabase Auth fails
    const cookieStore = await cookies();
    const token = `db-${dbUser.id}-${Date.now()}`;
    
    cookieStore.set('db-auth-token', token, {
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    // Try to create a Supabase auth session, but don't block login if it fails
    try {
      // Attempt to sign in with Supabase Auth
      const { error: sessionError } = await supabase.auth.signInWithPassword({
        email: formSafeParsed.data.email,
        password: formSafeParsed.data.password,
      });

      if (sessionError) {
        console.log('Supabase Auth session creation failed, but continuing with database auth');
      }
    } catch (error) {
      console.log('Error with Supabase Auth, but continuing with database auth');
    }
    
    // Redirect to app - we've successfully validated against the database
    return redirect('/app');
  }
  
  // If user wasn't found in database, let the user know
  return redirect('/login?errorMessage=User not found or invalid credentials');
}

export async function logoutAction() {
  'use server';
  
  const supabase = await createClient();
  const cookieStore = await cookies();
  
  // Clear our custom DB auth cookie
  cookieStore.set('db-auth-token', '', {
    path: '/',
    expires: new Date(0),
    maxAge: 0
  });
  
  // Also sign out from Supabase Auth
  await supabase.auth.signOut();
  
  return redirect('/');
} 