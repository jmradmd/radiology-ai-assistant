import React from 'react';
import { ChatMessage } from './ChatMessage';
import type { Message } from '../stores/chat';
import { Loader2 } from 'lucide-react';
import { LoadingIndicator } from './LoadingIndicator';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  return (
    <div className="p-3 space-y-3">
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
        />
      ))}

      {/* Loading indicator */}
      {isLoading && (
        <div className="py-2 animate-fade-in">
          <LoadingIndicator />
        </div>
      )}
    </div>
  );
}
