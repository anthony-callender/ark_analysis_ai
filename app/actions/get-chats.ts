'use server'

import { createAdminClient } from '@/utils/supabase/admin'
import { cookies } from 'next/headers'
import { getDbUserIdFromToken } from '@/utils/auth/db-session'

export async function getChats() {
  console.log('Starting getChats function');
  
  try {
    const admin = createAdminClient();
    
    // Try to get from db-auth-token
    const cookieStore = await cookies();
    const dbToken = cookieStore.get('db-auth-token')?.value;
    
    let uuid = null;
    
    if (dbToken) {
      const dbUserId = getDbUserIdFromToken(dbToken);
      if (dbUserId) {
        // If we have a valid db token, get the uuid from the users table
        const { data } = await admin
          .from('users')
          .select('uuid')
          .eq('id', dbUserId)
          .single();
          
        if (data?.uuid) {
          uuid = data.uuid;
        }
      }
    }
    
    // If no valid user, return empty list
    if (!uuid) {
      console.log('No valid user found for getChats');
      return { chats: [] };
    }
    
    // Get chats for this user
    const { data, error } = await admin
      .from('chats')
      .select('*')
      .eq('user_id', uuid)
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error getting chats:', error);
      return { chats: [] };
    }
    
    return { chats: data };
  } catch (error) {
    console.error('Authentication error:', error);
    return { chats: [] };
  }
} 