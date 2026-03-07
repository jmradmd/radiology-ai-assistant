// App Logo Component - Exact copy from web app
// Usage: <AppLogo size={32} variant="teal" />

import React from 'react';

interface AppLogoProps {
  size?: number;
  variant?: 'teal' | 'white' | 'dark';
  className?: string;
  animate?: boolean;
}

export function AppLogo({ size = 48, variant = 'teal', className, animate = false }: AppLogoProps) {
  const colors = {
    teal: { 
      primary: '#0d9488', 
      secondary: '#14b8a6' 
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

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="App logo"
    >
      <g transform="translate(24, 24)">
        {/* Center dot */}
        <circle cx={0} cy={0} r={4} fill={primary} />
        
        {/* Inner arcs */}
        <path 
          d="M-8 -6 Q-14 0 -8 6" 
          fill="none" 
          stroke={primary} 
          strokeWidth={3} 
          strokeLinecap="round"
        />
        <path 
          d="M8 -6 Q14 0 8 6" 
          fill="none" 
          stroke={primary} 
          strokeWidth={3} 
          strokeLinecap="round"
        />
        
        {/* Outer arcs */}
        <path 
          d="M-12 -10 Q-21 0 -12 10" 
          fill="none" 
          stroke={secondary} 
          strokeWidth={3} 
          strokeLinecap="round"
        />
        <path 
          d="M12 -10 Q21 0 12 10" 
          fill="none" 
          stroke={secondary} 
          strokeWidth={3} 
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default AppLogo;
