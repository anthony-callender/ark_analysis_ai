'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function deleteChat(chatId: string) {
  const supabase = await createClient()

  try {
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId)

    if (error) {
      console.error('Error deleting chat:', error)
      throw new Error('Failed to delete chat')
    }

    // Revalidate all relevant paths to refresh UI
    revalidatePath('/app')
    revalidatePath(`/app/${chatId}`)

    return { success: true }
  } catch (error) {
    console.error('Error in deleteChat:', error)
    throw new Error('Failed to delete chat')
  }
} 