import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { headers } from 'next/headers'

export async function POST(req: Request) {
  try {
    const headers_ = await headers()
    const connectionString = headers_.get('x-connection-string')
    const openaiApiKey = process.env.OPENAI_API_KEY
    
    if (!openaiApiKey) {
      return new Response('Missing OpenAI API key', { status: 500 })
    }

    if (!connectionString) {
      return new Response('Missing connection string', { status: 400 })
    }

    const { content } = await req.json()
    
    if (!content) {
      return new Response('No content provided', { status: 400 })
    }

    const openai = createOpenAI({
      apiKey: openaiApiKey,
    })

    const result = await generateText({
      model: openai('gpt-4.1-mini'),
      system: `
      You are a specialized SQL correction assistant. Your task is to review an entire response 
      that contains SQL, fix any errors in the SQL query, and return the ENTIRE corrected response.
      
      Look carefully at the response and identify SQL code blocks (marked with \`\`\`sql ... \`\`\`).
      If there are issues with the SQL query, fix them according to PostgreSQL syntax.
      
      Do not change explanatory text outside the SQL code blocks.
      Keep the same overall structure of the response, just improve the SQL query part.
      If there are duplicate SQL blocks or explanations, remove the duplicates to ensure the response
      is clear and non-repetitive.
      
      Return the complete corrected response with proper formatting, not just the SQL part.
      `,
      prompt: content,
    })

    return new Response(JSON.stringify({ correctedContent: result.text }), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Error in query correction:', error)
    return new Response('Error correcting query', { status: 500 })
  }
} 