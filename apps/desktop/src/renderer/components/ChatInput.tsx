import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface ChatInputProps {
  onSubmit: (query: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSubmit,
  isLoading,
  placeholder = 'Ask about spine MRI red flags.',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!value) {
      textarea.style.height = '';
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 && !isLoading;

  const submit = useCallback(() => {
    if (!canSubmit) return;

    onSubmit(value.trim());
    setValue('');

    if (textareaRef.current) {
      textareaRef.current.style.height = '';
    }
  }, [canSubmit, onSubmit, value]);

  return (
    <div className="flex-shrink-0 px-3 py-3 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="relative w-full">
        <div className="relative flex items-center gap-2 p-1.5 rounded-[26px] border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <div className="flex-1 min-h-[40px]">
            <textarea
              id="chat-input"
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={placeholder}
              disabled={isLoading}
              className={cn(
                'w-full resize-none bg-transparent px-3 py-[10px] text-[15px] leading-[20px] font-sans tracking-normal whitespace-pre-wrap break-words',
                'text-gray-900 dark:text-slate-100 placeholder:text-gray-500 dark:placeholder:text-slate-400',
                'min-h-[40px] max-h-[120px] rounded-none border-0 outline-none ring-0',
                'focus:outline-none focus:ring-0'
              )}
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'flex-shrink-0 w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-200',
              canSubmit
                ? 'bg-teal-600 text-white shadow-sm hover:bg-teal-500 active:scale-95'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 cursor-not-allowed border border-gray-200 dark:border-slate-700'
            )}
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
