'use server'

import { createAdminClient } from '@/utils/supabase/admin'
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'
import { getDbUserIdFromToken } from '@/utils/auth/db-session'

export async function saveChat(chatData: {
  id?: string;
  name: string;
  messages: any[];
  userId?: string;
}) {
  console.log('Saving chat data:', chatData);
  
  try {
    const admin = createAdminClient();
    
    // Get the user ID from token if not provided
    let userId = chatData.userId;
    
    // If no userId provided, try to get from db-auth-token
    if (!userId) {
      const cookieStore = await cookies();
      const dbToken = cookieStore.get('db-auth-token')?.value;
      
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
            userId = data.uuid;
          }
        }
      }
    }
    
    // If still no userId, use fallback
    if (!userId) {
      console.log('No user ID found, using fallback');
      userId = 'unknown-user';
    }
    
    // Generate ID if not provided
    const chatId = chatData.id || uuidv4();
    console.log(`Saving chat with id: ${chatId}`);
    
    // Save to database
    const { error } = await admin
      .from('chats')
      .upsert({
        id: chatId,
        user_id: userId,
        name: chatData.name,
        messages: chatData.messages
      });
      
    if (error) {
      console.error('Error saving chat:', error);
      return { success: false, error: error.message };
    }
    
    return { success: true, id: chatId };
  } catch (error) {
    console.error('Error in saveChat:', error);
    return { success: false, error: (error as Error).message };
  }
} 