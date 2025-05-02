'use client'

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { motion } from "motion/react";
import { Message } from "ai";
import { useChat } from "@ai-sdk/react";
import { useAppState } from "@/state";
import { useAppLocalStorage } from "@/hooks/use-app-local-storage";
import { useToast } from "@/hooks/use-toast";
import { useChatPersistence } from "@/hooks/use-chat-persistence";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "@/components/code-block";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { User } from "@supabase/supabase-js";

export interface ChatWindowProps {
  user: User;
  chatId?: string;
}

export function ChatWindow({ user, chatId }: ChatWindowProps) {
  const { setChat, chat: chatState, clearChat } = useAppState();
  const { value } = useAppLocalStorage();
  const { toast } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const { persistChat } = useChatPersistence();
  const [input, setInput] = useState("");
  
  // SQL results state
  const [sqlResults, setSqlResults] = useState<Record<string, any>>({});
  
  // Check if we're on the main /app page without a specific chat
  const isMainPage = !chatId;
  
  // Scroll to bottom when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState?.messages]);
  
  // Callback functions for useChat hook
  const onFinish = useCallback(() => {
    // Use the global chat state which should be updated by the sync effect
    const currentChatState = useAppState.getState().chat;
    
    // Save the chat after the AI response is finished
    if (currentChatState?.id) {
      persistChat(
        currentChatState.id,
        currentChatState.name,
        currentChatState.messages || [], // Use messages from the global state
        true
      ).catch(err => console.error("Error persisting chat:", err));
    }

    endRef.current?.scrollIntoView({ behavior: "smooth" });
  // Only depend on persistChat and chatState.id/name if needed for condition check,
  // but avoid depending on chatState.messages directly here to prevent loops.
  // persistChat itself depends on useAppState, so it has access.
  }, [persistChat]);

  const onError = useCallback((error: Error) => {
    toast({
      title: "Error",
      description: error.message,
      variant: "destructive",
    });
  }, [toast]);
  
  // Handler for SQL result
  const handleSetSqlResult = useCallback(
    (messageId: string, result: any) => {
      setSqlResults((prev) => ({
        ...prev,
        [messageId]: result,
      }));
    },
    []
  );

  // Use the AI SDK chat hook - only initialize if we have a valid chat
  const { messages, isLoading, handleSubmit, append, error: chatError } = useChat({
    api: '/api/chat',
    headers: {
      'x-connection-string': value.connectionString || '',
      'x-openai-api-key': value.openaiApiKey || '',
      'Content-Type': 'application/json',
    },
    body: {
      id: chatState?.id,
    },
    onFinish,
    streamProtocol: 'data',
    sendExtraMessageFields: true,
    id: chatState?.id,
    initialMessages: chatState?.messages || [],
    onError,
  });
  
  // Display connection error if present
  useEffect(() => {
    if (chatError) {
      console.error("Chat API error:", chatError);
      toast({
        title: "API Error",
        description: chatError.message || "Failed to connect to AI service",
        variant: "destructive",
      });
    }
  }, [chatError, toast]);

  // Check for missing connection details
  useEffect(() => {
    if (!value.connectionString) {
      toast({
        title: "Connection Settings Required",
        description: (
          <div className="flex flex-col space-y-2">
            <p>Database connection string is not set.</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => window.location.href = '/settings'}
            >
              Go to Settings
            </Button>
          </div>
        ),
        variant: "destructive",
      });
    }
  }, [value.connectionString, toast]);

  // Update the app state when messages change
  useEffect(() => {
    // Guard clauses: Only run if we have a valid chat context and messages from useChat
    if (!chatState || !chatState.id || !messages || messages.length === 0) return;

    // Track if the component is still mounted
    let isMounted = true;
    
    // Add debounce to avoid rapid state updates
    const debounceTimeMs = 100; // 100ms debounce
    const debounceTimerId = setTimeout(() => {
      // Only proceed if component is still mounted
      if (!isMounted) return;
      
      // Define the comparison function (ensure it handles null/undefined message arrays)
      const messagesChanged = () => {
          if (!chatState.messages) return true; // If global state has no messages yet, it's a change
          if (messages.length !== chatState.messages.length) return true; // Length differs

          // Compare message content, roles, and IDs
          for (let i = 0; i < messages.length; i++) {
            // Defensive checks for potentially undefined messages in arrays
            const msgFromHook = messages[i];
            const msgFromState = chatState.messages[i];
            if (!msgFromHook || !msgFromState) return true; // Should not happen, but safe check

            if (msgFromHook.content !== msgFromState.content ||
                msgFromHook.role !== msgFromState.role ||
                msgFromHook.id !== msgFromState.id
               ) {
              return true;
            }
          }
          return false;
        };

      // Only update state if messages have actually changed
      // Ensure chatId from props matches the state ID before syncing
      if (chatId === chatState.id && messagesChanged()) {
        console.log(`Syncing useChat messages (count: ${messages.length}) to global state for chat ID: ${chatState.id}`);
        
        // Use a setTimeout to break potential update cycles
        // This prevents the Maximum update depth exceeded error
        setTimeout(() => {
          // Create a deep clone of the messages to prevent reference issues
          const clonedMessages = messages.map(m => ({...m}));
          setChat({
            id: chatState.id, // Use existing ID from state
            name: chatState.name, // Use existing name from state
            messages: clonedMessages,
          });
        }, 0);
      }
    }, debounceTimeMs);
    
    // Clean up debounce timer on unmount
    return () => {
      isMounted = false;
      clearTimeout(debounceTimerId);
    };
    
    // Dependencies: Reduced set - run primarily when messages from useChat change
    // for the relevant chat context (identified by chatState.id matching chatId).
  }, [messages, chatState?.id, setChat, chatId]);

  // Handle form submission
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    console.log('Submitting message:', input);
    
    // Try both methods to ensure the message gets through
    try {
      // Method 1: Use handleSubmit from useChat
      handleSubmit(e as any, { data: { content: input } });
      
      // Method 2: Use append as a fallback
      if (typeof append === 'function') {
        append({
          content: input,
          role: 'user',
          id: Date.now().toString(),
        });
      }
      
      setInput("");
    } catch (error) {
      console.error("Error submitting message:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter without shift key
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit(e);
    }
    // Allow new line with Shift+Enter (default behavior)
  };

  return (
    <Card className="w-full h-full flex flex-col border-0 rounded-none overflow-hidden relative">
      <CardContent className="absolute inset-0 p-0 flex flex-col">
        <div className="flex-1 px-4 py-6 md:px-6 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full space-y-8">
            {(messages.length === 0 || isMainPage) && (
              <div className="text-center py-8">
                <h3 className="text-xl font-semibold mb-2">Welcome to Database Analysis AI</h3>
                <p className="text-muted-foreground mb-4">
                  {isMainPage 
                    ? "Select an existing chat or create a new one to get started."
                    : "Start a conversation by typing a message below."}
                </p>
                {isMainPage && (
                  <div className="mt-4">
                    <Button 
                      variant="outline" 
                      onClick={() => window.location.href = '/settings'}
                      className="mx-auto"
                    >
                      Configure Database Settings
                    </Button>
                  </div>
                )}
              </div>
            )}
            
            {!isMainPage && messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full"
              >
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <span className="text-base leading-relaxed break-words max-w-xs md:max-w-md lg:max-w-xl rounded-2xl px-4 py-2 shadow bg-primary text-primary-foreground">
                      {m.content}
                    </span>
                  </div>
                ) : (
                  <div className="text-base prose prose-neutral dark:prose-invert max-w-none">
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
                                sqlResults[`${children?.toString()}_${m.id}`]
                              }
                              setSqlResult={(result) =>
                                handleSetSqlResult(
                                  `${children?.toString()}_${m.id}`,
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
                          <ul className="list-disc pl-4 my-1">{children}</ul>
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
                      {m.content}
                    </Markdown>
                  </div>
                )}
              </motion.div>
            ))}
            
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
        </div>

        <form
          onSubmit={handleFormSubmit}
          className="border-t p-4 flex space-x-2 w-full sticky bottom-0 bg-background"
        >
          <div className="max-w-4xl w-full mx-auto flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMainPage ? "Select a chat to start messaging..." : "Type a message…"}
              rows={1}
              className="flex-1 resize-none"
              disabled={isLoading || isMainPage}
            />
            <Button 
              type="submit" 
              disabled={!input.trim() || isLoading || isMainPage} 
              className="shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
} 