'use client'

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Edit3, Check, X } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { deleteChat } from "@/actions/delete-chat";
import { saveChat } from "@/actions/save-chat";
import { useRouter } from "next/navigation";
import { useAppState } from "@/state";

interface SidebarItemProps {
  chat: {
    id: string;
    title: string;
    messages: any[];
  };
  active: boolean;
  onSelect: () => void;
}

export function SidebarItem({ chat, active, onSelect }: SidebarItemProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { updateChats, chat: currentChat, setChat } = useAppState();

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Save the new title
  const handleRename = async () => {
    if (!title.trim()) {
      setTitle(chat.title);
      setEditing(false);
      return;
    }

    try {
      await saveChat({
        id: chat.id,
        name: title.trim(),
        messages: chat.messages || [],
      });
      
      // Update current chat if this is the active chat
      if (currentChat?.id === chat.id) {
        setChat({
          ...currentChat,
          name: title.trim()
        });
      }
      
      // Update chats list in state
      await updateChats();
      
      setEditing(false);
    } catch (error) {
      console.error("Error renaming chat:", error);
      setTitle(chat.title);
      setEditing(false);
    }
  };

  // Cancel editing
  const handleCancel = () => {
    setTitle(chat.title);
    setEditing(false);
  };

  // Delete the chat
  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (confirm("Are you sure you want to delete this chat?")) {
      setIsDeleting(true);
      try {
        await deleteChat(chat.id);
        
        // Update chats list in state immediately after deletion
        await updateChats();
        
        // If the deleted chat was the active chat, navigate to the main app page
        if (currentChat?.id === chat.id) {
          router.push('/app');
        }
      } catch (error) {
        console.error("Error deleting chat:", error);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className={`group flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer text-sm
        ${active 
          ? "bg-gradient-to-r from-primary-500 to-white text-primary-950 shadow-md" 
          : "hover:sidebar-item-gradient text-white/80 hover:text-white glass-panel"}`}
      onClick={!editing ? onSelect : undefined}
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRename();
          }}
          className="flex-1 flex items-center gap-1"
        >
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 px-2 text-sm bg-white/10 border-white/10 text-white"
          />
          <Button size="icon" type="submit" variant="ghost" className="h-7 w-7 text-white hover:bg-white/10">
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCancel}
            className="h-7 w-7 text-white hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 truncate" title={chat.title}>
            {chat.title}
          </span>
          <div className="hidden group-hover:flex gap-1">
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditing(true);
              }}
              className="h-7 w-7 text-white hover:bg-white/10"
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={handleDelete}
              disabled={isDeleting}
              className="h-7 w-7 text-white hover:bg-white/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </motion.li>
  );
} 