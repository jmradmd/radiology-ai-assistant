import { useState, useEffect } from 'react';
import { AppLogo } from '@/components/ui/app-logo';
import { cn } from '@/lib/utils';

const PHRASES = [
  'Thinking...',
  'Pondering...',
  'Reflecting...',
  'Taking a thoughtful pass...',
  'Weighing the options...',
  'Mapping the next steps...',
  'Gathering context...',
  'Reviewing what matters...',
  'Connecting relevant details...',
  'Tracing the logic...',
  'Following the thread...',
  'Checking assumptions...',
  'Validating the approach...',
  'Looking for edge cases...',
  'Double-checking specifics...',
  'Refining the response...',
  'Organizing the answer...',
  'Drafting a clear path...',
  'Building a concise summary...',
  'Comparing possibilities...',
  'Considering trade-offs...',
  'Seeking the best fit...',
  'Aligning with your request...',
  'Staying grounded in sources...',
  'Verifying key points...',
  'Tuning for clarity...',
  'Balancing speed and accuracy...',
  'Resolving ambiguities...',
  'Thinking one step ahead...',
  'Sorting signal from noise...',
  'Matching intent to action...',
  'Pressure-testing the plan...',
  'Checking for blind spots...',
  'Polishing the final wording...',
  'Sharpening recommendations...',
  'Calibrating confidence...',
  'Cross-checking details...',
  'Framing the next move...',
  'Exploring alternatives...',
  'Narrowing to essentials...',
  'Keeping it practical...',
  'Keeping it precise...',
  'Keeping it thoughtful...',
  'Reading between the lines...',
  'Looking at the full picture...',
  'Weighing risk and impact...',
  'Grounding in evidence...',
  'Building a reliable answer...',
  'Preparing a useful response...',
  'Working through the details...',
  'Synthesizing the context...',
  'Reconciling competing signals...',
  'Evaluating priority and urgency...',
  'Fine-tuning the output...',
  'Confirming constraints...',
  'Checking consistency...',
  'Tightening the reasoning...',
  'Verifying before replying...',
  'Finding the clearest route...',
  'Piecing it together...',
  'Thinking this through...',
  'Pondering the best angle...',
  'Trimming extra complexity...',
  'Almost ready...',
  'Ready in a moment...',
];

function shufflePhrases(phrases: string[]): string[] {
  const shuffled = [...phrases];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const LOADING_RADAR_KEYFRAMES = `
  @keyframes loading-radar-pulse {
    0% { transform: scale(1); opacity: 0.5; }
    75%, 100% { transform: scale(1.5); opacity: 0; }
  }
`;

interface LoadingIndicatorProps {
  className?: string;
  compact?: boolean;
}

export function LoadingIndicator({
  className,
  compact = false,
}: LoadingIndicatorProps) {
  const [phraseOrder] = useState(() => shufflePhrases(PHRASES));
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    if (compact) return;

    const intervalId = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1) % phraseOrder.length);
        setFade(true);
      }, 300); // Wait for fade out before changing text
    }, 2500); // Change phrase every 2.5 seconds

    return () => clearInterval(intervalId);
  }, [phraseOrder.length, compact]);

  return (
    <div className={cn("flex items-center", compact ? "gap-0" : "gap-3", className)}>
      <style>{LOADING_RADAR_KEYFRAMES}</style>
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full",
          compact
            ? "w-4 h-4"
            : "w-8 h-8 bg-brand-50/50 dark:bg-brand-900/20",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-full border-brand-300/60 dark:border-brand-600/45",
            compact ? "border" : "border-2",
          )}
          style={{
            animation: `loading-radar-pulse ${
              compact ? "2.2s" : "3s"
            } cubic-bezier(0, 0, 0.2, 1) infinite`,
            willChange: 'transform, opacity',
          }}
        />
        <AppLogo
          size={compact ? 11 : 20}
          variant="teal"
          animate={false}
          className="relative z-10"
        />
      </div>
      {!compact && (
        <div className="text-sm text-slate-500 dark:text-slate-400 font-medium tracking-wide">
          <span
            className={cn(
              "transition-opacity duration-300 ease-in-out",
              fade ? "opacity-100" : "opacity-0"
            )}
          >
            {phraseOrder[phraseIndex]}
          </span>
        </div>
      )}
    </div>
  );
}
