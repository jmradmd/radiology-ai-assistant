// App Logo Component
// Usage: <AppLogo size={32} variant="teal" />
// Animation: Subtle synchronized pulse effect (enabled by default)

import React from 'react';
import { cn } from '@/lib/utils';

interface AppLogoProps {
  size?: number;
  variant?: 'teal' | 'white' | 'dark' | 'light-teal';
  className?: string;
  animate?: boolean;
  animationDurationMs?: number;
}

export function AppLogo({
  size = 48,
  variant = 'teal',
  className,
  animate = true,
  animationDurationMs = 2800,
}: AppLogoProps) {
  const colors = {
    teal: { 
      primary: '#0d9488', 
      secondary: '#14b8a6' 
    },
    'light-teal': { 
      primary: '#2dd4bf', 
      secondary: '#5eead4' 
    },
    white: { 
      primary: 'rgba(255,255,255,1)', 
      secondary: 'rgba(255,255,255,0.6)' 
    },
    dark: { 
      primary: '#1e293b', 
      secondary: '#475569' 
    },
  };

  const { primary, secondary } = colors[variant];
  const glowId = `app-glow-${React.useId().replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className, animate && 'app-logo-animated')}
      style={
        animate
          ? ({
              "--app-logo-duration": `${animationDurationMs}ms`,
              "--app-logo-delay": "0ms",
            } as React.CSSProperties)
          : undefined
      }
      aria-label="App logo"
    >
      {/* Google-style material design animation */}
      <style>
        {`
          .app-logo-animated .app-dot {
            animation: g-dot var(--app-logo-duration, 2800ms) cubic-bezier(0.4, 0, 0.2, 1) var(--app-logo-delay, 0ms) infinite;
          }
          .app-logo-animated .app-arc-inner {
            animation: g-inner var(--app-logo-duration, 2800ms) cubic-bezier(0.4, 0, 0.2, 1) var(--app-logo-delay, 0ms) infinite;
          }
          .app-logo-animated .app-arc-outer {
            animation: g-outer var(--app-logo-duration, 2800ms) cubic-bezier(0.4, 0, 0.2, 1) var(--app-logo-delay, 0ms) infinite;
          }
          @keyframes g-dot {
            0%, 24%, 100% { opacity: 0.5; }
            5%, 12% { opacity: 1; }
          }
          @keyframes g-inner {
            0%, 8%, 38%, 100% { opacity: 0.35; }
            14%, 24% { opacity: 1; }
          }
          @keyframes g-outer {
            0%, 18%, 50%, 100% { opacity: 0.25; }
            26%, 38% { opacity: 1; }
          }
        `}
      </style>
      
      {/* Subtle glow filter for the dot */}
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      <g transform="translate(24, 24)">
        {/* Center dot */}
        <circle 
          cx={0} 
          cy={0} 
          r={4} 
          fill={primary}
          filter={animate ? `url(#${glowId})` : undefined}
          className={animate ? 'app-dot' : undefined}
        />
        
        {/* Inner arcs */}
        <path 
          d="M-8 -6 Q-14 0 -8 6" 
          fill="none" 
          stroke={primary} 
          strokeWidth={3} 
          strokeLinecap="round"
          className={animate ? 'app-arc-inner' : undefined}
        />
        <path 
          d="M8 -6 Q14 0 8 6" 
          fill="none" 
          stroke={primary} 
          strokeWidth={3} 
          strokeLinecap="round"
          className={animate ? 'app-arc-inner' : undefined}
        />
        
        {/* Outer arcs */}
        <path 
          d="M-12 -10 Q-21 0 -12 10" 
          fill="none" 
          stroke={secondary} 
          strokeWidth={3} 
          strokeLinecap="round"
          className={animate ? 'app-arc-outer' : undefined}
        />
        <path 
          d="M12 -10 Q21 0 12 10" 
          fill="none" 
          stroke={secondary} 
          strokeWidth={3} 
          strokeLinecap="round"
          className={animate ? 'app-arc-outer' : undefined}
        />
      </g>
    </svg>
  );
}

export default AppLogo;
