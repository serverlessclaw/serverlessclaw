import React from 'react';

interface BadgeProps {
  variant?: 'primary' | 'intel' | 'danger' | 'warning' | 'audit' | 'outline';
  glow?: boolean;
  children: React.ReactNode;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  variant = 'primary',
  glow = false,
  children,
  className = '',
}) => {
  const variantStyles = {
    primary: 'bg-cyber-green/10 text-cyber-green border-cyber-green/20',
    intel: 'bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20',
    danger: 'bg-red-500/10 text-red-500 border-red-500/20',
    warning: 'bg-orange-400/10 text-orange-400 border-orange-400/20',
    audit: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    outline: 'bg-transparent text-white/60 border-white/10',
  }[variant];

  return (
    <span
      className={`
        px-2 py-1 border rounded text-[10px] font-black tracking-tighter
        ${variantStyles} 
        ${glow ? 'animate-pulse shadow-[0_0_10px_rgba(0,255,163,0.1)]' : ''} 
        ${className}
      `}
    >
      {children}
    </span>
  );
};

export default Badge;
