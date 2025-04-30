import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

// Allow longer processing time for this route
export const maxDuration = 10

export async function POST(req: Request) {
  try {
    const { chatId } = await req.json()
    
    if (!chatId) {
      return new Response('Chat ID is required', { status: 400 })
    }
    
    const client = await createClient()
    const { data } = await client.auth.getUser()
    const user = data.user
    
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }
    
    // Check if the chat exists
    const { data: chat, error } = await client
      .from('chats')
      .select('id, name, messages, user_id')
      .eq('id', chatId)
      .single()
      
    if (error) {
      console.error('Error fetching chat:', error)
      return new Response(error.message, { status: 500 })
    }
    
    if (!chat) {
      return new Response('Chat not found', { status: 404 })
    }
    
    // Verify ownership
    if (chat.user_id !== user.id) {
      return new Response('Unauthorized', { status: 401 })
    }
    
    // If the chat already has a custom name (not "New Chat"), don't change it
    if (chat.name && chat.name !== 'New Chat') {
      return new Response(JSON.stringify({ name: chat.name }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    // Get OpenAI API key
    const projectOpenaiApiKey = process.env.OPENAI_API_KEY
    if (!projectOpenaiApiKey) {
      return new Response('Server configuration error', { status: 500 })
    }
    
    const openai = createOpenAI({
      apiKey: projectOpenaiApiKey,
    })
    
    // Generate name using the same prompt as in route.ts
    let generatedName
    try {
      generatedName = await generateText({
        model: openai('gpt-4o-mini'),
        system: `
          You are an assistant that generates short, concise, descriptive chat names for a PostgreSQL chatbot. 
          The name must:
          • Capture the essence of the conversation in one sentence.
          • Be relevant to PostgreSQL topics.
          • Contain no extra words, labels, or prefixes such as "Title:" or "Chat:".
          • Not include quotation marks or the word "Chat" anywhere.

          Example of a good name: Counting users
          Example of a good name: Counting users in the last 30 days

          Example of a bad name: Chat about PostgreSQL: Counting users
          Example of a bad name: "Counting users"

          Your response should be the title text only, nothing else.
        `,
        prompt: `The messages are <MESSAGES>${chat.messages || '[]'}</MESSAGES>`,
      })
    } catch (error) {
      console.error('Error generating name:', error)
      generatedName = { text: 'Database Analysis' }
    }
    
    // Default to "Database Analysis" if messages are empty
    const finalName = chat.messages && Array.isArray(chat.messages) && chat.messages.length > 0 
      ? generatedName.text
      : 'Database Analysis'
    
    // Update the chat with the new name
    await client
      .from('chats')
      .update({ name: finalName })
      .eq('id', chatId)
    
    // Revalidate the app path
    revalidatePath('/app')
    
    return new Response(
      JSON.stringify({ name: finalName }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in generate-name route:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to generate name' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
} 