import React from 'react';

interface TypographyProps {
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'mono';
  as?: React.ElementType;
  color?: 'primary' | 'intel' | 'danger' | 'warning' | 'muted' | 'muted-more' | 'white' | 'inherit';
  uppercase?: boolean;
  glow?: boolean;
  weight?: 'normal' | 'medium' | 'bold' | 'black';
  italic?: boolean;
  children: React.ReactNode;
  className?: string;
}

const Typography: React.FC<TypographyProps> = ({
  variant = 'body',
  as,
  color = 'white',
  uppercase = false,
  glow = false,
  weight = 'normal',
  italic = false,
  children,
  className = '',
  ...props
}: TypographyProps & React.HTMLAttributes<HTMLElement>) => {
  const Component =
    as ||
    ({
      h1: 'h1',
      h2: 'h2',
      h3: 'h3',
      body: 'p',
      caption: 'span',
      mono: 'span',
    }[variant] as React.ElementType);

  const baseStyles = {
    h1: 'text-4xl font-bold tracking-tighter',
    h2: 'text-2xl font-bold tracking-tight',
    h3: 'text-xl font-bold tracking-tight',
    body: 'text-base leading-relaxed',
    caption: 'text-xs tracking-wider',
    mono: 'font-mono text-xs tracking-tighter',
  }[variant];

  const colorStyles = {
    primary: 'text-[var(--cyber-green)]',
    intel: 'text-[var(--cyber-blue)]',
    danger: 'text-red-500',
    warning: 'text-orange-400',
    muted: 'text-[var(--muted)]',
    'muted-more': 'text-[var(--muted-more)]',
    white: 'text-[var(--foreground)]',
    inherit: '',
  }[color];

  const weightStyles = {
    normal: 'font-normal',
    medium: 'font-medium',
    bold: 'font-bold',
    black: 'font-black',
  }[weight];

  return (
    <Component
      className={`
        ${baseStyles} 
        ${colorStyles} 
        ${weightStyles} 
        ${uppercase ? 'uppercase' : ''} 
        ${italic ? 'italic' : ''}
        ${glow ? 'glow-text' : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </Component>
  );
};

export default Typography;
