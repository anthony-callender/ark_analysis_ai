'use server'

import { revalidatePath } from 'next/cache'

export async function changeName(formData: FormData) {
  const id = formData.get('id') as string
  const name = formData.get('name') as string

  if (!id || !name) {
    return { error: 'Missing id or name' }
  }

  if (name.length > 100) {
    return { error: 'Name must be less than 100 characters' }
  }

  try {
    // The actual update will happen on the client side in localStorage
    // This server action just returns success to allow client-side updates
    
    // Revalidate paths to refresh the UI
    revalidatePath('/app')
    revalidatePath(`/app/${id}`)
    
    return { success: 'Name changed successfully' }
  } catch (error) {
    console.error('Error in changeName:', error)
    return { error: 'Failed to change name' }
  }
}
