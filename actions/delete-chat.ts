'use server'

import { revalidatePath } from 'next/cache'

export async function deleteChat(chatId: string) {
  try {
    // Server action can't directly access localStorage, but will revalidate paths
    // The actual deletion will be performed by the client

    // Revalidate all relevant paths to refresh UI
    revalidatePath('/app')
    revalidatePath(`/app/${chatId}`)

    return { success: true }
  } catch (error) {
    console.error('Error in deleteChat:', error)
    throw new Error('Failed to delete chat')
  }
} 