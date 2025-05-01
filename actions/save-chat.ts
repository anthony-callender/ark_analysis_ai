'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'

export async function saveChat({
  id,
  name,
  messages,
}: {
  id: string
  name: string
  messages: any[]
}) {
  console.log('Saving chat with id:', id)
  const supabase = await createClient()
  
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    console.error('Authentication error:', userError || 'No user found')
    return { error: 'Auth error' }
  }

  // Check if chat already exists
  const { data: existingChat, error: checkError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (checkError) {
    console.error('Error checking existing chat:', checkError)
    return { error: checkError.message }
  }

  try {
    if (existingChat) {
      console.log('Updating existing chat:', id)
      
      const { error: updateError } = await supabase
        .from('chats')
        .update({
          messages: JSON.stringify(messages),
          name: name,
        })
        .eq('id', id)
      
      if (updateError) {
        console.error('Error updating chat:', updateError)
        return { error: updateError.message }
      }
    } else {
      console.log('Creating new chat:', id)
      
      // Generate a name for the new chat
      let chatName = name
      
      // Only generate a name if it's still the default
      if (name === 'New Chat' && process.env.OPENAI_API_KEY) {
        try {
          const openai = createOpenAI({
            apiKey: process.env.OPENAI_API_KEY,
          })
          
          const generatedName = await generateText({
            model: openai('gpt-4o-mini'),
            system: `
              You are an assistant that generates short, concise, descriptive chat names.
              The name must:
              • Be short and descriptive, 2-5 words maximum
              • Contain no extra words, labels, or prefixes
              • Not include quotation marks or the word "Chat" anywhere
              • Be capitalized like a title

              Example of a good name: SQL Database Analysis
              Example of a good name: Query Optimization
              Example of a good name: Data Exploration

              Your response should be the title text only, nothing else.
            `,
            prompt: `Generate a title for a new database analysis chat. If no messages are provided, use "Database Analysis". Keep it professional and concise.`,
            temperature: 0.7,
          })
          
          chatName = generatedName.text.trim()
          console.log('Generated chat name:', chatName)
        } catch (error) {
          console.error('Error generating chat name:', error)
          // Fall back to default name if generation fails
          chatName = 'Database Analysis'
        }
      }
      
      const { error: insertError } = await supabase
        .from('chats')
        .insert({
          id,
          user_id: user.id,
          messages: JSON.stringify(messages || []),
          name: chatName,
          created_at: new Date().toISOString(),
        })
      
      if (insertError) {
        console.error('Error creating chat:', insertError)
        return { error: insertError.message }
      }
      
      // Return the generated name so the client can update it
      return { success: true, name: chatName }
    }

    // Revalidate all app paths to refresh UI components
    revalidatePath('/app')
    revalidatePath(`/app/${id}`)
    
    return { success: true }
  } catch (error) {
    console.error('Error saving chat:', error)
    return { error: 'Failed to save chat' }
  }
} 