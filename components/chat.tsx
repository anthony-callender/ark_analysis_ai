'use client'

import { useChat } from '@ai-sdk/react'
import { useAppLocalStorage } from '@/hooks/use-app-local-storage'
import { useRef, useCallback, useMemo, useState, useEffect, memo } from 'react'
import { motion } from 'motion/react'
import { Form } from './form'
import TextSkeleton from './text-skeleton'
import Markdown from 'react-markdown'
import CodeBlock from './code-block'
import type { QueryResult } from 'pg'
import remarkGfm from 'remark-gfm'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '../hooks/use-toast'
import Navbar from './navbar'
import { User } from '@supabase/supabase-js'
import { useAppState } from '../state'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'

const toolCallToNameText = {
  getExplainForQuery: 'Getting query plan...',
  getForeignKeyConstraints: 'Fetching foreign key relationships...',
  getIndexes: 'Listing table indexes...',
  getIndexStatsUsage: 'Analyzing index usage...',
  getPublicTablesWithColumns: 'Retrieving public tables and columns...',
  getTableStats: 'Collecting table statistics...',
}

function ChatComponent({ initialId, user }: { initialId: string; user: User }) {
  const chat = useAppState((state) => state.chat)
  const updateChats = useAppState((state) => state.updateChats)
  const clearChat = useAppState((state) => state.clearChat)
  const [isNewChat, setIsNewChat] = useState(false)
  const pathname = usePathname()
  const { toast } = useToast()
  const messagesChat = useRef<HTMLDivElement | null>(null)
  const { value } = useAppLocalStorage()

  // Enhanced scroll performance with throttling
  const scrollMessagesToBottom = useCallback(() => {
    if (!messagesChat.current) return

    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      if (messagesChat.current) {
        messagesChat.current.scrollTo({
          top: messagesChat.current.scrollHeight,
          behavior: 'smooth',
        })
      }
    })
  }, [])

  const shouldUpdateChats = useRef(false)

  const onFinish = useCallback(() => {
    scrollMessagesToBottom()

    if (shouldUpdateChats.current) {
      setIsNewChat(false)
      updateChats().catch((err) => {
        console.error(err)
      })
    }
  }, [isNewChat, scrollMessagesToBottom, updateChats])

  const onError = useCallback((error: Error) => {
    toast({
      title: 'Error',
      description: error.message,
      variant: 'destructive',
    })
  }, [])

  const onResponse = useCallback((response: Response) => {
    if (response.headers.get('x-should-update-chats') === 'true') {
      shouldUpdateChats.current = true
    }
  }, [])

  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      api: '/api/chat',
      headers: {
        'x-connection-string': value.connectionString,
        'x-openai-api-key': value.openaiApiKey,
      },
      onFinish,
      streamProtocol: 'data',
      sendExtraMessageFields: true,
      id: initialId,
      initialMessages: chat?.messages ?? [],
      onError,
      onResponse,
    })

  // Improved component cleanup
  useEffect(() => {
    return () => {
      // Clear SQL results
      setSqlResults({})
      
      // Clear chat state when component unmounts
      if (typeof clearChat === 'function') {
        clearChat()
      }
      
      // Clear any pending animations
      if (messagesChat.current) {
        messagesChat.current = null
      }
      
      // Set local state references to null
      shouldUpdateChats.current = false
    }
  }, [clearChat])

  const showSkeleton = useMemo(() => {
    if (!messages.length) return false
    const lastMessageIsUser = messages[messages.length - 1]?.role === 'user'
    return isLoading && lastMessageIsUser
  }, [isLoading, messages])

  // New state to manage SQL results with a cap on size
  const [sqlResults, setSqlResults] = useState<{
    [key: string]: QueryResult<unknown[]> | string
  }>({})

  // Maximum number of SQL results to keep in memory
  const MAX_SQL_RESULTS = 8 // Reduced from 10 to 8 to further optimize memory usage

  // Optimize SQL result management
  const handleSetSqlResult = useCallback(
    (messageId: string, result: QueryResult<unknown[]> | string) => {
      setSqlResults((prev) => {
        // Optimize large result sets if they're database results
        let optimizedResult = result;
        if (typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
          // Limit rows to a maximum of 100 to prevent memory issues with large result sets
          if (result.rows.length > 100) {
            const limitedRows = result.rows.slice(0, 100);
            // Create a new result object with proper typing
            optimizedResult = {
              ...result,
              rows: limitedRows,
              rowCount: result.rowCount,
              // Added as a comment rather than a property
              // Result is truncated (showing 100 of total rows)
            } as QueryResult<unknown[]>;
            
            // Log truncation info to console instead
            console.log(`Results truncated (showing 100 of ${result.rows.length} rows)`);
          }
        }

        const newResults = {
          ...prev,
          [messageId]: optimizedResult,
        }
        
        // Check if we have too many results and trim if needed
        const keys = Object.keys(newResults)
        if (keys.length > MAX_SQL_RESULTS) {
          // Remove oldest entries to stay under the limit
          const keysToKeep = keys.slice(-MAX_SQL_RESULTS)
          const trimmedResults: typeof newResults = {}
          
          // Only keep the most recent results
          keysToKeep.forEach(key => {
            trimmedResults[key] = newResults[key]
          })
          
          return trimmedResults
        }
        
        return newResults
      })
    },
    []
  )

  // Optimize large message lists by limiting the rendered messages
  const displayMessages = useMemo(() => {
    if (messages.length <= 8) return messages; // Display all messages if there are 8 or fewer
    return messages.slice(-8); // Only show the latest 8 messages to preserve memory
  }, [messages]);

  const toolsLoading = useMemo(() => {
    const toolInvocation = messages[messages.length - 1]?.toolInvocations

    return (toolInvocation ?? []).filter((tool) => tool.state === 'call')
  }, [messages])

  // Function to manually trigger memory cleanup
  const forceMemoryCleanup = useCallback(() => {
    // Clear any unused SQL results
    setSqlResults({});
    
    // Show toast to acknowledge the cleanup
    toast({
      title: "Memory cleaned",
      description: "Chat memory has been optimized",
      duration: 2000,
    });
  }, [toast]);

  return (
    <div className="flex-1 flex flex-col w-full">
      <Navbar user={user} />

      <div ref={messagesChat} className="flex-1 overflow-y-auto w-full">
        <div className="container mx-auto max-w-4xl h-full">
          <div className="px-4 py-6">
            {messages.length > 8 && (
              <div className="text-center mb-6">
                <div className="text-sm text-muted-foreground">
                  Showing only the {displayMessages.length} most recent messages to optimize performance
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={forceMemoryCleanup} 
                  className="mt-1 text-xs"
                >
                  Clean Memory
                </Button>
              </div>
            )}
            <div className="w-full space-y-12">
              {displayMessages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-full"
                >
                  {message.role === 'user' ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-2xl font-bold text-primary mb-6 border-b pb-2"
                    >
                      {message.content}
                    </motion.div>
                  ) : (
                    <>
                      {message.parts && message.parts.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.4 }}
                          className="text-base prose prose-neutral dark:prose-invert max-w-none"
                        >
                          {message.parts ? (
                            message.parts.map((part, index) => {
                              if (part.type === 'tool-invocation') {
                                return null
                              }

                              // Fix TypeScript error by properly checking for part type
                              const content = 
                                'text' in part ? part.text : 
                                ('reasoning' in part ? part.reasoning : '');

                              return (
                                <Markdown
                                  key={`${message.id}-part-${index}`}
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    code: ({ className, children }) => {
                                      const language = className?.includes(
                                        'sql'
                                      )
                                        ? 'sql'
                                        : 'markup'
                                      return (
                                        <CodeBlock
                                          connectionString={
                                            value.connectionString
                                          }
                                          isDisabled={isLoading}
                                          language={language}
                                          sqlResult={
                                            sqlResults[
                                              `${children?.toString()}_${message.id}`
                                            ]
                                          }
                                          setSqlResult={(result) =>
                                            handleSetSqlResult(
                                              `${children?.toString()}_${message.id}`,
                                              result
                                            )
                                          }
                                          autoRun={language === 'sql'}
                                        >
                                          {children}
                                        </CodeBlock>
                                      )
                                    },
                                    li: ({ children }) => (
                                      <li className="my-1">{children}</li>
                                    ),
                                    ul: ({ children }) => (
                                      <ul className="list-disc pl-4 my-1">
                                        {children}
                                      </ul>
                                    ),
                                    h1: ({ children }) => (
                                      <h1 className="text-2xl font-bold my-2">
                                        {children}
                                      </h1>
                                    ),
                                    h2: ({ children }) => (
                                      <h2 className="text-xl font-semibold my-1">
                                        {children}
                                      </h2>
                                    ),
                                    h3: ({ children }) => (
                                      <h3 className="text-lg font-medium my-1">
                                        {children}
                                      </h3>
                                    ),
                                    h4: ({ children }) => (
                                      <h4 className="text-base font-normal my-1">
                                        {children}
                                      </h4>
                                    ),
                                    h5: ({ children }) => (
                                      <h5 className="text-sm font-normal my-1">
                                        {children}
                                      </h5>
                                    ),
                                    h6: ({ children }) => (
                                      <h6 className="text-xs font-normal my-1">
                                        {children}
                                      </h6>
                                    ),
                                    table: ({ children }) => (
                                      <div className="my-3">
                                        <Table>{children}</Table>
                                      </div>
                                    ),
                                    thead: ({ children }) => (
                                      <TableHeader>{children}</TableHeader>
                                    ),
                                    tbody: ({ children }) => (
                                      <TableBody>{children}</TableBody>
                                    ),
                                    tr: ({ children }) => (
                                      <TableRow>{children}</TableRow>
                                    ),
                                    th: ({ children }) => (
                                      <TableHead>{children}</TableHead>
                                    ),
                                    td: ({ children }) => (
                                      <TableCell>{children}</TableCell>
                                    ),
                                  }}
                                >
                                  {content}
                                </Markdown>
                              )
                            })
                          ) : (
                            <Markdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code: ({ className, children }) => {
                                  const language = className?.includes('sql')
                                    ? 'sql'
                                    : 'markup'
                                  return (
                                    <CodeBlock
                                      connectionString={value.connectionString}
                                      isDisabled={isLoading}
                                      language={language}
                                      sqlResult={
                                        sqlResults[
                                          `${children?.toString()}_${message.id}`
                                        ]
                                      }
                                      setSqlResult={(result) =>
                                        handleSetSqlResult(
                                          `${children?.toString()}_${message.id}`,
                                          result
                                        )
                                      }
                                      autoRun={language === 'sql'}
                                    >
                                      {children}
                                    </CodeBlock>
                                  )
                                },
                                li: ({ children }) => (
                                  <li className="my-1">{children}</li>
                                ),
                                ul: ({ children }) => (
                                  <ul className="list-disc pl-4 my-1">
                                    {children}
                                  </ul>
                                ),
                                h1: ({ children }) => (
                                  <h1 className="text-2xl font-bold my-2">
                                    {children}
                                  </h1>
                                ),
                                h2: ({ children }) => (
                                  <h2 className="text-xl font-semibold my-1">
                                    {children}
                                  </h2>
                                ),
                                h3: ({ children }) => (
                                  <h3 className="text-lg font-medium my-1">
                                    {children}
                                  </h3>
                                ),
                                h4: ({ children }) => (
                                  <h4 className="text-base font-normal my-1">
                                    {children}
                                  </h4>
                                ),
                                h5: ({ children }) => (
                                  <h5 className="text-sm font-normal my-1">
                                    {children}
                                  </h5>
                                ),
                                h6: ({ children }) => (
                                  <h6 className="text-xs font-normal my-1">
                                    {children}
                                  </h6>
                                ),
                                table: ({ children }) => (
                                  <div className="my-3">
                                    <Table>{children}</Table>
                                  </div>
                                ),
                                thead: ({ children }) => (
                                  <TableHeader>{children}</TableHeader>
                                ),
                                tbody: ({ children }) => (
                                  <TableBody>{children}</TableBody>
                                ),
                                tr: ({ children }) => (
                                  <TableRow>{children}</TableRow>
                                ),
                                th: ({ children }) => (
                                  <TableHead>{children}</TableHead>
                                ),
                                td: ({ children }) => (
                                  <TableCell>{children}</TableCell>
                                ),
                              }}
                            >
                              {message.content}
                            </Markdown>
                          )}
                        </motion.div>
                      )}
                      {(showSkeleton || toolsLoading.length > 0) &&
                        message.id === messages[messages.length - 1].id && (
                          <div className="mt-6">
                            <TextSkeleton />
                            {toolsLoading.map((tool) => {
                              const aiRunningText =
                                toolCallToNameText[
                                  tool.toolName as keyof typeof toolCallToNameText
                                ] ?? ''

                              return (
                                aiRunningText && (
                                  <motion.div
                                    key={tool.toolCallId}
                                    initial={{ opacity: 0.5 }}
                                    animate={{ opacity: [0.5, 1, 0.5] }}
                                    transition={{
                                      duration: 1.5,
                                      repeat: Number.POSITIVE_INFINITY,
                                      ease: 'easeInOut',
                                    }}
                                    className="text-primary/70 font-medium mt-2"
                                  >
                                    <p>{aiRunningText}</p>
                                  </motion.div>
                                )
                              )
                            })}
                          </div>
                        )}
                    </>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none border-t bg-sidebar">
        <div className="container max-w-4xl mx-auto p-4">
          <Form
            onChange={handleInputChange}
            value={input}
            onSubmit={async (e) => {
              if (typeof window !== 'undefined') {
                if (pathname === '/app') {
                  try {
                    setIsNewChat(true)
                    window.history.pushState({}, '', `/app/${initialId}`)
                  } catch (error) {
                    console.error('Error pushing state:', error)
                  }
                }
              }
              handleSubmit(e)
              scrollMessagesToBottom()
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default ChatComponent
