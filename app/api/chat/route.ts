import { createOpenAI } from '@ai-sdk/openai'
import {
  streamText,
  convertToCoreMessages,
  tool,
  smoothStream,
  appendResponseMessages,
  generateText,
} from 'ai'
import { headers } from 'next/headers'
import { z } from 'zod'
import { DIOCESE_CONFIG } from '@/config/diocese'
import {
  getExplainForQuery,
  getForeignKeyConstraints,
  getIndexes,
  getIndexStatsUsage,
  getPublicTablesWithColumns,
  getTableStats,
} from './utils'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { executeQueryWorkflow } from './agents/workflow'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  console.log('Starting POST request')
  const client = await createClient()
  const { data } = await client.auth.getUser()
  const user = data.user
  if (!user) {
    console.log('Unauthorized: No user found')
    return new Response('Unauthorized', { status: 401 })
  }

  const { messages, id } = await req.json()
  console.log('Request payload:', { id, messageCount: messages?.length })

  const headers_ = await headers()
  const connectionString = headers_.get('x-connection-string')
  const openaiApiKey = headers_.get('x-openai-api-key')
  const model = headers_.get('x-model')

  if (!id) {
    console.log('Bad request: No id provided')
    return new Response('No id provided', { status: 400 })
  }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) {
    console.log('Bad request: Invalid UUID format', id)
    return new Response('Invalid id', { status: 400 })
  }

  // check if the chat exists
  const { data: chat, error } = await client
    .from('chats')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Database error when fetching chat:', error)
    return new Response('Error fetching chat', { status: 500 })
  }

  // is chat from user
  if (chat && chat.user_id !== user.id) {
    console.log('Unauthorized: Chat belongs to different user', {
      chatUserId: chat.user_id,
      requestUserId: user.id,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  if (!connectionString) {
    console.log('Bad request: Missing connection string')
    return new Response('No connection string provided', { status: 400 })
  }

  const projectOpenaiApiKey = process.env.OPENAI_API_KEY

  const shouldUpdateChats = !chat

  // Execute the multi-agent workflow
  console.log('Starting workflow execution')
  const workflowResult = await executeQueryWorkflow(
    messages[messages.length - 1].content,
    connectionString,
    projectOpenaiApiKey!
  )
  console.log('Workflow execution completed:', workflowResult)

  if (workflowResult.error) {
    console.log('Workflow error:', workflowResult.error)
    return new Response(workflowResult.error, { status: 400 })
  }

  // Create a streaming response with the final query and feedback
  console.log('Creating streaming response')
  const result = streamText({
    model: createOpenAI({ apiKey: projectOpenaiApiKey! })('gpt-4o'),
    messages: convertToCoreMessages([
      ...messages,
      {
        role: 'assistant',
        content: `Here's the optimized query:\n\n\`\`\`sql\n${workflowResult.query}\n\`\`\`\n\nOptimization Notes:\n${workflowResult.optimizationNotes}`
      }
    ]),
    system: 'You are a PostgreSQL database optimization expert. Provide clear explanations of the query and its optimizations.'
  })

  // Update chat history
  try {
    if (chat) {
      console.log('Updating existing chat:', id)
      await client
        .from('chats')
        .update({
          messages: JSON.stringify([
            ...messages,
            {
              role: 'assistant',
              content: `Here's the optimized query:\n\n\`\`\`sql\n${workflowResult.query}\n\`\`\`\n\nOptimization Notes:\n${workflowResult.optimizationNotes}`
            }
          ]),
        })
        .eq('id', id)
    } else {
      console.log('Creating new chat:', id)
      await client.from('chats').insert({
        id,
        user_id: user.id,
        messages: JSON.stringify([
          ...messages,
          {
            role: 'assistant',
            content: `Here's the optimized query:\n\n\`\`\`sql\n${workflowResult.query}\n\`\`\`\n\nOptimization Notes:\n${workflowResult.optimizationNotes}`
          }
        ]),
        name: 'Database Query Optimization',
        created_at: new Date().toISOString(),
      })
    }
    console.log('Database update completed successfully')
    revalidatePath('/app')
  } catch (error) {
    console.error('Error updating database:', error)
  }

  console.log('Returning stream response')
  return result.toDataStreamResponse({
    headers: {
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  })
}
