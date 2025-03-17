'use server'

import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function deleteChat(chatId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chats')
    .delete()
    .eq('id', chatId)

  if (error) {
    throw new Error('Failed to delete chat')
  }

  return { success: true }
} 