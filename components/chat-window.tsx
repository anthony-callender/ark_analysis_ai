'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export interface ChatWindowProps {
  user?: User | null;
  chatId?: string;
}

// Memoized message component to prevent unnecessary re-renders
const ChatMessage = memo(({ 
  message, 
  sqlResults, 
  handleSetSqlResult, 
  connectionString, 
  isLoading, 
  getSqlResultKey,
  showSQL
}: { 
  message: Message, 
  sqlResults: Record<string, any>, 
  handleSetSqlResult: (key: string, result: any) => void, 
  connectionString: string, 
  isLoading: boolean,
  getSqlResultKey: (content: string, messageId: string) => string,
  showSQL: boolean
}) => {
  const messageContent = useMemo(() => message.content, [message.content]);
  const messageRole = useMemo(() => message.role, [message.role]);
  const messageId = useMemo(() => message.id, [message.id]);

  if (messageRole === "user") {
    return (
      <div className="flex justify-end">
        <span className="text-base leading-relaxed break-words max-w-xs md:max-w-md lg:max-w-xl rounded-2xl px-4 py-2 shadow bg-primary text-primary-foreground">
          {messageContent}
        </span>
      </div>
    );
  }

  // Memoize markdown components to prevent recreation on each render
  const markdownComponents = useMemo(() => ({
    code: ({ className, children }: any) => {
      const language = className?.includes('sql') ? 'sql' : 'markup';
      const content = children?.toString() || '';
      const sqlResultKey = getSqlResultKey(content, messageId);
      
      // Instead of returning null, set showSqlCode based on showSQL
      return (
        <CodeBlock
          connectionString={connectionString}
          isDisabled={isLoading}
          language={language}
          sqlResult={sqlResults[sqlResultKey]}
          setSqlResult={(result) => handleSetSqlResult(sqlResultKey, result)}
          autoRun={language === 'sql'}
          showSqlCode={language !== 'sql' || showSQL}
        >
          {children}
        </CodeBlock>
      );
    },
    li: ({ children }: any) => <li className="my-1">{children}</li>,
    ul: ({ children }: any) => <ul className="list-disc pl-4 my-1">{children}</ul>,
    table: ({ children }: any) => (
      <div className="my-3"><Table>{children}</Table></div>
    ),
    thead: ({ children }: any) => <TableHeader>{children}</TableHeader>,
    tbody: ({ children }: any) => <TableBody>{children}</TableBody>,
    tr: ({ children }: any) => <TableRow>{children}</TableRow>,
    th: ({ children }: any) => <TableHead>{children}</TableHead>,
    td: ({ children }: any) => <TableCell>{children}</TableCell>,
  }), [connectionString, isLoading, sqlResults, handleSetSqlResult, messageId, getSqlResultKey, showSQL]);

  return (
    <div className="text-base prose prose-neutral dark:prose-invert max-w-none">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {messageContent}
      </Markdown>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom equality check to prevent unnecessary re-renders
  if (prevProps.message.id !== nextProps.message.id) return false;
  if (prevProps.message.content !== nextProps.message.content) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.showSQL !== nextProps.showSQL) return false;
  
  // Check if SQL results have changed for this message
  if (prevProps.message.role === 'assistant') {
    const prevContent = prevProps.message.content;
    const nextContent = nextProps.message.content;
    
    // Only deep compare if content contains SQL
    if (prevContent.includes('```sql') && prevContent === nextContent) {
      // Check if relevant SQL results have changed
      const sqlMatches = prevContent.match(/```sql\s+([\s\S]*?)\s+```/g) || [];
      for (const sqlMatch of sqlMatches) {
        const sqlContent = sqlMatch.replace(/```sql\s+|\s+```/g, '').trim();
        const key = prevProps.getSqlResultKey(sqlContent, prevProps.message.id);
        
        const prevResult = prevProps.sqlResults[key];
        const nextResult = nextProps.sqlResults[key];
        
        // If result changed, allow re-render
        if (JSON.stringify(prevResult) !== JSON.stringify(nextResult)) {
          return false;
        }
      }
    }
  }
  
  return true;
});

