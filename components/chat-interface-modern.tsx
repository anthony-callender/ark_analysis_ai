'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Menu, User as UserIcon } from "lucide-react";
import { motion } from "motion/react";
import { Message } from "ai";
import { useChat } from "@ai-sdk/react";
import { User } from "@supabase/supabase-js";
import { useAppState } from "@/state";
import { useAppLocalStorage } from "@/hooks/use-app-local-storage";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "@/components/code-block";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QueryResult } from 'pg';
import { useChatPersistence } from "@/hooks/use-chat-persistence";

/**
 * Modern ChatInterface – a minimal ChatGPT‑style interface built with React, TailwindCSS & shadcn/ui.
 */
export default function ChatInterfaceModern({
  chat: chatProp,
  user,
  showNavbar = true,
}: {
  chat:
    | {
        id: string
        name: string
        messages: Message[]
      }
    | undefined
  user: User
  showNavbar?: boolean
}) {
  const { setChat, chat: chatState, clearChat } = useAppState();
  const { value } = useAppLocalStorage();
  const { toast } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const shouldUpdateChats = useRef(false);
  const { persistChat } = useChatPersistence();
  
  // SQL results state
  const [sqlResults, setSqlResults] = useState<{
    [key: string]: QueryResult<unknown[]> | string
  }>({});
  
  // Maximum number of SQL results to keep in memory
  const MAX_SQL_RESULTS = 10;

  // Initialize chat state from props or create a new chat
  useEffect(() => {
    if (chatProp) {
      setChat(chatProp);
    } else {
      const newChatId = crypto.randomUUID();
      const newChatName = "New Chat";
      
      setChat({
        id: newChatId,
        name: newChatName,
        messages: [],
      });
      
      // Immediately persist the new chat to the database
      persistChat(newChatId, newChatName, [], true)
        .catch(err => console.error("Error persisting new chat:", err));
    }

    // Cleanup function to help with memory management when component unmounts
    return () => {
      clearChat();
      setSqlResults({});
    };
  }, [setChat, chatProp, clearChat, persistChat]);

  // Scroll to bottom when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState?.messages]);

  // Handler for SQL result
  const handleSetSqlResult = useCallback(
    (messageId: string, result: QueryResult<unknown[]> | string) => {
      setSqlResults((prev) => {
        const newResults = {
          ...prev,
          [messageId]: result,
        };
        
        // Check if we have too many results and trim if needed
        const keys = Object.keys(newResults);
        if (keys.length > MAX_SQL_RESULTS) {
          // Remove oldest entries to stay under the limit
          const keysToKeep = keys.slice(-MAX_SQL_RESULTS);
          const trimmedResults: typeof newResults = {};
          
          // Only keep the most recent results
          keysToKeep.forEach(key => {
            trimmedResults[key] = newResults[key];
          });
          
          return trimmedResults;
        }
        
        return newResults;
      });
    },
    []
  );

  // Callback functions for useChat hook
  const onFinish = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });

    if (shouldUpdateChats.current) {
      console.log("Updating chats after chat completion");
      shouldUpdateChats.current = false;
    }
  }, []);

  const onError = useCallback((error: Error) => {
    toast({
      title: "Error",
      description: error.message,
      variant: "destructive",
    });
  }, [toast]);

  const onResponse = useCallback((response: Response) => {
    if (response.headers.get('x-should-update-chats') === 'true') {
      console.log("Server indicated chats should be updated");
      shouldUpdateChats.current = true;
    }
  }, []);

  // Use the AI SDK chat hook
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
      id: chatState?.id,
      initialMessages: chatState?.messages ?? [],
      onError,
      onResponse,
    });
    
  // Optimize large message lists by capping the rendered messages
  const displayMessages = useMemo(() => {
    if (messages.length <= 10) return messages;
    return messages.slice(-10);
  }, [messages]);

  return (
    <div className="flex flex-col h-full w-full bg-gradient-subtle">
      {showNavbar && (
        <header className="border-b w-full glass-panel">
          <div className="flex h-16 items-center px-4 justify-between">
            <div className="flex items-center gap-2">
              <Menu className="h-5 w-5" />
              <span className="font-medium">{chatState?.name || "New Chat"}</span>
            </div>
            <div className="flex items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm">{user.email}</span>
                <div className="h-8 w-8 rounded-full avatar-gradient flex items-center justify-center text-primary-foreground">
                  <UserIcon className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </header>
      )}
      
      <div className="flex-1 overflow-hidden w-full">
        <Card className="w-full h-full flex flex-col border-0 rounded-none bg-transparent shadow-none">
          <CardContent className="flex-1 p-0 flex flex-col h-full">
            {/* Message list */}
            <ScrollArea className="flex-1 p-4 md:p-6">
              <div className="max-w-4xl mx-auto">
                {displayMessages.length > 10 && (
                  <div className="text-center text-sm text-muted-foreground mb-6">
                    Showing only the most recent messages to optimize performance
                  </div>
                )}
                <div className="w-full space-y-10">
                  {displayMessages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="w-full"
                    >
                      {message.role === 'user' ? (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.3 }}
                          className="flex justify-end"
                        >
                          <span className="text-base leading-relaxed break-words max-w-xs md:max-w-md lg:max-w-lg rounded-2xl px-4 py-2 bg-gradient-to-r from-primary-500 to-secondary-500 text-white">
                            {message.content}
                          </span>
                        </motion.div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.4 }}
                          className="text-base prose prose-neutral dark:prose-invert max-w-none glass-panel rounded-xl p-4"
                        >
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code: ({ className, children }) => {
                                const language = className?.includes('sql')
                                  ? 'sql'
                                  : 'markup';
                                return (
                                  <CodeBlock
                                    connectionString={value.connectionString}
                                    isDisabled={isLoading}
                                    language={language}
                                    sqlResult={
                                      sqlResults[`${children?.toString()}_${message.id}`]
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
                                );
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
                        </motion.div>
                      )}
                    </motion.div>
                  ))}
                </div>
                
                {isLoading && messages.length > 0 && messages[messages.length - 1].role === "user" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4"
                  >
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 rounded-full bg-current animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:0.2s]" />
                      <div className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </motion.div>
                )}
                <div ref={endRef} />
              </div>
            </ScrollArea>

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="p-4 flex space-x-2 max-w-6xl mx-auto w-full"
            >
              <div className="w-full glass-panel rounded-xl p-1 flex space-x-2">
                <Textarea
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Type a message…"
                  rows={1}
                  className="flex-1 resize-none border-0 focus-visible:ring-0 bg-transparent"
                  disabled={isLoading}
                />
                <Button 
                  type="submit" 
                  disabled={!input.trim() || isLoading} 
                  className="shrink-0 btn-gradient"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 