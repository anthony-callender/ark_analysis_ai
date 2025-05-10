'use client'

import { useEffect } from "react";
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
  } | null | undefined;
}

export function ChatApp({ user, chatId, initialChat }: ChatAppProps) {
  const { setChat } = useAppState();
  
  // Load chat from localStorage or use initialChat
  useEffect(() => {
    if (initialChat) {
      // If initialChat is provided from the server, use it
      setChat(initialChat);
    } else if (chatId) {
      // Otherwise, try to load it from localStorage
      try {
        const chatData = localStorage.getItem(`chat-${chatId}`);
        if (chatData) {
          const chatObj = JSON.parse(chatData);
          setChat({
            id: chatObj.id,
            name: chatObj.name,
            messages: chatObj.messages || []
          });
        } else {
          // If not found in localStorage, create an empty chat
          setChat({
            id: chatId,
            name: "New Chat",
            messages: []
          });
        }
      } catch (error) {
        console.error("Error loading chat from localStorage:", error);
        // Fallback to empty chat
        setChat({
          id: chatId,
          name: "New Chat",
          messages: []
        });
      }
    }
  }, [chatId, initialChat, setChat]);

  return (
    <div className="flex w-full h-screen overflow-hidden fixed inset-0">
      {/* Sidebar */}
      <ChatSidebar />
      
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatWindow user={user} chatId={chatId} />
      </main>
    </div>
  );
} 