export function ChatWindow({ user, chatId }: ChatWindowProps) {
  const { setChat, chat: chatState, clearChat } = useAppState();
  const { value } = useAppLocalStorage();
  const { toast } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const { persistChat } = useChatPersistence();
  const [input, setInput] = useState("");
  
  // SQL results cache with stable reference
  const [sqlResults, setSqlResults] = useState<Record<string, any>>({});
  
  // Stable key generation with referential stability
  const getSqlResultKey = useCallback((content: string, messageId: string) => {
    // Create a stable, deterministic key from the SQL content and message ID
    const normalizedContent = content.trim().replace(/\s+/g, ' ');
    return `${messageId}_${normalizedContent}`;
  }, []);
  
  // Check if we're on the main /app page without a specific chat
  const isMainPage = !chatId;
  
  // Scroll to bottom when messages change - with debouncing
  useEffect(() => {
    if (!endRef.current) return;
    
    const timeoutId = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    
    return () => clearTimeout(timeoutId);
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
  
  // Optimized SQL result handler with memoization and throttling
  const handleSetSqlResult = useCallback(
    (messageId: string, result: any) => {
      // Use a stable version of requestAnimationFrame that won't cause loops
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(window.requestAnimationFrame(() => {}));
        window.requestAnimationFrame(() => {
          setSqlResults((prev) => {
            // Deep equality check to prevent unnecessary updates
            const prevResult = prev[messageId];
            if (prevResult && JSON.stringify(prevResult) === JSON.stringify(result)) {
              return prev;
            }
            return { ...prev, [messageId]: result };
          });
        });
      }
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
        title: "Database Connection Missing",
        description:
          "Please set up your database connection string to use the app.",
        variant: "warning",
        duration: Infinity, // Keep toast until dismissed
      });
    }
  }, [value.connectionString, toast]);

  useEffect(() => {
    if (!value.openaiApiKey) {
      toast({
        title: "OpenAI API Key Missing",
        description: "Please add your OpenAI API key to enable chat functionality.",
        variant: "warning",
        duration: Infinity, // Keep toast until dismissed
      });
    }
  }, [value.openaiApiKey, toast]);

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

  // Add showSQL state from application store
  const showSQL = useAppState((state) => state.showSQL)
  const setShowSQL = useAppState((state) => state.setShowSQL)

  return (
    <Card className="w-full h-full flex flex-col border-0 rounded-none overflow-hidden relative">
      <CardContent className="absolute inset-0 p-0 flex flex-col">
        <div className="flex-1 px-4 py-6 md:px-6 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full space-y-8">
            {(messages.length === 0 || isMainPage) && (
              <div className="text-center py-8">
                <h3 className="text-xl font-semibold mb-2">Welcome to ARK Analysis AI</h3>
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
            
            <AnimatePresence mode="wait">
              {!isMainPage && messages.map((m) => {
                // Create stable message key
                const messageKey = `${m.id}-${m.role}`;
                
                return (
                  <motion.div
                    key={messageKey}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    layout="position"
                    layoutId={messageKey}
                    className="w-full"
                  >
                    <ChatMessage 
                      message={m}
                      sqlResults={sqlResults}
                      handleSetSqlResult={handleSetSqlResult}
                      connectionString={value.connectionString || ''}
                      isLoading={isLoading}
                      getSqlResultKey={getSqlResultKey}
                      showSQL={showSQL}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
            
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
          className="border-t p-4 flex flex-col space-y-2 w-full sticky bottom-0 bg-background"
        >
          <div className="max-w-4xl w-full mx-auto flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMainPage ? "Select a chat to start messaging..." : "Type a message…"}
              rows={1}
              className="flex-1 resize-none bg-gray-800 dark:bg-gray-800 placeholder:text-gray-300 text-white"
              disabled={isLoading || isMainPage}
            />
            <Button 
              type="submit" 
              disabled={!input.trim() || isLoading || isMainPage} 
              className="shrink-0"
              style={{
                backgroundColor: "#3b82f6", 
                color: "white",
                boxShadow: "0 0 5px 2px rgba(255, 255, 255, 0.3), 0 0 10px 5px rgba(255, 255, 255, 0.15)",
                border: "1px solid white"
              }}
            >
              <Send className="h-5 w-5 text-black" />
            </Button>
          </div>
          
          <div className="flex items-center max-w-4xl mx-auto w-full justify-between">
            <div className="flex items-center space-x-2">
              <Switch 
                id="show-sql"
                checked={showSQL}
                onCheckedChange={setShowSQL}
              />
              <Label htmlFor="show-sql" className="text-sm text-muted-foreground">
                Show SQL
              </Label>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
} 