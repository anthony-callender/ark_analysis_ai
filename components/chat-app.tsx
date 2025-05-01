'use client'

import { useEffect, useCallback } from "react";
import { ChatSidebar } from "./chat-sidebar";
import { ChatWindow } from "./chat-window";
import { useAppState } from "@/state";
import { User } from "@supabase/supabase-js";

interface ChatAppProps {
  user: User;
  chatId?: string;
  initialChat?: {
    id: string;
    name: string;
    messages: any[];
  };
}

export function ChatApp({ user, chatId, initialChat }: ChatAppProps) {
  const { setChat, updateChats } = useAppState();
  
  // Set initial chat if provided and trigger a chat list refresh
  useEffect(() => {
    if (initialChat) {
      setChat(initialChat);
    }
    
    // Update the chat list to ensure it's in sync with the database
    updateChats().catch(console.error);
  }, [initialChat, setChat, updateChats]);
  
  // Handle any chat changes that require database synchronization
  useEffect(() => {
    // If the chatId changes, refresh the chats
    if (chatId) {
      updateChats().catch(console.error);
    }
  }, [chatId, updateChats]);

  return (
    <div className="flex w-full h-full">
      {/* Sidebar */}
      <ChatSidebar />
      
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-h-screen w-full">
        <ChatWindow user={user} chatId={chatId} />
      </main>
    </div>
  );
} 