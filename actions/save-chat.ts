'use server'

import { createClient } from '../utils/supabase/server'
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
  
  try {
    // Always save to localStorage on the client side
    // Server-side only handles database operations
    
    // Generate a name for the new chat if needed
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
    
    // We're going to focus entirely on localStorage for chat persistence
    // Return the generated name so the client can update it
    return { success: true, name: chatName }
  } catch (error) {
    console.error('Error in saveChat:', error)
    return { error: 'Failed to process chat' }
  }
} 